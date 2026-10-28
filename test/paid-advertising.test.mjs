import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { buildPages, enabledServices, LANGUAGES, routeFor } from '../scripts/build-pages.mjs';

const ROOT = new URL('../', import.meta.url);
const site = yaml.load(readFileSync(new URL('content/content.yaml', ROOT), 'utf8'));
const services = enabledServices(site);
const paid = services.find(s => s.slug === 'paid-advertising');
const { page } = paid;
let stage;
const html = (lang, slug = 'paid-advertising') => readFileSync(join(stage, routeFor(lang, 'service', slug).slice(1), 'index.html'), 'utf8');
before(() => { stage = mkdtempSync(join(tmpdir(), 'katya-paid-')); buildPages(stage); });
after(() => rmSync(stage, { recursive: true, force: true }));

test('exact Hebrew copy, one H1, no old duplicate panels', () => {
  const he = html('he');
  for (const s of [
    'ניהול פרסום ממומן לעסקים', 'הדרכה אישית לפרסום ממומן',
    'אני מציעה שירות מקצועי של בנייה וניהול קמפיינים ממומנים בפייסבוק ובאינסטגרם, בהתאמה למטרות העסק, לקהל הרלוונטי ולתקציב הפרסום.',
    'השירות כולל תכנון אסטרטגיית פרסום, הקמת קמפיינים במערכת Meta Ads Manager, מעקב אחר ביצועים וביצוע אופטימיזציה לשיפור התוצאות.',
    'רוצים ללמוד לנהל את הפרסום הממומן של העסק בעצמכם ולחסוך בעלויות הניהול?',
    'אני מציעה הדרכה אישית ומעשית שבה תלמדו לעבוד עם מערכת Meta Ads Manager, להקים קמפיינים, להגדיר תקציבים, להבין את הנתונים ולנהל את הפרסום שלכם באופן עצמאי.',
    '<strong>אתם בוחרים: אני מנהלת עבורכם את הפרסום, או מלמדת אתכם לעשות את זה בעצמכם.</strong>',
    'לשיחה על ניהול קמפיינים', 'לפרטים על הדרכה אישית'
  ]) assert.ok(he.includes(s), s);
  for (const lang of LANGUAGES) {
    const out = html(lang);
    assert.equal(out.split('<h1').length - 1, 1);
    assert.equal(out.split('class="service-option"').length - 1, 2);
    assert.ok(!out.includes('service-panel'));
    assert.match(out, /article-wide/);
  }
  assert.match(he.match(/<h1>(.*?)<\/h1>/)[1].replace(/<[^>]+>/g, ''), /^פרסום ממומן בפייסבוק ובאינסטגרם$/);
});

test('only paid-advertising uses the rich layout', () => {
  for (const s of services.filter(x => x !== paid)) {
    assert.ok(!s.page);
    for (const lang of LANGUAGES) assert.match(html(lang, s.slug), /article-reading/);
  }
});

test('option CTAs open WhatsApp with a service-specific encoded message in each locale', () => {
  for (const lang of LANGUAGES) {
    const hrefs = page.options.map(o => o.cta.href[lang]);
    assert.notEqual(hrefs[0], hrefs[1]);
    for (const href of hrefs) {
      assert.match(href, /^https:\/\/wa\.me\/972547838645\?text=/);
      assert.ok(html(lang).includes(`href="${href}"`));
      assert.ok(!/\s/.test(href));
    }
  }
});

test('results gallery: order, exclusion of the January chart, and media files when enabled', () => {
  const { results } = page;
  assert.deepEqual(results.items.map(i => i.slug), ['pos-systems', 'dental-clinic', 'landing-page-traffic', 'video-campaign']);
  assert.ok(!JSON.stringify(results).includes('1143'));
  for (const lang of LANGUAGES) {
    const out = html(lang);
    if (!results.enabled) {
      // awaiting original media handoff: nothing may reference nonexistent images
      assert.ok(!out.includes('results-grid') && !out.includes('/assets/images/paid-advertising/'));
      continue;
    }
    assert.equal(out.split('<img src="/assets/images/paid-advertising/').length - 1, 4);
    assert.ok(out.includes('data-gallery-viewer') && out.includes('gallery.js'));
    assert.ok(out.includes(results.note[lang]));
  }
  if (results.enabled) for (const i of results.items) {
    for (const f of [i.src, i.thumb]) assert.ok(existsSync(new URL(f.slice(1), ROOT)), f);
    for (const lang of LANGUAGES) assert.ok(i.alt[lang].length > 20);
  }
});

test('viewer script: dialog based, Escape/close, focus return, scroll lock', () => {
  const js = readFileSync(new URL('js/gallery.js', ROOT), 'utf8');
  for (const s of ['showModal', 'preventDefault', 'data-gallery-close', "opener?.focus()", 'viewer-open']) assert.ok(js.includes(s), s);
});

test('local CSS/JS URLs stay content-hashed (build-time check via release script) and metadata is intact', () => {
  for (const lang of LANGUAGES) {
    const out = html(lang);
    assert.match(out, /<link rel="canonical"/);
    assert.equal(out.split('rel="alternate" hreflang=').length - 1, 4);
    assert.match(out, /BreadcrumbList/);
  }
});
