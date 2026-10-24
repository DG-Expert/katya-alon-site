import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../gas/Publish.gs', import.meta.url), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

const exportRows = JSON.parse(fs.readFileSync(new URL('../docs/workshop_sheet_export.local.json', import.meta.url), 'utf8')).rows;
const workshopYaml = fs.readFileSync(new URL('../content/workshop.yaml', import.meta.url), 'utf8');

test('publisher accepts the exact 143-row export and rejects unknown paths', () => {
  assert.equal(exportRows.length, 143);
  for (const row of exportRows) {
    const value = { path: row[1], he: row[3], en: row[4], ru: row[5], type: row[6], required: row[7], state: row[8] };
    assert.equal(context.validateWorkshopRow_(value), '', row[1]);
  }
  assert.equal(context.isAllowedWorkshopPath_('registration.endpoint'), false);
  assert.equal(context.isAllowedWorkshopPath_('hero.unknown'), false);
});

test('publisher refuses protected and URL-like paths', () => {
  assert.equal(context.isAllowedWorkshopPath_('registration.endpoint'), false);
  assert.equal(context.isAllowedWorkshopPath_('form.privacy_notice'), true);
  assert.equal(context.isAllowedWorkshopPath_('event.timezone'), true);
  assert.equal(context.isAllowedWorkshopPath_('hero.title'), true);
});

test('publisher replaces only an allowed inline locale map', () => {
  const before = 'registration: {endpoint: "keep", turnstile_site_key: "keep"}\nhero:\n  title: {he: "old", en: "old", ru: "old"}\n';
  const after = context.patchWorkshopYaml_(before, [{ path: 'hero.title', type: 'i18n', he: 'חדש', en: 'new', ru: 'новый' }]);
  assert.match(after, /endpoint: "keep"/);
  assert.match(after, /title: \{he: "חדש", en: "new", ru: "новый"\}/);
});

test('round trips the 143 rows, types null/booleans/numbers, and preserves read-only legal fields', () => {
  const beforeLegal = workshopYaml.match(/  (privacy_note|privacy_notice|consent): .*$/gm).join('\n');
  const values = exportRows.map(row => ({ path: row[1], he: row[3], en: row[4], ru: row[5], type: row[6] }));
  const after = context.patchWorkshopYaml_(workshopYaml, values);
  assert.match(after, /second_session_date: null/);
  assert.match(after, /content_1: true/);
  assert.match(after, /original_price: 4000/);
  assert.equal(after.match(/  (privacy_note|privacy_notice|consent): .*$/gm).join('\n'), beforeLegal);
  assert.match(after, /\{he: "[^"]+", en: "[^"]+", ru: "[^"]+"\}/);
});

test('publisher rejects placeholders, missing locales and invalid numbers', () => {
  const invalid = { path: 'hero.title', type: 'i18n', he: 'יש', en: '', ru: 'x', required: 'כן', state: 'יש לייבא' };
  assert.notEqual(context.validateWorkshopRow_(invalid), '');
  assert.notEqual(context.validateWorkshopRow_({ path: 'pricing.current_price', type: 'number', he: '-1', en: '', ru: '', required: 'כן', state: '' }), '');
});
