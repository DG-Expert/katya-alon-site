// Dependency-free, fail-closed checks for the Sheet-managed workshop configuration.
// Usage: node scripts/validate-workshop.mjs [--base-ref <git-ref>]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEvent } from './sync-event.mjs';

const ROOT = new URL('../', import.meta.url);
const WORKSHOP = new URL('../content/workshop.yaml', import.meta.url);
const WRANGLER = new URL('../worker/wrangler.toml', import.meta.url);
const PROTECTED_REGISTRATION_KEYS = [
  'enabled', 'endpoint', 'timeout_ms', 'turnstile_site_key', 'turnstile_action', 'consent_version'
];

const fail = message => { throw new Error(message); };

function flowParser(source, label) {
  let at = 0;
  const skip = () => { while (/\s/.test(source[at] || '')) at += 1; };
  const string = () => {
    const start = at++;
    let escaped = false;
    while (at < source.length) {
      const char = source[at++];
      if (char === '"' && !escaped) {
        try { return JSON.parse(source.slice(start, at)); } catch { fail(`${label}: invalid quoted string`); }
      }
      escaped = char === '\\' && !escaped;
      if (char !== '\\') escaped = false;
    }
    fail(`${label}: unterminated quoted string`);
  };
  const bare = () => {
    const start = at;
    while (at < source.length && source[at] !== ',' && source[at] !== '}') at += 1;
    const token = source.slice(start, at).trim();
    if (!token) fail(`${label}: empty scalar`);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(token)) return Number(token);
    return token;
  };
  const value = () => {
    skip();
    if (source[at] === '{') return map();
    if (source[at] === '"') return string();
    return bare();
  };
  const map = () => {
    const result = Object.create(null);
    at += 1;
    skip();
    while (source[at] !== '}') {
      const match = /^[A-Za-z0-9_]+/.exec(source.slice(at));
      if (!match) fail(`${label}: invalid map key near column ${at + 1}`);
      const key = match[0];
      if (Object.hasOwn(result, key)) fail(`${label}: duplicate key ${key}`);
      at += key.length;
      skip();
      if (source[at++] !== ':') fail(`${label}: missing colon after ${key}`);
      result[key] = value();
      skip();
      if (source[at] === ',') { at += 1; skip(); continue; }
      if (source[at] !== '}') fail(`${label}: expected comma or closing brace`);
    }
    at += 1;
    return result;
  };
  const parsed = value();
  skip();
  if (at !== source.length) fail(`${label}: trailing content`);
  return parsed;
}

export function parseTopLevelFlowMap(yaml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = yaml.match(new RegExp(`^${escaped}:\\s*(\\{.*\\})\\s*$`, 'm'));
  if (!match) fail(`content/workshop.yaml: ${key} must be one top-level inline map`);
  const parsed = flowParser(match[1], key);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${key}: mapping required`);
  return parsed;
}

function exactKeys(object, expected, label) {
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label}: expected only keys ${wanted.join(', ')}`);
}

function localized(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: localized map required`);
  exactKeys(value, ['he', 'en', 'ru'], label);
  for (const language of ['he', 'en', 'ru']) if (typeof value[language] !== 'string') fail(`${label}.${language}: string required`);
}

function registrationFrom(yaml, { allowLegacyWorkshopId = false } = {}) {
  const registration = parseTopLevelFlowMap(yaml, 'registration');
  const allowed = allowLegacyWorkshopId ? [...PROTECTED_REGISTRATION_KEYS, 'workshop_id'] : PROTECTED_REGISTRATION_KEYS;
  exactKeys(registration, allowed, 'registration');
  return registration;
}

function workshopIdFrom(yaml) {
  if (/^event:\s*$/m.test(yaml)) return parseEvent(yaml).workshopId;
  const legacy = registrationFrom(yaml, { allowLegacyWorkshopId: true }).workshop_id;
  if (typeof legacy !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(legacy)) fail('baseline workshop id is missing or invalid');
  return legacy;
}

export function validateWorkshopText(yaml, { baseText, wranglerText } = {}) {
  const event = parseEvent(yaml);
  const registration = registrationFrom(yaml);
  const layoutMatch = yaml.match(/^layout:\s*("(?:[^"\\]|\\.)*"|[^\s#]+)\s*$/m);
  if (!layoutMatch) fail('layout must be a single scalar');
  const layout = flowParser(layoutMatch[1], 'layout');
  if (!['conversion', 'story', 'program'].includes(layout)) fail('layout must be conversion, story, or program');

  if (registration.enabled !== true) fail('registration.enabled must remain true');
  if (typeof registration.endpoint !== 'string' || !/^https:\/\//.test(registration.endpoint)) fail('registration.endpoint must be HTTPS');
  if (!Number.isInteger(registration.timeout_ms) || registration.timeout_ms < 1000 || registration.timeout_ms > 60000) fail('registration.timeout_ms must be an integer from 1000 to 60000');
  for (const key of ['turnstile_site_key', 'turnstile_action', 'consent_version']) {
    if (typeof registration[key] !== 'string' || !registration[key]) fail(`registration.${key} must be a non-empty string`);
  }

  const sections = parseTopLevelFlowMap(yaml, 'sections');
  exactKeys(sections, ['content_1', 'content_2', 'power_image', 'content_3', 'pricing', 'instructor'], 'sections');
  for (const [key, value] of Object.entries(sections)) if (typeof value !== 'boolean') fail(`sections.${key} must be boolean`);

  const accessibility = parseTopLevelFlowMap(yaml, 'accessibility');
  exactKeys(accessibility, ['skip_to_content'], 'accessibility');
  localized(accessibility.skip_to_content, 'accessibility.skip_to_content');
  const powerImage = parseTopLevelFlowMap(yaml, 'power_image');
  exactKeys(powerImage, ['src', 'alt', 'caption'], 'power_image');
  if (typeof powerImage.src !== 'string' || !/^\.\/assets\/images\/[A-Za-z0-9._-]+\.(?:webp|png|jpg)$/.test(powerImage.src)) fail('power_image.src is invalid');
  localized(powerImage.alt, 'power_image.alt');
  localized(powerImage.caption, 'power_image.caption');
  const footer = parseTopLevelFlowMap(yaml, 'footer');
  exactKeys(footer, ['rights'], 'footer');
  localized(footer.rights, 'footer.rights');

  if (wranglerText !== undefined) {
    const consentMatch = wranglerText.match(/^CONSENT_VERSIONS\s*=\s*"([^"]*)"\s*$/m);
    if (!consentMatch) fail('worker/wrangler.toml: CONSENT_VERSIONS is missing');
    const consentVersions = consentMatch[1].split(',').map(value => value.trim()).filter(Boolean);
    if (!consentVersions.includes(registration.consent_version)) fail('registration.consent_version is not approved by worker CONSENT_VERSIONS');
    const actionMatch = wranglerText.match(/^TURNSTILE_ACTION\s*=\s*"([^"]*)"\s*$/m);
    if (!actionMatch || actionMatch[1] !== registration.turnstile_action) fail('registration.turnstile_action does not match worker TURNSTILE_ACTION');
  }

  if (baseText !== undefined) {
    const baselineRegistration = registrationFrom(baseText, { allowLegacyWorkshopId: !/^event:\s*$/m.test(baseText) });
    for (const key of PROTECTED_REGISTRATION_KEYS) {
      if (!Object.is(registration[key], baselineRegistration[key])) fail(`protected registration.${key} differs from main`);
    }
    const baselineWorkshopId = workshopIdFrom(baseText);
    if (event.workshopId !== baselineWorkshopId) {
      fail(`event.workshop_id differs from main (${baselineWorkshopId}); use the documented phased migration`);
    }
  }

  return { event, registration, layout };
}

function cliArgs(argv) {
  if (!argv.length) return {};
  if (argv.length === 2 && argv[0] === '--base-ref' && argv[1]) return { baseRef: argv[1] };
  fail('usage: node scripts/validate-workshop.mjs [--base-ref <git-ref>]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { baseRef } = cliArgs(process.argv.slice(2));
  const yaml = readFileSync(WORKSHOP, 'utf8');
  const wranglerText = readFileSync(WRANGLER, 'utf8');
  const baseText = baseRef ? execFileSync('git', ['show', `${baseRef}:content/workshop.yaml`], { cwd: ROOT, encoding: 'utf8' }) : undefined;
  validateWorkshopText(yaml, { baseText, wranglerText });
  console.log(`workshop safety checks passed${baseRef ? ` against ${baseRef}` : ''}`);
}
