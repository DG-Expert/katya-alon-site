import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { loadGas, envelope, gasPayload, workerEnv, post, goodBody, SECRET } from './helpers.mjs';

const create = (g, over = {}, opts) => g.call(envelope(gasPayload(over), opts));
const dataRows = g => g.grid.slice(1);

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
  assert.match(reg.body, /16 November 2026/);
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
