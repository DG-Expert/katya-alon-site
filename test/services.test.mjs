import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { buildPages, enabledServices, escapeHtml, LANGUAGES, renderService, routeFor, urlFor } from '../scripts/build-pages.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const site = yaml.load(read('content/content.yaml'));
const { articles } = yaml.load(read('content/articles.yaml'));
const services = enabledServices(site);
const standalonePages = site.services.standalone_pages;
const count = (html, needle) => html.split(needle).length - 1;
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
const siteHeader = html => html.match(/<header\b[\s\S]*?<\/header>/)[0];
const EXPECTED = [
  ['ייעוץ ואסטרטגיה שיווקית', 'marketing-strategy', 'service-marketing-strategy'],
  ['ניהול סושיאל ויצירת תוכן', 'social-media-content', 'service-social-media-content'],
  ['פרסום ממומן בפייסבוק ובאינסטגרם', 'paid-advertising', 'service-paid-advertising'],
  ['הרצאות וסדנאות בשיווק דיגיטלי', 'lectures-workshops', 'service-workshops'],
  ['הדרכה אישית לשיווק ברשתות החברתיות לבעלי עסקים', 'personal-social-media-training', 'service-personal-social-media-training']
];

const pages = LANGUAGES.flatMap(lang => [
  [lang, 'home', ''], [lang, 'workshops', ''], [lang, 'articles', ''], [lang, 'podcasts', ''],
  ...articles.map(article => [lang, 'article', article.slug]),
  ...services.map(service => [lang, 'service', service.slug])
]);
const fileFor = (lang, page, slug) => {
  const route = routeFor(lang, page, slug).slice(1);
  return join(stage, route.endsWith('/') || !route ? `${route}index.html` : route);
};

let stage;
before(() => {
  stage = mkdtempSync(join(tmpdir(), 'katya-services-'));
  buildPages(stage);
});
after(() => rmSync(stage, { recursive: true, force: true }));

test('five distinct enabled services keep stable slugs and the disabled guidance item remains unpublished', () => {
  assert.deepEqual(services.map(service => [service.title.he, service.slug, service.anchor]), EXPECTED);
  assert.deepEqual(services.map(service => service.display_order), [1, 2, 3, 4, 5]);
  for (const lang of LANGUAGES) {
    for (const field of ['title', 'description']) {
      assert.equal(new Set(services.map(service => service[field][lang])).size, 5, `${field}.${lang} must be distinct`);
    }
  }
  for (const service of services) {
    const { details } = service;
    for (const lang of LANGUAGES) {
      for (const value of [service.title, service.description, details.summary, details.contact_cta.label, ...details.tech_points, ...details.second_tech_points, ...details.body]) {
        assert.ok(value[lang].trim(), `${service.slug}: missing ${lang}`);
      }
      assert.match(details.contact_cta.href[lang], /^https:\/\/wa\.me\/972547838645\?text=/);
    }
  }
  const personal = site.services.items.find(item => item.title.he === 'ליווי והדרכה אישית לבעלי עסקים');
  assert.equal(personal.enabled, false);
  assert.ok(!personal.anchor && !personal.slug, 'the disabled card must not keep the legacy anchor');
});

test('15 service pages are prerendered with unique localized SEO, schema, links and the WhatsApp CTA', () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const lang of LANGUAGES) {
    for (const service of services) {
      const html = readFileSync(fileFor(lang, 'service', service.slug), 'utf8');
      const url = urlFor(lang, 'service', service.slug);
      const t = value => escapeHtml(value[lang]);
      const marketing = service.marketing_page;
      const training = service.card_title ? service : null;
      const pageTitle = training ? t(training.title) : marketing ? t(marketing.heading) : service.page ? `${t(service.page.heading)} ${t(service.page.heading_accent)}` : t(service.title);
      const seoTitle = training ? t(training.seo_title) : marketing ? t(marketing.seo_title) : `${t(service.title)} | ${t(site.hero.name)}`;
      const seoDescription = training ? t(training.meta_description) : marketing ? t(marketing.meta_description) : t(service.description);
      assert.match(html, new RegExp(`^<!doctype html>\\n<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`));
      assert.equal(count(html, '<h1'), 1);
      // The opt-in paid-advertising layout splits the H1 around an emphasis span; the plain text must still equal the title.
      assert.equal(html.match(/<h1>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, ''), pageTitle);
      assert.equal(service.page ? t(service.title) : null, service.page ? `${t(service.page.heading)} ${t(service.page.heading_accent)}` : null);
      const title = html.match(/<title>([^<]*)<\/title>/)[1];
      assert.equal(title, seoTitle);
      assert.equal(meta(html, 'name', 'description'), seoDescription);
      titles.add(title);
      descriptions.add(meta(html, 'name', 'description'));

      assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
      assert.equal(meta(html, 'property', 'og:url'), url);
      assert.equal(meta(html, 'property', 'og:type'), 'website');
      assert.equal(meta(html, 'property', 'og:title'), title);
      assert.equal(count(html, 'rel="alternate"'), 4);
      for (const code of LANGUAGES) {
        assert.ok(html.includes(`<link rel="alternate" hreflang="${code}" href="${urlFor(code, 'service', service.slug)}">`));
        assert.ok(siteHeader(html).includes(`href="${routeFor(code, 'service', service.slug)}" class="lang-btn`), `${lang}/${service.slug} language link ${code}`);
      }
      assert.ok(html.includes(`<link rel="alternate" hreflang="x-default" href="${urlFor('he', 'service', service.slug)}">`));

      const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'];
      assert.deepEqual(graph.map(entry => entry['@type']), ['Person', 'WebSite', 'Service', 'BreadcrumbList']);
      assert.deepEqual(graph[2], { '@type': 'Service', '@id': `${url}#service`, name: training ? training.title[lang] : marketing ? marketing.heading[lang] : service.title[lang], description: training ? training.meta_description[lang] : marketing ? marketing.meta_description[lang] : service.description[lang], url, provider: { '@id': 'https://katya-alon.com/#person' } });
      assert.deepEqual(graph[3].itemListElement.map(item => item.item), [urlFor(lang, 'home'), url]);

      const main = html.match(/<main\b[\s\S]*<\/main>/)[0];
      for (const value of service.page || marketing || training ? [] : [service.details.summary, ...service.details.tech_points, ...service.details.second_tech_points, ...service.details.body]) {
        assert.ok(main.includes(t(value)), `${lang}/${service.slug}: missing ${value[lang]}`);
      }
      assert.equal(main.includes(`<h2>${t(site.services.includes_title)}</h2>`) && main.includes(`<h2>${t(site.services.results_title)}</h2>`), !service.page && !marketing && !training);
      assert.equal(count(main, 'href="https://wa.me/'), service.page ? 3 : 1);
      assert.ok(main.includes(`<a href="${t(service.details.contact_cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${t(service.details.contact_cta.label)}</a>`));
      assert.ok(main.includes(`<li><a href="${routeFor(lang, 'home')}">${t(site.nav.home)}</a></li><li aria-current="page">${training ? t(training.title) : marketing ? t(marketing.heading) : t(service.title)}</li>`), 'breadcrumbs');
      for (const other of services.filter(item => item !== service)) {
        assert.ok(main.includes(`<a href="${routeFor(lang, 'service', other.slug)}">${t(other.card_title || other.title)}</a>`), `${lang}/${service.slug} -> ${other.slug}`);
      }
      for (const article of articles.filter(item => item.service_anchor === service.anchor)) {
        assert.ok(main.includes(`<a href="${routeFor(lang, 'article', article.slug)}">${t(article.title)}</a>`));
      }
    }
  }
  assert.equal(titles.size, 15);
  assert.equal(descriptions.size, 15);
});

test('marketing-strategy has the approved long-form copy, localized SEO, semantic labels, and escaped rendering', () => {
  const service = services.find(item => item.slug === 'marketing-strategy');
  const page = service.marketing_page;
  assert.ok(page, 'marketing-strategy must opt into the long-form page');
  for (const lang of LANGUAGES) {
    const html = readFileSync(fileFor(lang, 'service', service.slug), 'utf8');
    const t = value => escapeHtml(value[lang]);
    assert.ok(html.includes(`<h1>${t(page.heading)}</h1>`));
    assert.ok(html.includes(`<p class="service-lead service-rich-lead"><strong>${t(page.lead)}</strong></p>`));
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], t(page.seo_title));
    assert.equal(meta(html, 'name', 'description'), t(page.meta_description));
    assert.equal(meta(html, 'property', 'og:title'), t(page.seo_title));
    assert.equal(meta(html, 'property', 'og:description'), t(page.meta_description));
    for (const paragraph of [...page.paragraphs, ...page.closing_paragraphs]) assert.ok(html.includes(`<p>${t(paragraph)}</p>`));
    for (const section of [page.includes_title, page.outcomes_title, page.closing_title]) assert.ok(html.includes(`<h2>${t(section)}</h2>`));
    for (const item of page.includes) assert.ok(html.includes(`<li><strong>${t(item.label)}</strong> ${t(item.text)}</li>`));
    for (const item of page.outcomes) assert.ok(html.includes(`<li>${t(item)}</li>`));
    for (const callout of [page.outcome_callout, page.callout]) assert.ok(html.includes(`<strong>${t(callout)}</strong>`));
    assert.ok(html.includes(`<p>${t(page.cta_intro)}</p>`));
  }
  const unsafeContent = read('content/content.yaml').replace('he: ייעוץ שיווקי ואסטרטגיה שיווקית לעסקים', 'he: "<script>"');
  const escaped = renderService(read('scripts/templates/service.html'), unsafeContent, read('content/articles.yaml'), 'marketing-strategy', 'he');
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(!escaped.includes('<h1><script>'));
});

test('social-media-content has the approved long-form copy, exact Hebrew SEO, and no duplicate service route', () => {
  const service = services.find(item => item.slug === 'social-media-content');
  const page = service.marketing_page;
  assert.ok(page, 'social-media-content must opt into the safe rich long-form renderer');
  assert.equal(page.heading.he, 'ניהול סושיאל לעסקים | ניהול אינסטגרם, פייסבוק ופרסום ממומן');
  assert.equal(page.seo_title.he, 'ניהול סושיאל ופרסום ממומן לעסקים | קטיה אלון');
  assert.equal(page.meta_description.he, 'ניהול סושיאל מקצועי עם קטיה אלון. ניהול אינסטגרם ופייסבוק, יצירת תוכן, קידום אורגני, פרסום ממומן במטא ובניית אסטרטגיה שיווקית לעסקים.');
  assert.equal(page.includes.length, 7);
  assert.equal(page.outcomes.length, 6);
  for (const lang of LANGUAGES) {
    const html = readFileSync(fileFor(lang, 'service', service.slug), 'utf8');
    const t = value => escapeHtml(value[lang]);
    assert.ok(html.includes(`<h1>${t(page.heading)}</h1>`));
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], t(page.seo_title));
    assert.equal(meta(html, 'name', 'description'), t(page.meta_description));
    assert.ok(html.includes(`<p class="service-lead service-rich-lead"><strong>${t(page.lead)}</strong></p>`));
    for (const paragraph of [...page.paragraphs, ...page.closing_paragraphs]) assert.ok(html.includes(`<p>${t(paragraph)}</p>`));
    for (const item of page.includes) assert.ok(html.includes(`<li><strong>${t(item.label)}</strong> ${t(item.text)}</li>`));
    for (const outcome of page.outcomes) assert.ok(html.includes(`<li>${t(outcome)}</li>`));
    for (const callout of [page.outcome_callout, page.callout]) assert.ok(html.includes(`<strong>${t(callout)}</strong>`));
  }
  assert.ok(!services.some(item => item.slug === 'social-media-management'));
  assert.ok(!site.services.items.some(item => item.anchor === 'service-personal-guidance'));
  for (const lang of LANGUAGES) assert.ok(!existsSync(fileFor(lang, 'service', 'social-media-management')));
});

test('lectures-workshops has the approved localized long-form page, semantic section order, safe output, and WhatsApp CTA', () => {
  const service = services.find(item => item.slug === 'lectures-workshops');
  const page = service.marketing_page;
  assert.ok(page, 'lectures-workshops must opt into the safe rich long-form renderer');
  assert.equal(page.heading.he, 'הרצאות וסדנאות בשיווק דיגיטלי וברשתות החברתיות');
  assert.equal(page.seo_title.he, 'הרצאות וסדנאות בשיווק דיגיטלי לעסקים | קטיה אלון');
  assert.equal(page.meta_description.he, 'הרצאות וסדנאות בשיווק דיגיטלי עם קטיה אלון. הדרכות אינסטגרם ופייסבוק, אסטרטגיה שיווקית, יצירת תוכן ופרסום ממומן לחברות, ארגונים ובעלי עסקים.');
  assert.equal(page.includes.length, 6);
  assert.equal(page.outcomes.length, 4);
  assert.equal(page.audience_paragraphs.length, 3);
  for (const lang of LANGUAGES) {
    const html = readFileSync(fileFor(lang, 'service', service.slug), 'utf8');
    const t = value => escapeHtml(value[lang]);
    assert.ok(html.includes(`<h1>${t(page.heading)}</h1>`));
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], t(page.seo_title));
    assert.equal(meta(html, 'name', 'description'), t(page.meta_description));
    assert.equal(meta(html, 'property', 'og:title'), t(page.seo_title));
    assert.equal(meta(html, 'property', 'og:description'), t(page.meta_description));
    assert.ok(html.includes(`<p class="service-lead service-rich-lead"><strong>${t(page.lead)}</strong></p>`));
    for (const paragraph of page.paragraphs) assert.ok(html.includes(`<p>${t(paragraph)}</p>`));
    assert.ok(html.includes(`<p><strong>${t(page.intro_callout)}</strong></p>`));
    for (const item of page.includes) assert.ok(html.includes(`<li><strong>${t(item.label)}</strong> ${t(item.text)}</li>`));
    for (const outcome of page.outcomes) assert.ok(html.includes(`<li>${t(outcome)}</li>`));
    assert.ok(html.includes(`<section class="service-intro service-rich-audience"><h2>${t(page.audience_title)}</h2>`));
    for (const paragraph of page.audience_paragraphs) assert.ok(html.includes(`<p>${t(paragraph)}</p>`));
    for (const paragraph of page.closing_paragraphs) assert.ok(html.includes(`<p>${t(paragraph)}</p>`));
    for (const value of [page.includes_title, page.outcomes_title, page.audience_title, page.closing_title]) assert.ok(html.includes(`<h2>${t(value)}</h2>`));
    assert.ok(html.includes(`<strong>${t(page.callout)}</strong>`));
    assert.ok(html.includes(`<p>${t(page.cta_intro)}</p>`));
    assert.ok(html.includes(`<a href="${t(service.details.contact_cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${t(service.details.contact_cta.label)}</a>`));
    const positions = [page.includes_title, page.outcomes_title, page.audience_title, page.closing_title].map(value => html.indexOf(`<h2>${t(value)}</h2>`));
    assert.ok(positions.every((position, index) => position > (positions[index - 1] ?? -1)), `${lang}: semantic H2 order`);
  }
  const unsafeContent = read('content/content.yaml').replace('he: הרצאות וסדנאות בשיווק דיגיטלי וברשתות החברתיות', 'he: "<script>alert(1)</script>"');
  const escaped = renderService(read('scripts/templates/service.html'), unsafeContent, read('content/articles.yaml'), 'lectures-workshops', 'he');
  assert.ok(escaped.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!escaped.includes('<h1><script>'));
});

test('personal social media training is an enabled fifth service with its original localized detail content and WhatsApp inquiry', () => {
  const page = standalonePages.find(item => item.slug === 'personal-social-media-training');
  assert.ok(page);
  assert.ok(services.some(service => service.slug === page.slug), 'training is an enabled service');
  for (const lang of LANGUAGES) {
    const html = readFileSync(fileFor(lang, 'service', page.slug), 'utf8');
    const t = value => escapeHtml(value[lang]);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], t(page.seo_title));
    assert.equal(meta(html, 'name', 'description'), t(page.meta_description));
    assert.equal(meta(html, 'property', 'og:title'), t(page.seo_title));
    assert.equal(meta(html, 'property', 'og:description'), t(page.meta_description));
    assert.ok(html.includes(`<h1>${t(page.title)}</h1>`));
    assert.ok(html.includes(`<p class="service-lead service-rich-lead"><strong>${t(page.lead)}</strong></p>`));
    assert.ok(html.includes(`<p>${t(page.intro)}</p>`));
    assert.ok(html.includes(`<h2>${t(page.first_title)}</h2>`));
    assert.ok(html.includes(`<h2>${t(page.second_title)}</h2>`));
    for (const point of page.first_points) assert.ok(html.includes(`<li>${t(point)}</li>`));
    for (const point of page.second_points) assert.ok(html.includes(`<li><strong>${t(point.label)}</strong> ${t(point.text)}</li>`));
    for (const callout of [page.first_callout, page.second_callout, page.closing_callout]) assert.ok(html.includes(`<strong>${t(callout)}</strong>`));
    assert.ok(html.includes('<hr class="service-divider">'));
    assert.ok(html.includes(`<a href="${t(page.contact_cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${t(page.contact_cta.label)}</a>`));
    const breadcrumbs = html.match(/<nav class="article-breadcrumbs"[\s\S]*?<\/nav>/)[0];
    assert.ok(!breadcrumbs.includes(routeFor(lang, 'service', 'paid-advertising')), 'no false parent breadcrumb');
    for (const code of LANGUAGES) assert.ok(html.includes(`<link rel="alternate" hreflang="${code}" href="${urlFor(code, 'service', page.slug)}">`));
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'];
    assert.deepEqual(graph.map(entry => entry['@type']), ['Person', 'WebSite', 'Service', 'BreadcrumbList']);
    assert.equal(graph[2].url, urlFor(lang, 'service', page.slug));
  }
  const unsafe = read('content/content.yaml').replace('he: הדרכה אישית לשיווק ברשתות החברתיות לבעלי עסקים', 'he: "<script>alert(1)</script>"');
  const escaped = renderService(read('scripts/templates/service.html'), unsafe, read('content/articles.yaml'), page.slug, 'he');
  assert.ok(escaped.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!escaped.includes('<h1><script>'));
});

test('all 51 pages share the accessible top navigation and keep the old footer links', () => {
  assert.equal(pages.length, 51);
  for (const [lang, page, slug] of pages) {
    const html = readFileSync(fileFor(lang, page, slug), 'utf8');
    const header = siteHeader(html);
    const label = page === 'service' ? `${lang}/${slug}` : `${lang}/${page}${slug ? `/${slug}` : ''}`;
    const navs = [...header.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)].map(match => match[1]);
    assert.equal(navs.length, 2, `${label}: desktop and mobile nav`);
    const expectedCurrent = page === 'home' ? routeFor(lang, 'home') : page === 'workshops' ? routeFor(lang, 'workshops')
      : page === 'service' ? routeFor(lang, 'service', slug) : page === 'podcasts' ? null : routeFor(lang, 'articles');
    for (const [index, nav] of navs.entries()) {
      const menuId = `services-menu-${index ? 'mobile' : 'desktop'}`;
      assert.ok(nav.startsWith(`<a href="${routeFor(lang, 'home')}" class="nav-link" data-home-link`), `${label}: home link first`);
      assert.ok(nav.includes(`>${escapeHtml(site.nav.home[lang])}</a>`));
      assert.match(nav, new RegExp(`<button type="button" class="nav-link nav-dropdown-toggle(?: nav-link-current)?" aria-expanded="false" aria-controls="${menuId}" data-nav-dropdown>${escapeHtml(site.nav.services[lang])}<svg class="nav-dropdown-icon" aria-hidden="true"`));
      const menu = nav.match(new RegExp(`<ul id="${menuId}" class="nav-dropdown-menu" hidden>([\\s\\S]*?)</ul>`))?.[1];
      assert.deepEqual([...menu.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]), services.map(service => routeFor(lang, 'service', service.slug)), `${label}: all service pages`);
      for (const service of services) assert.ok(menu.includes(`>${escapeHtml((service.card_title || service.title)[lang])}</a>`));
      assert.ok(nav.includes(`<a href="${routeFor(lang, 'workshops')}" class="nav-link" data-workshops-link`));
      assert.ok(nav.includes(`>${escapeHtml(site.nav.articles[lang])}</a>`), `${label}: short articles label`);
      assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map(match => match[1]), page === 'podcasts' ? [] : [expectedCurrent], `${label}: current page`);
    }
    assert.doesNotMatch(header, /href="[^"]*#(?:about|services|process|contact)"/, `${label}: no section anchors in the top nav`);
    assert.ok(!header.includes(escapeHtml(site.footer.articles[lang])), `${label}: long articles label stays out of the header`);
    assert.equal(count(html, 'data-nav-dropdown'), 2);
    assert.ok(html.includes('<script defer src="/js/nav.js"></script>'), `${label}: nav.js`);

    const footer = html.match(/<footer\b[\s\S]*<\/footer>/)[0];
    for (const anchor of ['about', 'process', 'services']) assert.ok(footer.includes(`${routeFor(lang, 'home')}#${anchor}"`), `${label}: footer #${anchor}`);
    assert.ok(footer.includes(`>${escapeHtml(site.footer.articles[lang])}</a>`), `${label}: footer keeps the full articles label`);
  }
  const home = readFileSync(fileFor('he', 'home', ''), 'utf8');
  for (const section of ['about', 'services', 'process', 'contact']) assert.ok(home.includes(`<section id="${section}"`), `home #${section}`);
});

test('every article links its related service page', () => {
  for (const lang of LANGUAGES) {
    for (const article of articles) {
      const service = services.find(item => item.anchor === article.service_anchor);
      const related = readFileSync(fileFor(lang, 'article', article.slug), 'utf8').match(/<aside class="article-related"[\s\S]*?<\/aside>/)[0];
      assert.ok(related.includes(`<a href="${routeFor(lang, 'service', service.slug)}">`), `${lang}/${article.slug}`);
      assert.ok(existsSync(fileFor(lang, 'service', service.slug)));
    }
  }
});

test('each home card keeps its modal, whose CTA links to that service page in every language', () => {
  const indexHtml = read('index.html');
  const modal = indexHtml.match(/<div id="service-modal"[\s\S]*?<!-- ═+ Audience/)[0];
  assert.doesNotMatch(modal, /wa\.me|modal-contact/, 'the modal no longer carries the WhatsApp CTA');
  // An internal link: same tab, no target/rel attributes.
  assert.match(modal, /<a\s+id="modal-service-link"\s+href="#"\s+class="cta-secondary cta-image-button[^"]*"\s*><\/a>/);
  assert.match(modal, /data-content="services\.includes_title"><\/h4>[\s\S]*data-content="services\.results_title"><\/h4>/);

  for (const lang of LANGUAGES) {
    const home = readFileSync(fileFor(lang, 'home', ''), 'utf8');
    for (const service of services) {
      const index = [...site.services.items, ...standalonePages].indexOf(service);
      const cardTitle = service.card_title || service.title;
      assert.match(home, new RegExp(`<button\\s+id="${service.anchor}"[^>]*data-service-index="${index}"\\s+onclick="openServiceModal\\(${index}\\)"[\\s\\S]*?service-card-title-theme">${escapeHtml(cardTitle[lang])}<`), `${lang}: card ${service.anchor}`);
    }
  }

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { id, textContent: '', innerHTML: '', href: '#', classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(id);
  };
  const document = { body: { classList: { add() {}, remove() {} } }, getElementById: element, querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ document, window: { location: new URL('https://katya-alon.com/') }, console });
  vm.runInContext(read('js/main.js'), context);
  context.__content = site;
  vm.runInContext('siteContent = __content;', context);
  for (const lang of LANGUAGES) {
    vm.runInContext(`currentLang = "${lang}";`, context);
    for (const service of services) {
      vm.runInContext(`openServiceModal(${[...site.services.items, ...standalonePages].indexOf(service)});`, context);
      assert.equal(element('modal-title').textContent, (service.card_title || service.title)[lang]);
      assert.equal(element('modal-service-link').href, routeFor(lang, 'service', service.slug), `${lang}: ${service.slug}`);
      assert.equal(element('modal-service-link').textContent, site.services.learn_more[lang]);
    }
  }
});

test('radial service effects use the rendered card position, including the fifth enabled card', () => {
  const styles = () => {
    const values = new Map();
    return { values, setProperty: (name, value) => values.set(name, value) };
  };
  const cards = [
    [0, { left: 465, top: 55, width: 270, height: 150 }],
    [1, { left: 150, top: 280, width: 270, height: 150 }],
    [2, { left: 780, top: 280, width: 270, height: 150 }],
    [3, { left: 220, top: 620, width: 270, height: 150 }],
    // The fifth rendered card has source index 5 because index 4 is disabled.
    [5, { left: 710, top: 620, width: 270, height: 150 }]
  ].map(([sourceIndex, rect]) => {
    const node = { dataset: { serviceIndex: String(sourceIndex) }, style: styles(), getBoundingClientRect: () => rect };
    node.closest = selector => selector === '.service-row' ? node : null;
    return node;
  });
  const lines = Array.from({ length: 5 }, () => ({ style: styles() }));
  const section = { classList: { contains: name => name === 'services-layout-radial' } };
  const list = { contains: node => cards.includes(node), querySelectorAll: selector => selector === '.service-row' ? cards : [] };
  const diagram = {
    style: styles(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 900 }),
    querySelectorAll: selector => selector === '.services-lines-path' ? lines : []
  };
  const document = {
    getElementById: id => ({ services: section, 'services-diagram': diagram, 'services-list': list })[id] || null,
    querySelectorAll: selector => selector === '#services-list .service-row' ? cards : selector === '#services-diagram .services-lines-path' ? lines : [],
    addEventListener() {}
  };
  const window = { innerWidth: 1440, matchMedia: () => ({ matches: true }), addEventListener() {} };
  const context = vm.createContext({ document, window, console });
  vm.runInContext(read('js/main.js'), context);
  context.event = { target: cards[4], clientX: 845, clientY: 695 };
  vm.runInContext('handleServicesDiagramPointerMove(event);', context);

  assert.equal(cards[4].style.values.get('--service-hover'), '1.000');
  assert.equal(cards[4].style.values.get('--service-group-z'), '4');
  assert.equal(lines[4].style.values.get('--line-active'), '1.000');
});

test('the top radial card stays centered on the vertical connector at both desktop width rules', () => {
  const css = read('css/styles.css');
  const finalTopCardRule = [...css.matchAll(/\.service-card-pos-1\s*\{([^}]*)\}/g)].at(-1)?.[1];
  assert.match(finalTopCardRule, /left:\s*50%/);
  assert.match(finalTopCardRule, /translate:\s*-50% 0/);
  assert.doesNotMatch(finalTopCardRule, /transform:/);

  for (const [viewport, cardWidth] of [[1200, 270], [1440, 310]]) {
    const cardLeft = (viewport * 0.5) - (cardWidth * 0.5);
    assert.equal(cardLeft + (cardWidth * 0.5), viewport * 0.5, `${viewport}px connector alignment`);
  }
});

test('services disclosure toggles aria-expanded and closes on Escape, outside taps, link clicks and focus loss', () => {
  const listeners = {};
  const document = {
    activeElement: null,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    querySelectorAll: selector => (selector === '[data-nav-dropdown]' ? buttons : []),
    getElementById: id => all.find(node => node.id === id)
  };
  const node = (parent, { id = '', className = '', attrs = {} } = {}) => {
    const self = {
      id, className, parentElement: parent, hidden: false, attrs: { ...attrs },
      getAttribute: name => self.attrs[name] ?? null,
      setAttribute: (name, value) => { self.attrs[name] = String(value); },
      contains: other => { for (let at = other; at; at = at.parentElement) if (at === self) return true; return false; },
      closest: selector => {
        for (let at = self; at; at = at.parentElement) {
          if (selector === '.nav-dropdown' ? at.className.split(' ').includes('nav-dropdown') : Object.hasOwn(at.attrs, selector.slice(1, -1))) return at;
        }
        return null;
      },
      querySelector: selector => all.find(other => other !== self && self.contains(other) && other.closest(selector) === other),
      focus: () => { document.activeElement = self; }
    };
    all.push(self);
    return self;
  };
  const all = [];
  const page = node(null);
  const dropdown = (suffix) => {
    const wrapper = node(page, { className: 'nav-dropdown' });
    const button = node(wrapper, { attrs: { 'data-nav-dropdown': '', 'aria-expanded': 'false', 'aria-controls': `menu-${suffix}` } });
    const menu = node(wrapper, { id: `menu-${suffix}` });
    menu.hidden = true;
    return { button, menu, link: node(menu) };
  };
  const desktop = dropdown('desktop');
  const mobile = dropdown('mobile');
  const outside = node(page);
  const buttons = [desktop.button, mobile.button];
  vm.runInContext(read('js/nav.js'), vm.createContext({ document }));
  const isOpen = ({ button, menu }) => {
    assert.equal(button.getAttribute('aria-expanded') === 'true', !menu.hidden, 'aria-expanded matches visibility');
    return !menu.hidden;
  };
  const open = target => { if (!isOpen(target)) listeners.click({ target: target.button }); assert.ok(isOpen(target)); };

  listeners.click({ target: desktop.button });
  assert.ok(isOpen(desktop));
  listeners.click({ target: desktop.button });
  assert.ok(!isOpen(desktop), 'second activation closes');

  open(desktop);
  listeners.click({ target: mobile.button });
  assert.ok(isOpen(mobile) && !isOpen(desktop), 'only one disclosure is open');

  listeners.pointerdown({ target: mobile.link });
  assert.ok(isOpen(mobile), 'tapping inside keeps it open');
  listeners.pointerdown({ target: outside });
  assert.ok(!isOpen(mobile), 'outside tap closes');

  open(desktop);
  listeners.click({ target: desktop.link });
  assert.ok(!isOpen(desktop), 'choosing a service closes the menu');

  open(desktop);
  document.activeElement = desktop.link;
  listeners.keydown({ key: 'Tab' });
  assert.ok(isOpen(desktop));
  listeners.keydown({ key: 'Escape' });
  assert.ok(!isOpen(desktop), 'Escape closes');
  assert.equal(document.activeElement, desktop.button, 'Escape returns focus to the toggle');

  open(desktop);
  listeners.focusout({ target: desktop.button, relatedTarget: desktop.link });
  assert.ok(isOpen(desktop), 'focus moving into the menu keeps it open');
  listeners.focusout({ target: desktop.link, relatedTarget: null });
  assert.ok(isOpen(desktop), 'focus leaving to nothing is handled by pointer events');
  listeners.focusout({ target: desktop.link, relatedTarget: outside });
  assert.ok(!isOpen(desktop), 'tabbing away closes');
});

test('release HTML references content-hashed CSS/JS so a cached older script can never run with newer markup', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-versioned-'));
  try {
    for (const dir of ['css', 'js']) cpSync(new URL(`../${dir}`, import.meta.url), join(stage, dir), { recursive: true });
    for (const file of ['index.html', 'workshops.html']) cpSync(new URL(`../${file}`, import.meta.url), join(stage, file));
    buildPages(stage);
    const html = readFileSync(join(stage, 'index.html'), 'utf8');
    const hash = file => createHash('sha256').update(readFileSync(join(stage, file))).digest('hex').slice(0, 10);
    for (const file of ['css/styles.css', 'css/tailwind.css', 'js/main.js', 'js/nav.js']) {
      assert.ok(html.includes(`"/${file}?v=${hash(file)}"`), file);
    }
    for (const lang of LANGUAGES) for (const service of services) {
      const page = readFileSync(join(stage, lang === 'he' ? '' : lang, 'services', service.slug, 'index.html'), 'utf8');
      assert.ok(page.includes(`"/js/nav.js?v=${hash('js/nav.js')}"`), `${lang}/${service.slug}`);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});
