import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EVENT } from '../worker/src/event.generated.js';

export const ORIGIN = 'https://dg-expert.github.io';
export const SECRET = 'test-hmac-secret';

export function workerEnv(over = {}) {
  return {
    ALLOWED_ORIGINS: `${ORIGIN},https://dev-server.tail6972d4.ts.net:8445`,
    TURNSTILE_HOSTNAMES: 'dg-expert.github.io,dev-server.tail6972d4.ts.net',
    TURNSTILE_ACTION: 'workshop_register', CONSENT_VERSIONS: 'v1',
    GAS_URL: 'https://script.example.test/exec', GAS_HMAC_SECRET: SECRET, TURNSTILE_SECRET: 'ts-secret',
    REGISTRATION_LIMITER: { limit: async () => ({ success: true }) }, ...over
  };
}

export const goodBody = (over = {}) => ({
  full_name: 'Maya Cohen', mobile: '0501234567', email: 'maya@example.com', expertise: 'Family law', lang: 'en',
  workshopId: 'lawyers-social-2026-11', consent: true, consentVersion: 'v1', website: '', idempotencyKey: randomUUID(),
  turnstileToken: 'tok', ...over
});

export function post(body, { origin = ORIGIN, headers = {}, raw } = {}) {
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers };
  if (origin) h.Origin = origin;
  return new Request('https://worker.test/api/register', { method: 'POST', headers: h, body: raw ?? JSON.stringify(body) });
}

// ---------- Google Apps Script mock runtime ----------
const toSigned = buf => [...buf].map(b => (b > 127 ? b - 256 : b));

export function loadGas({ props = {}, quota = 100, failMail = false, maxRows = 1000, source } = {}) {
  const properties = { SHEET_ID: 'sheet-id', HMAC_SECRET: SECRET, DEDUPE_SALT: 'salt', OWNER_EMAIL: 'owner@example.com', ...props };
  const grid = []; // grid[r-1][c-1]
  const formats = [];
  const mails = [];
  const sheet = {
    getLastRow: () => grid.length,
    getMaxRows: () => maxRows,
    insertRowsAfter(_after, n) { maxRows += n; },
    getRange(r, c, nr = 1, nc = 1) {
      if (r + nr - 1 > maxRows) throw new Error('out of bounds');
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { (grid[r - 1 + i] ??= [])[c - 1 + j] = v; })); },
        setValue(v) { (grid[r - 1] ??= [])[c - 1] = v; },
        setNumberFormat(f) { formats.push(f); }
      };
    }
  };
  let sheetExists = false;
  const ctx = {
    console: { error() {}, log() {} },
    Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k] ?? null, setProperty: (k, v) => { properties[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => (sheetExists ? sheet : null), insertSheet: () => { sheetExists = true; return sheet; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail(m) { if (failMail) throw new Error('quota'); mails.push(m); } },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      // Real GAS: the 2-arg overload does not encode as UTF-8 (verified live: HMAC_UTF8_MATCH=false for Hebrew/Russian).
      // The mock simulates that deterministically with a lossy single-byte encoding; only an explicit UTF_8 charset gives UTF-8.
      computeHmacSha256Signature: (m, k, cs) => toSigned(createHmac('sha256', k).update(Buffer.from(m, cs === 'utf8' ? 'utf8' : 'latin1')).digest()),
      computeDigest: (_a, t) => toSigned(createHash('sha256').update(t, 'utf8').digest()),
      getUuid: () => randomUUID()
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source ?? readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8'), ctx);
  const call = envelope => JSON.parse(ctx.doPost({ postData: { contents: typeof envelope === 'string' ? envelope : JSON.stringify(envelope) } }).text);
  return { ctx, call, grid, formats, mails, properties };
}

export function envelope(payloadObj, { rid = randomUUID(), ts = Math.floor(Date.now() / 1000), secret = SECRET, payload } = {}) {
  const p = payload ?? JSON.stringify(payloadObj);
  return { v: 1, ts, rid, payload: p, sig: createHmac('sha256', secret).update(`1.${ts}.${rid}.${p}`).digest('hex') };
}

// Pre-change sender: exactly the original 7 keys, no `event`.
export const oldGasPayload = (over = {}) => ({
  workshopId: EVENT.workshopId, full_name: 'Maya Cohen', mobile: '0501234567', email: 'maya@example.com', expertise: 'Family law',
  lang: 'en', consentVersion: 'v1', ...over
});
export const gasEvent = (over = {}) => ({
  firstSessionDate: EVENT.firstSessionDate, secondSessionDate: EVENT.secondSessionDate, sessionCount: EVENT.sessionCount, totalHours: EVENT.totalHours,
  timezone: EVENT.timezone, ...over
});
export const gasPayload = (over = {}) => ({ ...oldGasPayload(), event: gasEvent(), ...over });
