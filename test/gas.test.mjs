import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/src/index.js';
import { EVENT } from '../worker/src/event.generated.js';
import { loadGas, envelope, gasPayload, gasEvent, oldGasPayload, workerEnv, post, goodBody, SECRET } from './helpers.mjs';

const create = (g, over = {}, opts) => g.call(envelope(gasPayload(over), opts));
const dataRows = g => g.grid.slice(1);
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const localizedDate = (iso, months) => {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
};
const addDays = (iso, amount) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

test('Worker signature is accepted by GAS (integration)', async () => {
  const g = loadGas();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('siteverify')
    ? new Response(JSON.stringify({ success: true, hostname: 'dg-expert.github.io', action: 'workshop_register' }))
    : new Response(JSON.stringify(g.call(init.body)));
  try {
    const res = await worker.fetch(post(goodBody()), workerEnv());
    assert.equal(res.status, 200);
    assert.match((await res.json()).registrationId, /^R-[0-9A-F]{12}$/);
  } finally { globalThis.fetch = real; }
  assert.equal(dataRows(g).length, 1);
});

test('rejects bad signature, stale timestamp, malformed envelope, missing config', () => {
  const g = loadGas();
  assert.equal(create(g, {}, { secret: 'wrong' }).status, 'auth');
  assert.equal(create(g, {}, { ts: Math.floor(Date.now() / 1000) - 301 }).status, 'auth');
  assert.equal(g.call('not json').status, 'auth');
  assert.equal(g.call({ v: 2 }).status, 'auth');
  const tampered = envelope(gasPayload()); tampered.payload = tampered.payload.replace('Maya', 'Mayo');
  assert.equal(g.call(tampered).status, 'auth');
  assert.equal(loadGas({ props: { HMAC_SECRET: '' } }).call(envelope(gasPayload())).status, 'unavailable');
  assert.equal(dataRows(g).length, 0);
});

test('strict payload shape', () => {
  const g = loadGas();
  for (const over of [{ mobile: '12' }, { email: 'x' }, { lang: 'fr' }, { full_name: 'A1' }, { extra: 'x' }]) assert.equal(create(g, over).status, 'invalid');
  assert.equal(g.call(envelope(null, { payload: '[]' })).status, 'invalid');
  assert.equal(g.call(envelope(gasPayload(), { rid: 'nope' })).status, 'invalid');
});

test('stores row, text format, leading zeros, headers; sends owner + registrant mail', () => {
  const g = loadGas();
  const res = create(g);
  assert.equal(res.status, 'created');
  assert.ok(g.formats.includes('@'));
  assert.equal(g.grid[0][4], 'mobile');
  const row = dataRows(g)[0];
  assert.equal(row[4], '0501234567');
  assert.equal(row[9], 'RECEIVED');
  assert.equal(row[14], 'SENT'); assert.equal(row[15], 'SENT');
  assert.equal(g.mails.length, 2);
  const owner = g.mails.find(m => m.to === 'owner@example.com');
  const reg = g.mails.find(m => m.to === 'maya@example.com');
  assert.match(owner.body, /docs\.google\.com\/spreadsheets\/d\/sheet-id\/edit/);
  assert.ok(!owner.body.includes('maya@example.com') && !owner.body.includes('0501234567'));
  assert.ok(!reg.body.includes('docs.google.com/spreadsheets') && !reg.htmlBody.includes('spreadsheets'));
  assert.match(reg.body, /not a payment or seat confirmation/);
  assert.ok(reg.body.includes(localizedDate(EVENT.firstSessionDate, EN_MONTHS)));
  assert.ok(!/zoom/i.test(reg.body));
});

test('no calendar link without complete config; link when configured', () => {
  const g = loadGas();
  create(g);
  assert.ok(!g.mails.some(m => m.body.includes('calendar.google.com')));
  const partial = loadGas({ props: { EVENT_START_ISO: '2026-11-16T18:00:00', EVENT_TIMEZONE: 'Asia/Jerusalem' } });
  create(partial);
  assert.ok(!partial.mails.some(m => m.body.includes('calendar.google.com')));
  const full = loadGas({ props: { EVENT_START_ISO: '2026-11-16T18:00:00', EVENT_END_ISO: '2026-11-16T20:00:00', EVENT_TIMEZONE: 'Asia/Jerusalem' } });
  create(full);
  const reg = full.mails.find(m => m.to === 'maya@example.com');
  assert.match(reg.body, /dates=20261116T180000\/20261116T200000&ctz=Asia%2FJerusalem/);
  const bad = loadGas({ props: { EVENT_START_ISO: '2026-11-16T20:00:00', EVENT_END_ISO: '2026-11-16T18:00:00', EVENT_TIMEZONE: 'Asia/Jerusalem' } });
  create(bad);
  assert.ok(!bad.mails.some(m => m.body.includes('calendar.google.com')));
});

test('localized participant mail (he/ru) with HTML escaping', () => {
  const g = loadGas();
  create(g, { lang: 'he', full_name: '<b>Dan</b>', mobile: '0501111111', email: 'dan@example.com' });
  const he = g.mails.find(m => m.to === 'dan@example.com');
  assert.match(he.htmlBody, /dir="rtl"/);
  assert.ok(!he.htmlBody.includes('<b>Dan</b>') && he.htmlBody.includes('&lt;b&gt;Dan'));
  create(g, { lang: 'ru', mobile: '0502222222', email: 'ru@example.com' });
  assert.match(g.mails.find(m => m.to === 'ru@example.com').body, /Мы получили/);
});

test('idempotency: same retry replays w/o duplicate row or mail; changed retry conflicts', () => {
  const g = loadGas();
  const opts = { rid: '11111111-1111-4111-8111-111111111111' };
  const a = create(g, {}, opts);
  const b = create(g, {}, opts);
  assert.equal(b.status, 'replay');
  assert.equal(b.registrationId, a.registrationId);
  assert.equal(dataRows(g).length, 1);
  assert.equal(g.mails.length, 2);
  assert.equal(create(g, { expertise: 'Tax law' }, opts).status, 'conflict');
});

test('duplicate email or mobile for same workshop; other workshop allowed', () => {
  const g = loadGas();
  assert.equal(create(g).status, 'created');
  assert.equal(create(g, { mobile: '0509999999', email: 'MAYA@example.com' }).status, 'duplicate');
  assert.equal(create(g, { email: 'other@example.com' }).status, 'duplicate');
  assert.equal(create(g, { mobile: '0508888888', email: 'x@example.com', workshopId: 'another' }).status, 'created');
  assert.equal(dataRows(g).length, 2);
});

test('spreadsheet formula injection is neutralised', () => {
  const g = loadGas();
  for (const [i, lead] of ['=', '+', '-', '@'].entries()) {
    create(g, { email: `${lead}x${i}@example.com`, mobile: `05000000${i}0`, expertise: `${lead}HYPERLINK`, full_name: `${lead}Name` });
  }
  for (const row of dataRows(g)) {
    for (const col of [3, 5, 6]) assert.match(row[col], /^'[=+\-@]/);
  }
  // mail shows the original value, not the escape apostrophe
  assert.ok(g.mails.some(m => m.body.includes('- Full name: =Name')));
});

test('mail failure leaves PENDING, retried by trigger, capped, no double sends', () => {
  const failing = loadGas({ failMail: true });
  create(failing);
  assert.equal(dataRows(failing)[0][14], 'PENDING');
  assert.equal(dataRows(failing)[0][16], 2);
  // swap in a working mailer on the same sheet state
  failing.ctx.MailApp.sendEmail = m => failing.mails.push(m);
  failing.ctx.retryPendingMails();
  assert.equal(dataRows(failing)[0][14], 'SENT'); assert.equal(dataRows(failing)[0][15], 'SENT');
  assert.equal(failing.mails.length, 2);
  failing.ctx.retryPendingMails();
  assert.equal(failing.mails.length, 2);

  const capped = loadGas({ failMail: true });
  create(capped);
  for (let i = 0; i < 5; i++) capped.ctx.retryPendingMails();
  assert.equal(dataRows(capped)[0][14], 'FAILED');
});

test('no quota -> mail stays PENDING; owner email unset -> PENDING', () => {
  const q = loadGas({ quota: 0 });
  create(q);
  assert.equal(dataRows(q)[0][14], 'PENDING');
  const o = loadGas({ props: { OWNER_EMAIL: '' } });
  create(o);
  assert.equal(dataRows(o)[0][14], 'PENDING');
  assert.equal(dataRows(o)[0][15], 'SENT');
});

test('GET and direct unsigned POST never write', () => {
  const g = loadGas();
  assert.equal(JSON.parse(g.ctx.doGet().text).status, 'invalid');
  assert.equal(g.call(JSON.stringify(gasPayload())).status, 'auth');
  assert.equal(g.grid.length, 0);
});

test('grows the sheet when the grid is full instead of failing', () => {
  const g = loadGas({ maxRows: 2 });
  assert.equal(create(g).status, 'created');
  assert.equal(create(g, { email: 'b@example.com', mobile: '0507654321' }).status, 'created');
  assert.equal(dataRows(g).length, 2);
});

test('auth failures log only a reason code (no secret/payload)', () => {
  const g = loadGas();
  const logs = [];
  g.ctx.console.log = m => logs.push(m);
  create(g, {}, { secret: 'wrong' });
  create(g, {}, { ts: Math.floor(Date.now() / 1000) - 400 });
  g.call('not json');
  g.call({ v: 2 });
  assert.deepEqual(logs.map(l => l.split(' ').slice(0, 2).join(' ')), ['auth_fail sig_mismatch', 'auth_fail timestamp', 'auth_fail body_parse', 'auth_fail envelope_shape']);
  assert.ok(!logs.join('').includes('test-hmac-secret') && !logs.join('').includes('maya'));
});

test('HMAC is computed over UTF-8 for Hebrew/Russian payloads (regression: signature_mismatch)', () => {
  const g = loadGas();
  const res = create(g, { full_name: 'כץ אלון Иван Петров', expertise: 'דיני משפחה / Семейное право' });
  assert.equal(res.status, 'created');
  // mock distinguishes the default overload from explicit UTF-8 for non-ASCII input
  const U = g.ctx.Utilities, text = 'כץ Иван';
  assert.notDeepEqual(U.computeHmacSha256Signature(text, 'k'), U.computeHmacSha256Signature(text, 'k', U.Charset.UTF_8));
});

test('GAS source passes Charset.UTF_8 to computeHmacSha256Signature', () => {
  const src = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  const calls = src.match(/computeHmacSha256Signature\([^;]*\)/g) || [];
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.match(c, /,\s*Utilities\.Charset\.UTF_8\s*\)/);
});

test('GAS source is clean UTF-8 (no BOM, no mojibake code points)', () => {
  const src = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  assert.ok(!src.includes('﻿') && !src.includes('�'));
  for (const c of src) { const n = c.codePointAt(0); if (n > 127) assert.ok((n >= 0x590 && n <= 0x5ff) || (n >= 0x400 && n <= 0x4ff) || '|״'.includes(c), `unexpected U+${n.toString(16)}`); }
});

test('MailApp receives readable Hebrew/Russian subject, body and htmlBody', () => {
  for (const [lang, subj, word] of [['he', 'קיבלנו את פרטיך להכשרה', 'שלום'], ['ru', 'Мы получили ваши данные для обучения', 'Здравствуйте']]) {
    const g = loadGas();
    create(g, { lang, email: `${lang}@example.com`, full_name: 'Test' });
    const m = g.mails.find(x => x.to === `${lang}@example.com`);
    assert.equal(m.subject, subj);
    assert.ok(m.body.includes(word) && m.htmlBody.includes(word));
    assert.ok(!/[─-╿ӦÃ×]/.test(m.subject + m.body + m.htmlBody));
  }
  const owner = loadGas(); create(owner, {});
  const o = owner.mails.find(x => x.to === 'owner@example.com');
  assert.equal(o.subject, 'הרשמה חדשה להכשרה');
  assert.match(o.body, /התקבלה הרשמה חדשה/); assert.match(o.htmlBody, /הגיליון הפרטי/);
});

// ---------- event metadata (single source: content/workshop.yaml) ----------
const regMail = (g, to) => g.mails.find(m => m.to === to);

test('mail text is generated from event metadata in he/en/ru (no hardcoded dates)', () => {
  const ev = { firstSessionDate: '2027-03-05', secondSessionDate: '2027-03-12', sessionCount: 3, totalHours: 6 };
  const cases = [['he', /5 במרץ 2027/, /12 במרץ 2027/, /3 מפגשים, 6 שעות/], ['en', /5 March 2027/, /12 March 2027/, /3 sessions, 6 hours/], ['ru', /5 марта 2027/, /12 марта 2027/, /встреч — 3, всего часов — 6/]];
  for (const [lang, d1, d2, size] of cases) {
    const g = loadGas();
    assert.equal(create(g, { lang, event: gasEvent(ev) }).status, 'created');
    const m = regMail(g, 'maya@example.com');
    for (const re of [d1, d2, size]) assert.match(m.body, re);
    assert.match(m.htmlBody, d1);
    assert.ok(!/2026/.test(m.body), 'old hardcoded year must not leak');
  }
});

test('unknown second session date -> "will be announced" wording; known -> printed', () => {
  const unknown = { he: /יימסר בהמשך/, en: /second session date will be announced/, ru: /второй встречи будет сообщена/ };
  for (const lang of ['he', 'en', 'ru']) {
    const g = loadGas();
    create(g, { lang });
    assert.match(regMail(g, 'maya@example.com').body, unknown[lang]);
  }
  const g = loadGas();
  const secondSessionDate = addDays(EVENT.firstSessionDate, 7);
  create(g, { event: gasEvent({ secondSessionDate }) });
  const b = regMail(g, 'maya@example.com').body;
  assert.ok(b.includes(`Second session: ${localizedDate(secondSessionDate, EN_MONTHS)}`));
  assert.ok(!/will be announced/.test(b));
});

test('old 7-key payload (pre-change Worker) is still accepted; mail omits event line, no hardcoded date', () => {
  const g = loadGas();
  assert.equal(g.call(envelope(oldGasPayload())).status, 'created');
  const m = regMail(g, 'maya@example.com');
  assert.match(m.body, /not a payment or seat confirmation/);
  assert.ok(!/First session:|second session date|sessions, .* hours/.test(m.body));
  assert.equal(g.mails.length, 2);
});

test('malicious / malformed event objects are rejected and nothing is stored', () => {
  const bad = [
    gasEvent({ extra: 'x' }), { ...gasEvent(), firstSessionDate: undefined }, gasEvent({ firstSessionDate: '2026-02-30' }), gasEvent({ firstSessionDate: '<script>' }),
    gasEvent({ secondSessionDate: addDays(EVENT.firstSessionDate, -1) }), gasEvent({ sessionCount: 0 }), gasEvent({ sessionCount: 2.5 }), gasEvent({ sessionCount: '2' }),
    gasEvent({ totalHours: -1 }), gasEvent({ totalHours: 1e9 }), gasEvent({ totalHours: null }), gasEvent({ timezone: 'x; DROP' }), 'str', [], null
  ];
  for (const event of bad) {
    const g = loadGas();
    assert.equal(create(g, { event }).status, 'invalid', JSON.stringify(event));
    assert.equal(g.grid.length, 0);
    assert.equal(Object.keys(g.properties).filter(k => k.startsWith('EVENT:')).length, 0);
  }
  const g = loadGas();
  assert.equal(create(g, { evnt: gasEvent() }).status, 'invalid');
  assert.equal(create(g, { event: gasEvent(), extra: 1 }).status, 'invalid');
});

test('event payload is HMAC protected: tampering with event breaks the signature', () => {
  const g = loadGas();
  const env = envelope(gasPayload());
  env.payload = env.payload.replace(EVENT.firstSessionDate, '2030-01-01');
  assert.equal(g.call(env).status, 'auth');
});

test('retried mail (trigger, no payload) reuses the stored per-workshop event', () => {
  const g = loadGas({ failMail: true });
  create(g, { event: gasEvent({ firstSessionDate: '2027-05-01' }) });
  g.ctx.MailApp.sendEmail = m => g.mails.push(m);
  g.ctx.retryPendingMails();
  assert.match(regMail(g, 'maya@example.com').body, /1 May 2027/);
});

test('GAS source contains no hardcoded event date; event section is ASCII-only and equals the cloud patch', async () => {
  const src = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/November 2026|16 \u0431/.test(src));
  const { buildPatch } = await import('../scripts/make-gas-patch.mjs');
  const patch = buildPatch(src);
  assert.ok(!/[^\x00-\x7f]/.test(patch));
  assert.ok(patch.includes('function parsePayload_') && patch.includes('function registrantMessage_'));
  assert.ok(!patch.includes('var TEXT') && !patch.includes('function hmacHex_'));
});

test('cloud patch appended to a pre-change Code.gs (with only the HMAC fix) enables event mails and keeps old payloads working', async () => {
  const { execFileSync } = await import('node:child_process');
  const { buildPatch } = await import('../scripts/make-gas-patch.mjs');
  const head = execFileSync('git', ['show', 'HEAD:gas/Code.gs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
    .replace('computeHmacSha256Signature(message, secret)', 'computeHmacSha256Signature(message, secret, Utilities.Charset.UTF_8)');
  assert.ok(head.includes('Charset.UTF_8)'));
  const live = head + '\n' + buildPatch(readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8'));
  const g = loadGas({ source: live });
  const secondSessionDate = addDays(EVENT.firstSessionDate, 7);
  assert.equal(create(g, { lang: 'ru', event: gasEvent({ secondSessionDate }) }).status, 'created');
  assert.ok(regMail(g, 'maya@example.com').body.includes(`Вторая встреча: ${localizedDate(secondSessionDate, RU_MONTHS)}`));
  assert.equal(g.call(envelope(oldGasPayload({ email: 'old@example.com', mobile: '0507777777' }))).status, 'created');
  assert.equal(g.call(envelope(gasPayload({ event: gasEvent({ sessionCount: 0 }), email: 'z@example.com', mobile: '0506666666' }))).status, 'invalid');
});

test('sender name and replyTo are preserved', () => {
  const g = loadGas();
  create(g);
  for (const m of g.mails) { assert.equal(m.name, 'קטיה אלון | Katya Alon'); assert.equal(m.replyTo, 'katya.shivuk@gmail.com'); }
});
