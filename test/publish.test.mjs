import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../gas/Publish.gs', import.meta.url), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(source, context);

const workshopYaml = fs.readFileSync(new URL('../content/workshop.yaml', import.meta.url), 'utf8');

const paths = (prefix, keys) => keys.map(key => `${prefix}.${key}`);
const numbered = (prefix, count, keys = ['']) => Array.from({ length: count }, (_, index) => (
  keys.map(key => `${prefix}[${index + 1}]${key ? `.${key}` : ''}`)
)).flat();

// This fixture is generated from the fixed publisher schema, not from a private Sheet export
// and not from the current marketing copy. It stays useful when copy in the YAML changes.
const i18nPaths = [
  ...paths('meta', ['title', 'description']),
  'accessibility.skip_to_content',
  ...paths('nav', ['brand_alt', 'navigation_label', 'language_label', 'open_menu', 'close_menu', 'home', 'about', 'services', 'process', 'contact', 'workshops']),
  ...paths('layout_labels', ['conversion', 'story', 'program']),
  ...paths('hero', ['eyebrow', 'title', 'subtitle', 'description', 'details_kicker', 'details_heading']),
  ...numbered('hero.details', 3, ['label', 'value']),
  ...paths('content_1', ['kicker', 'title']), ...numbered('content_1.paragraphs', 5),
  ...paths('content_2', ['kicker', 'title', 'intro']), ...numbered('content_2.items', 6, ['title', 'text']),
  ...paths('power_image', ['alt', 'caption']), ...paths('ctas', ['after_content_1', 'after_power_image']),
  ...paths('content_3', ['kicker', 'title', 'intro']), ...numbered('content_3.items', 3, ['question', 'answer']),
  ...paths('pricing', ['currency', 'vat_text', 'kicker', 'title', 'intro', 'original_label', 'current_label', 'session_label', 'breakdown_label', 'includes', 'deadline', 'after_deadline', 'cta']),
  ...paths('instructor', ['kicker', 'title', 'role']), 'instructor.image.alt', ...numbered('instructor.paragraphs', 2),
  ...paths('form', ['kicker', 'title', 'intro', 'demo_notice', 'privacy_note', 'privacy_notice', 'consent', 'submit_label']),
  ...paths('form.fields.full_name', ['label', 'placeholder', 'help']), ...paths('form.fields.full_name.errors', ['required', 'invalid']),
  ...paths('form.fields.mobile', ['label', 'placeholder', 'help']), ...paths('form.fields.mobile.errors', ['required', 'invalid']),
  ...paths('form.fields.email', ['label', 'placeholder', 'help']), ...paths('form.fields.email.errors', ['required', 'invalid']),
  ...paths('form.fields.expertise', ['label', 'placeholder', 'help']), ...paths('form.fields.expertise.errors', ['required', 'too_short', 'has_digit']),
  ...paths('form.status', ['fix_errors', 'no_registration', 'loading', 'success', 'failure', 'duplicate', 'rate_limited', 'challenge_failure', 'timeout', 'invalid', 'unavailable']),
  'footer.rights'
];

const scalarValue = (path, type) => {
  if (path === 'layout') return 'story';
  if (path === 'event.timezone') return 'Asia/Jerusalem';
  if (path === 'event.workshop_id') return 'fixture-workshop';
  if (path === 'event.first_session_date') return '2027-01-10';
  if (path === 'event.second_session_date') return '';
  if (type === 'boolean') return 'true';
  if (type === 'asset') return './assets/images/katya-2.webp';
  if (type === 'number') return path === 'pricing.original_price' ? '4000' : path === 'pricing.current_price' ? '2000' : path === 'pricing.per_session_price' ? '1000' : '2';
  return 'fixture';
};

const fixtureRows = [...Object.keys(context.WORKSHOP_PUBLISH.SCALAR), ...i18nPaths].map((path, index) => {
  const schema = context.schemaForPath_(path);
  assert.ok(schema, path);
  return schema.type === 'i18n'
    ? { path, he: `he-${index}`, en: `en-${index}`, ru: `ru-${index}`, type: schema.type, required: schema.required ? 'yes' : 'no', state: '' }
    : { path, he: scalarValue(path, schema.type), en: '', ru: '', type: schema.type, required: schema.required ? 'yes' : 'no', state: '' };
});

test('publisher accepts the generated exact 143-row schema and rejects unknown paths', () => {
  assert.equal(fixtureRows.length, 143);
  assert.equal(new Set(fixtureRows.map(row => row.path)).size, 143);
  for (const row of fixtureRows) assert.equal(context.validateWorkshopRow_(row), '', row.path);
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
  const after = context.patchWorkshopYaml_(workshopYaml, fixtureRows);
  assert.match(after, /second_session_date: null/);
  assert.match(after, /content_1: true/);
  assert.match(after, /original_price: 4000/);
  assert.equal(after.match(/  (privacy_note|privacy_notice|consent): .*$/gm).join('\n'), beforeLegal);
  assert.match(after, /\{he: "[^"]+", en: "[^"]+", ru: "[^"]+"\}/);
  assert.equal(context.patchWorkshopYaml_(after, fixtureRows), after, 'a second round trip must be byte-identical');

  const row = path => fixtureRows.find(value => value.path === path);
  const i18n = path => `{he: ${JSON.stringify(row(path).he)}, en: ${JSON.stringify(row(path).en)}, ru: ${JSON.stringify(row(path).ru)}}`;
  assert.equal(after.match(/^accessibility:.*$/m)[0], `accessibility: {skip_to_content: ${i18n('accessibility.skip_to_content')}}`);
  assert.equal(after.match(/^power_image:.*$/m)[0], `power_image: {src: "./assets/images/katya-2.webp", alt: ${i18n('power_image.alt')}, caption: ${i18n('power_image.caption')}}`);
  assert.equal(after.match(/^footer:.*$/m)[0], `footer: {rights: ${i18n('footer.rights')}}`);
});

test('publisher rejects placeholders, missing locales and invalid numbers', () => {
  const invalid = { path: 'hero.title', type: 'i18n', he: 'יש', en: '', ru: 'x', required: 'כן', state: 'יש לייבא' };
  assert.notEqual(context.validateWorkshopRow_(invalid), '');
  assert.notEqual(context.validateWorkshopRow_({ path: 'pricing.current_price', type: 'number', he: '-1', en: '', ru: '', required: 'כן', state: '' }), '');
});
