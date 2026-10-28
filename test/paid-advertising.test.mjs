import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import vm from 'node:vm';
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

test('gallery images: real sizes, lossless full view, responsive thumbnails, lazy loading', () => {
  assert.equal(page.results.enabled, true);
  const dims = path => { const b = readFileSync(new URL(path.slice(1), ROOT)); assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WEBP'); return b; };
  for (const item of page.results.items) {
    for (const f of [item.src, item.thumb, item.thumb_2x]) dims(f);
    assert.ok(dims(item.src).toString('ascii', 12, 16) === 'VP8L', `${item.slug} full view must be lossless`);
    assert.ok(statSync(new URL(item.thumb.slice(1), ROOT)).size < statSync(new URL(item.src.slice(1), ROOT)).size / 5);
  }
  for (const lang of LANGUAGES) {
    const out = html(lang);
    const grid = out.match(/<div class="results-grid">[\s\S]*?<\/div><dialog/)[0];
    assert.equal(grid.split('loading="lazy"').length - 1, 4);
    assert.equal(grid.split('srcset="').length - 1, 4);
    assert.equal(out.split('width="768" height="512"').length - 1, 4);
    assert.ok(out.includes(`aria-label="${page.results.viewer.close[lang]}"`));
    assert.ok(out.indexOf('pos-systems') < out.indexOf('dental-clinic') && out.indexOf('dental-clinic') < out.indexOf('landing-page-traffic') && out.indexOf('landing-page-traffic') < out.indexOf('video-campaign'));
  }
});

// Lifecycle regression: every close route ends in the dialog "close" event; Escape fires it natively, button/backdrop call viewer.close().
test('viewer lifecycle: all close routes unlock page scroll and return focus to the opening thumbnail', () => {
  const listeners = {}; const classes = new Set();
  const focused = [];
  const mk = () => ({ listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const thumb = { href: '/full.webp', querySelector: () => ({ alt: 'alt text' }), focus() { focused.push('thumb'); } };
  const closeBtn = { focus() { focused.push('close'); } };
  const image = { attrs: { src: 'x' }, removeAttribute(k) { delete this.attrs[k]; }, set src(v) { this.attrs.src = v; } };
  const viewer = { ...mk(), open: false, querySelector: sel => (sel === '[data-gallery-image]' ? image : sel === '[data-gallery-close]' ? closeBtn : { scrollTo() {} }),
    showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.listeners.close(); } } };
  const documentStub = { querySelector: () => viewer, addEventListener: (t, f) => { listeners[t] = f; }, documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } } };
  vm.runInNewContext(readFileSync(new URL('js/gallery.js', ROOT), 'utf8'), { document: documentStub });
  const click = target => listeners.click({ target, preventDefault() {} });
  const open = () => { click({ closest: sel => (sel === '[data-gallery-link]' ? thumb : null) }); assert.ok(viewer.open && classes.has('viewer-open')); };
  const routes = {
    escape: () => viewer.close(),
    button: () => click({ closest: sel => (sel === '[data-gallery-close]' ? closeBtn : null) }),
    backdrop: () => click(viewer)
  };
  for (const [name, close] of Object.entries(routes)) for (let n = 0; n < 2; n++) {
    focused.length = 0; open(); close();
    assert.ok(!viewer.open && !classes.has('viewer-open'), `${name}: page scroll must unlock`);
    assert.equal(focused.at(-1), 'thumb', `${name}: focus must return to the thumbnail`);
    assert.equal(image.attrs.src, undefined);
  }
});

test('viewer CSS keeps the close control outside the scrolling area and locks only while open', () => {
  const css = readFileSync(new URL('css/articles.css', ROOT), 'utf8');
  assert.match(css, /\.results-viewer-bar \{[^}]*flex: none/);
  assert.match(css, /\.results-viewer-scroll \{[^}]*overflow: auto[^}]*overscroll-behavior: contain/);
  assert.match(css, /html\.viewer-open, html\.viewer-open body \{ overflow: hidden/);
});

test('local CSS/JS URLs stay content-hashed (build-time check via release script) and metadata is intact', () => {
  for (const lang of LANGUAGES) {
    const out = html(lang);
    assert.match(out, /<link rel="canonical"/);
    assert.equal(out.split('rel="alternate" hreflang=').length - 1, 4);
    assert.match(out, /BreadcrumbList/);
  }
});
