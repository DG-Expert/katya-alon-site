import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { sign } from '../worker/src/index.js';
import { workerEnv, post, goodBody, ORIGIN, SECRET } from './helpers.mjs';

const realFetch = globalThis.fetch;
let calls;
let siteverify;
let gas;
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status });

beforeEach(() => {
  calls = [];
  siteverify = { success: true, hostname: 'dg-expert.github.io', action: 'workshop_register' };
  gas = () => jsonRes({ status: 'created', registrationId: 'R-ABC123' });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('siteverify')) return siteverify instanceof Error ? Promise.reject(siteverify) : jsonRes(siteverify);
    return gas(init);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const run = (req, env = workerEnv()) => worker.fetch(req, env);

test('OPTIONS: exact origin allowed, others and missing denied, never wildcard', async () => {
  const ok = await run(new Request('https://w.test/api/register', { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(ok.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  assert.equal(ok.headers.get('Vary'), 'Origin');
  for (const origin of ['https://evil.example', 'https://dg-expert.github.io.evil.example', 'http://dg-expert.github.io', null]) {
    const h = origin ? { Origin: origin } : {};
    const res = await run(new Request('https://w.test/api/register', { method: 'OPTIONS', headers: h }));
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('POST without or with wrong origin is denied before anything else', async () => {
  assert.equal((await run(post(goodBody(), { origin: null }))).status, 403);
  assert.equal((await run(post(goodBody(), { origin: 'https://evil.example' }))).status, 403);
  assert.equal(calls.length, 0);
});

test('happy path returns CORS JSON and signs envelope to GAS', async () => {
  const res = await run(post(goodBody()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, registrationId: 'R-ABC123', replay: false });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const sv = calls[0];
  assert.match(sv.init.body.toString(), /remoteip=203.0.113.9/);
  const g = calls[1];
  assert.equal(g.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(g.init.redirect, 'follow');
  const env = JSON.parse(g.init.body);
  assert.equal(env.sig, await sign(SECRET, 1, env.ts, env.rid, env.payload));
  assert.ok(!env.payload.includes('turnstile') && !env.payload.includes('idempotency'));
});

test('validation rejects bad fields with 422 and never calls upstream', async () => {
  const bad = [
    { full_name: 'Maya 2' }, { full_name: 'M' }, { mobile: '12345' }, { mobile: '+972501234567' }, { email: 'nope' }, { email: 'a@b' },
    { expertise: 'law 2' }, { lang: 'fr' }, { workshopId: 'other' }, { consent: false }, { consentVersion: 'pending-approval' },
    { website: 'x' }, { idempotencyKey: 'not-a-uuid' }, { turnstileToken: '' }, { turnstileToken: 'x'.repeat(2049) }, { extra: 1 }
  ];
  for (const over of bad) {
    const res = await run(post(goodBody(over)));
    assert.equal(res.status, 422, JSON.stringify(over).slice(0, 60));
  }
  assert.equal(calls.length, 0);
});

test('Hebrew and Russian names pass', async () => {
  assert.equal((await run(post(goodBody({ full_name: 'יעל כהן' })))).status, 200);
  assert.equal((await run(post(goodBody({ full_name: 'Анна Иванова' })))).status, 200);
});

test('body limit enforced with spoofed or absent content-length; content-type and json checked', async () => {
  const big = JSON.stringify(goodBody({ expertise: 'a'.repeat(9000) }));
  assert.equal((await run(post(null, { raw: big, headers: { 'Content-Length': '10' } }))).status, 413);
  assert.equal((await run(post(null, { raw: big }))).status, 413);
  assert.equal((await run(post(goodBody(), { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await run(post(null, { raw: '{bad' }))).status, 400);
  assert.equal(calls.length, 0);
});

test('fails closed without limiter or secrets', async () => {
  for (const over of [{ REGISTRATION_LIMITER: undefined }, { TURNSTILE_SECRET: '' }, { GAS_HMAC_SECRET: undefined }, { GAS_URL: 'http://insecure.test' }, { GAS_URL: undefined }]) {
    assert.equal((await run(post(goodBody()), workerEnv(over))).status, 503);
  }
  assert.equal(calls.length, 0);
});

test('empty CONSENT_VERSIONS rejects everything', async () => {
  assert.equal((await run(post(goodBody()), workerEnv({ CONSENT_VERSIONS: '' }))).status, 422);
});

test('rate limiter blocks before Siteverify, keyed by CF-Connecting-IP; missing IP rejected', async () => {
  let key;
  const env = workerEnv({ REGISTRATION_LIMITER: { limit: async o => { key = o.key; return { success: false }; } } });
  assert.equal((await run(post(goodBody()), env)).status, 429);
  assert.equal(key, '203.0.113.9');
  assert.equal(calls.length, 0);
  const req = new Request('https://w.test/api/register', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(goodBody()) });
  assert.equal((await run(req)).status, 400);
});

test('Turnstile: failure, wrong hostname, wrong action -> 403; network/5xx -> 503; GAS never called', async () => {
  for (const sv of [{ success: false }, { success: true, hostname: 'evil.test', action: 'workshop_register' }, { success: true, hostname: 'dg-expert.github.io', action: 'other' }]) {
    siteverify = sv;
    assert.equal((await run(post(goodBody()))).status, 403);
  }
  siteverify = new Error('net');
  assert.equal((await run(post(goodBody()))).status, 503);
  assert.ok(calls.every(c => c.url.includes('siteverify')));
});

test('GAS status mapping', async () => {
  const cases = [['created', 200], ['replay', 200], ['duplicate', 409], ['conflict', 409], ['invalid', 422], ['auth', 502], ['unavailable', 503], ['weird', 502]];
  for (const [status, http] of cases) {
    gas = () => jsonRes({ status, registrationId: 'R-1' });
    const res = await run(post(goodBody()));
    assert.equal(res.status, http, status);
    const body = await res.json();
    assert.equal(body.ok, http === 200);
    if (status === 'replay') assert.equal(body.replay, true);
    assert.ok(!JSON.stringify(body).includes('maya@example.com'));
  }
  gas = () => jsonRes({ status: 'created' }); // missing id
  assert.equal((await run(post(goodBody()))).status, 502);
  gas = () => new Response('<html>', { status: 200 });
  assert.equal((await run(post(goodBody()))).status, 502);
  gas = () => jsonRes({}, 500);
  assert.equal((await run(post(goodBody()))).status, 502);
});

test('GAS timeout -> 504, network error -> 503', async () => {
  gas = () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }));
  assert.equal((await run(post(goodBody()))).status, 504);
  gas = () => Promise.reject(new Error('net'));
  assert.equal((await run(post(goodBody()))).status, 503);
});
