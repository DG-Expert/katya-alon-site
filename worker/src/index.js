// Cloudflare Worker: browser -> POST /api/register -> Turnstile Siteverify -> signed server-to-server call to Apps Script.
import { validatePayload, list } from './validate.js';

const MAX_BODY = 8192;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5000;
const GAS_TIMEOUT_MS = 25000;

const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// Must match gas/Code.gs: HMAC-SHA256 over `${v}.${ts}.${rid}.${payload}` (payload = literal JSON string sent).
export async function sign(secret, v, ts, rid, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(`${v}.${ts}.${rid}.${payload}`)));
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}

function json(status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin', ...(origin ? corsHeaders(origin) : {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

async function readBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

async function verifyTurnstile(env, token, ip) {
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  let data;
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) });
    if (!res.ok) return 'unavailable';
    data = await res.json();
  } catch {
    return 'unavailable';
  }
  if (data?.success !== true) return 'failed';
  if (!list(env.TURNSTILE_HOSTNAMES).includes(data.hostname) || data.action !== env.TURNSTILE_ACTION) return 'failed';
  return 'ok';
}

const GAS_STATUS = { created: 200, replay: 200, duplicate: 409, conflict: 409, invalid: 422, auth: 502, unavailable: 503 };

async function callGas(env, value) {
  const payload = JSON.stringify({
    workshopId: value.workshopId, full_name: value.full_name, mobile: value.mobile, email: value.email, expertise: value.expertise,
    lang: value.lang, consentVersion: value.consentVersion
  });
  const ts = Math.floor(Date.now() / 1000);
  const rid = value.idempotencyKey;
  const envelope = JSON.stringify({ v: 1, ts, rid, payload, sig: await sign(env.GAS_HMAC_SECRET, 1, ts, rid, payload) });
  let res;
  try {
    res = await fetch(env.GAS_URL, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: envelope,
      signal: AbortSignal.timeout(GAS_TIMEOUT_MS)
    });
  } catch (error) {
    return { http: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 503, body: { ok: false, error: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unavailable' } };
  }
  // Diagnostics only: reason codes, never payloads, secrets or URLs (visible via `wrangler tail`).
  const upstream = reason => { console.warn(`gas_upstream reason=${reason} http=${res.status} redirected=${res.redirected} ct=${(res.headers.get('content-type') || '').split(';')[0].slice(0, 40)}`); return { http: 502, body: { ok: false, error: 'upstream' } }; };
  let data;
  if (!res.ok) return upstream('http_status');
  try { data = await res.json(); } catch { return upstream('not_json'); }
  const http = GAS_STATUS[data?.status];
  if (!http) return upstream('unknown_status');
  if (data.status === 'auth') return upstream('gas_auth');
  if (http === 200) {
    if (typeof data.registrationId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(data.registrationId)) return upstream('bad_registration_id');
    return { http, body: { ok: true, registrationId: data.registrationId, replay: data.status === 'replay' } };
  }
  return { http, body: { ok: false, error: data.status === 'auth' ? 'upstream' : data.status } };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/register') return json(404, { ok: false, error: 'not_found' });
    const origin = request.headers.get('Origin');
    if (!origin || !list(env.ALLOWED_ORIGINS).includes(origin)) return json(403, { ok: false, error: 'origin' });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method' }, origin);

    // Fail closed when anything required is missing.
    if (!env.REGISTRATION_LIMITER || typeof env.REGISTRATION_LIMITER.limit !== 'function' || !env.TURNSTILE_SECRET || !env.GAS_HMAC_SECRET
      || !env.TURNSTILE_ACTION || !list(env.TURNSTILE_HOSTNAMES).length || !/^https:\/\//.test(env.GAS_URL || '')) {
      return json(503, { ok: false, error: 'unavailable' }, origin);
    }

    if (!/^application\/json\s*(;|$)/i.test(request.headers.get('Content-Type') || '')) return json(415, { ok: false, error: 'content_type' }, origin);
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BODY) return json(413, { ok: false, error: 'too_large' }, origin);

    let text;
    try { text = await readBody(request); } catch { return json(400, { ok: false, error: 'body' }, origin); }
    if (text === null) return json(413, { ok: false, error: 'too_large' }, origin);
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { ok: false, error: 'json' }, origin); }

    const checked = validatePayload(body, env);
    if (!checked.ok) return json(422, { ok: false, error: 'invalid', field: checked.field }, origin);

    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json(400, { ok: false, error: 'client' }, origin);
    let limited;
    try { limited = await env.REGISTRATION_LIMITER.limit({ key: ip }); } catch { return json(503, { ok: false, error: 'unavailable' }, origin); }
    if (!limited?.success) return json(429, { ok: false, error: 'rate_limited' }, origin);

    const turnstile = await verifyTurnstile(env, checked.turnstileToken, ip);
    if (turnstile === 'unavailable') return json(503, { ok: false, error: 'unavailable' }, origin);
    if (turnstile !== 'ok') return json(403, { ok: false, error: 'challenge' }, origin);

    const result = await callGas(env, checked.value);
    return json(result.http, result.body, origin);
  }
};
