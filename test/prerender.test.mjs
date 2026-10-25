import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { escapeHtml, renderHome, renderWorkshops } from '../scripts/build-pages.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const indexHtml = read('index.html');
const workshopsHtml = read('workshops.html');
const contentYaml = read('content/content.yaml');
const workshopYaml = read('content/workshop.yaml');
const content = yaml.load(contentYaml);
const workshop = yaml.load(workshopYaml);

const count = (html, needle) => html.split(needle).length - 1;
const body = html => html.slice(html.indexOf('<body'));
const h1 = html => html.match(/<h1\b[^>]*>([^<]*)<\/h1>/)?.[1];
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];

function assertCrawlableHead(html, { title, description, url }) {
  assert.match(html, /^<!doctype html>\n<html lang="he" dir="rtl"/);
  assert.equal(count(html, '<title>'), 1);
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], escapeHtml(title));
  assert.equal(count(html, '<meta name="description"'), 1);
  assert.equal(meta(html, 'name', 'description'), escapeHtml(description));
  assert.equal(count(html, 'rel="canonical"'), 1);
  assert.match(html, new RegExp(`<link rel="canonical" href="${url.replaceAll('.', '\\.')}">`));
  assert.equal(meta(html, 'property', 'og:url'), url);
  assert.equal(meta(html, 'property', 'og:type'), 'website');
  assert.equal(meta(html, 'property', 'og:title'), escapeHtml(title));
  assert.equal(meta(html, 'property', 'og:description'), escapeHtml(description));
  assert.equal(meta(html, 'name', 'twitter:card'), 'summary');
  assert.equal(count(html, 'og:title'), 1);
  assert.doesNotMatch(html, /hreflang|og:image|application\/ld\+json/);
}

test('home prerender exposes the Hebrew H1, hero and section text without running JS', () => {
  const html = renderHome(indexHtml, contentYaml);
  assertCrawlableHead(html, { title: content.site.title.he, description: content.hero.description.he, url: 'https://katya-alon.com/' });
  assert.equal(h1(html), content.hero.title.he);
  assert.equal(count(html, '<h1'), 1);

  const page = body(html);
  for (const text of [
    content.hero.subtitle.he, content.hero.description.he, content.about.title.he, content.services.title.he,
    content.trust.text.he, content.final_cta.title.he,
    ...content.about.paragraphs.map(p => p.he), ...content.audience.items.map(item => item.he),
    ...content.process.steps.map(step => step.title.he)
  ]) assert.ok(page.includes(escapeHtml(text)), `missing: ${text}`);

  // Each service heading/summary appears once: no hidden duplicate copies, and the modal stays empty until clicked.
  for (const item of content.services.items) {
    assert.equal(count(page, `>${escapeHtml(item.title.he)}<`), 1);
    assert.equal(count(page, escapeHtml(item.description.he)), 1);
  }
  assert.match(page, /<h3 id="modal-title"[^>]*><\/h3>/);
  assert.match(page, /<div id="process-list" dir="rtl" /);
  assert.doesNotMatch(page, /data-content="[^"]+"[^>]*>\s*</, 'every data-content node must be prerendered');
  // Interactive hooks used by hydration stay intact.
  assert.equal(count(page, 'onclick="openServiceModal('), content.services.items.length);
  assert.match(page, /<div id="clients-strip"><\/div>/);
  assert.match(page, /<div id="recommendations-strip"><\/div>/);
});

test('workshop prerender exposes the Hebrew hero, program, FAQ and pricing without running JS', () => {
  const html = renderWorkshops(workshopsHtml, workshopYaml);
  assertCrawlableHead(html, { title: workshop.meta.title.he, description: workshop.meta.description.he, url: 'https://katya-alon.com/workshops.html' });
  assert.equal(h1(html), escapeHtml(workshop.hero.title.he));
  assert.equal(count(html, '<h1'), 1);
  assert.match(html, new RegExp(`<body class="[^"]*\\blayout-${workshop.layout}"`));

  const page = body(html);
  for (const text of [
    workshop.hero.subtitle.he, workshop.hero.description.he, workshop.content_1.title.he,
    ...workshop.content_2.items.map(item => item.title.he), ...workshop.content_3.items.map(item => item.question.he),
    workshop.pricing.title.he, workshop.pricing.deadline.he, workshop.instructor.paragraphs[0].he
  ]) assert.ok(page.includes(escapeHtml(text)), `missing: ${text}`);

  const [y, m, d] = workshop.event.first_session_date.split('-');
  assert.ok(page.includes(`<dd>${d}.${m}.${y}</dd>`), 'event date token is resolved from the event block');
  assert.ok(page.includes(`<dd>${workshop.event.session_count} `));
  assert.ok(page.includes(new Intl.NumberFormat('he-IL').format(workshop.pricing.current_price)));
  assert.doesNotMatch(html, /\{(?:event\.[a-z_]+|price|total|count|currency|vat)\}/);

  // The registration form keeps its fail-closed initial state; nothing registration-related is baked into the HTML.
  assert.match(page, /<button id="form-submit"[^>]*disabled><\/button>/);
  assert.match(page, /<input id="form-consent" name="consent" type="checkbox" disabled>/);
  assert.ok(!html.includes(workshop.registration.endpoint));
  assert.ok(!html.includes(workshop.registration.turnstile_site_key));
});

test('unsafe YAML values are HTML-escaped in text and attributes', () => {
  const evil = `<script>alert("x")</script>' onmouseover="x`;
  const quoted = JSON.stringify(evil);
  const home = renderHome(indexHtml, contentYaml
    .replace(/^(  title:\n    he: ).*$/m, `$1${quoted}`)
    .replace(/^(  description:\n    he: ).*$/m, `$1${quoted}`)
    .replace(/^(    he: )קטיה אלון$/m, `$1${quoted}`));
  const page = renderWorkshops(workshopsHtml, workshopYaml
    .replace(/^(  title: \{he: )"[^"]*"/m, `$1${quoted}`)
    .replace(/^(  eyebrow: \{he: )"[^"]*"/m, `$1${quoted}`));

  for (const html of [home, page]) {
    assert.ok(!html.includes('<script>alert'), 'raw script tag leaked');
    assert.ok(!html.includes(`' onmouseover="x`), 'attribute breakout leaked');
    assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39; onmouseover=&quot;x'));
  }
  assert.equal(h1(home), escapeHtml(evil));
  assert.equal(meta(home, 'name', 'description'), escapeHtml(evil));
  assert.equal(meta(page, 'property', 'og:title'), escapeHtml(evil));
});

test('missing source copy or unexpected template changes fail the build closed', () => {
  assert.throws(() => renderHome(indexHtml, contentYaml.replace(/^(  title:\n    he: ).*$/m, '$1""')), /missing Hebrew text/);
  assert.throws(() => renderHome(indexHtml.replace('id="audience-list"', 'id="audience-gone"'), contentYaml), /#audience-list/);
  assert.throws(() => renderWorkshops(workshopsHtml.replace('<h1 id="workshop-title" class="workshop-title"></h1>', '<h1 id="workshop-title" class="workshop-title">stale</h1>'), workshopYaml), /#workshop-title/);
  assert.throws(() => renderWorkshops(workshopsHtml, workshopYaml.replace(/^layout: .*$/m, 'layout: "other"')), /layout/);
  assert.throws(() => renderWorkshops(workshopsHtml, workshopYaml.replace('{event.sessions} מפגשים', '{event.unknown} מפגשים')), /unresolved token/);
});
