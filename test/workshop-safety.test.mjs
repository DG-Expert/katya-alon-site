import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorkshopText } from '../scripts/validate-workshop.mjs';

const yaml = readFileSync(new URL('../content/workshop.yaml', import.meta.url), 'utf8');
const wranglerText = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const setEvent = (text, key, value) => text.replace(new RegExp(`^(  ${key}:).*$`, 'm'), `$1 ${value}`);
const wranglerList = key => wranglerText.match(new RegExp(`^${key} = "([^"]*)"$`, 'm'))?.[1].split(',');

test('Worker config preserves existing hosts and allows the new apex domain', () => {
  assert.deepEqual(wranglerList('ALLOWED_ORIGINS'), [
    'https://dg-expert.github.io',
    'https://dev-server.tail6972d4.ts.net:8445',
    'https://katya-alon.com'
  ]);
  assert.deepEqual(wranglerList('TURNSTILE_HOSTNAMES'), [
    'dg-expert.github.io',
    'dev-server.tail6972d4.ts.net',
    'katya-alon.com'
  ]);
});

test('current workshop passes structural, consent and protected-config checks', () => {
  const result = validateWorkshopText(yaml, { baseText: yaml, wranglerText });
  assert.ok(['conversion', 'story', 'program'].includes(result.layout));
  assert.match(result.event.workshopId, /^[A-Za-z0-9._-]+$/);
});

test('legacy main workshop_id is accepted as the migration baseline', () => {
  const id = validateWorkshopText(yaml).event.workshopId;
  const legacy = yaml
    .replace(/^event:\n(?:  .*\n)+/m, '')
    .replace(/^registration: \{/m, `registration: {workshop_id: "${id}", `);
  assert.doesNotThrow(() => validateWorkshopText(yaml, { baseText: legacy, wranglerText }));
});

test('protected registration drift and workshop id rollover fail closed', () => {
  const changedEndpoint = yaml.replace('katya-workshop-registration.arielbenzikri.workers.dev', 'other.example.test');
  assert.throws(() => validateWorkshopText(changedEndpoint, { baseText: yaml, wranglerText }), /protected registration\.endpoint/);
  const changedId = setEvent(yaml, 'workshop_id', '"next-workshop"');
  assert.throws(() => validateWorkshopText(changedId, { baseText: yaml, wranglerText }), /workshop_id differs from main/);
});

test('Sheet-style localized-map flattening and consent mismatches are rejected', () => {
  const flattened = yaml.replace(/^(accessibility: \{skip_to_content: \{.*\})\}$/m, '$1, en: "duplicate"}');
  assert.throws(() => validateWorkshopText(flattened, { wranglerText }), /accessibility: expected only keys/);
  assert.throws(() => validateWorkshopText(yaml, { wranglerText: wranglerText.replace('CONSENT_VERSIONS = "2026-10-v1"', 'CONSENT_VERSIONS = "other"') }), /not approved/);
});

test('copy and an allowed layout change do not trip registration safety', () => {
  const changedCopy = yaml.replace(/^layout:.*$/m, 'layout: "program"').replace('Self-Marketing Training', 'Independent Marketing Training');
  const result = validateWorkshopText(changedCopy, { baseText: yaml, wranglerText });
  assert.equal(result.layout, 'program');
});
