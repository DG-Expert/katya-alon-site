// Strict server-side validation. Browser checks are convenience only.
import { EVENT } from './event.generated.js';
const FIELDS = ['full_name', 'mobile', 'email', 'expertise', 'lang', 'workshopId', 'consent', 'consentVersion', 'website', 'idempotencyKey', 'turnstileToken'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.\-]*$/u;

const list = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);

// Returns { ok: true, value } or { ok: false, field }.
export function validatePayload(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: 'body' };
  for (const key of Object.keys(body)) if (!FIELDS.includes(key)) return { ok: false, field: key };
  for (const key of FIELDS) if (key !== 'consent' && typeof body[key] !== 'string') return { ok: false, field: key };

  const v = {};
  v.full_name = body.full_name.trim().replace(/\s+/g, ' ');
  if (v.full_name.length < 2 || v.full_name.length > 100 || !NAME.test(v.full_name) || (v.full_name.match(/\p{L}/gu) || []).length < 2) return { ok: false, field: 'full_name' };
  v.mobile = body.mobile.trim();
  if (!/^[0-9]{8,15}$/.test(v.mobile)) return { ok: false, field: 'mobile' };
  v.email = body.email.trim();
  if (v.email.length > 254 || !EMAIL.test(v.email) || v.email.includes('..')) return { ok: false, field: 'email' };
  v.expertise = body.expertise.trim().replace(/\s+/g, ' ');
  if (v.expertise.length < 2 || v.expertise.length > 160 || /\p{N}|\p{C}/u.test(v.expertise)) return { ok: false, field: 'expertise' };
  if (!['he', 'en', 'ru'].includes(body.lang)) return { ok: false, field: 'lang' };
  v.lang = body.lang;
  if (body.workshopId !== EVENT.workshopId) return { ok: false, field: 'workshopId' };
  v.workshopId = body.workshopId;
  if (body.consent !== true) return { ok: false, field: 'consent' };
  if (!list(env.CONSENT_VERSIONS).includes(body.consentVersion)) return { ok: false, field: 'consentVersion' };
  v.consentVersion = body.consentVersion;
  if (body.website !== '') return { ok: false, field: 'website' };
  if (!UUID.test(body.idempotencyKey)) return { ok: false, field: 'idempotencyKey' };
  v.idempotencyKey = body.idempotencyKey.toLowerCase();
  if (!body.turnstileToken || body.turnstileToken.length > 2048) return { ok: false, field: 'turnstileToken' };
  return { ok: true, value: v, turnstileToken: body.turnstileToken };
}

export { list };
