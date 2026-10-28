import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import yaml from 'js-yaml';
import { buildPages, enabledServices, escapeHtml, LANGUAGES, routeFor, urlFor } from '../scripts/build-pages.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const site = yaml.load(read('content/content.yaml'));
const { articles } = yaml.load(read('content/articles.yaml'));
const services = enabledServices(site);
const count = (html, needle) => html.split(needle).length - 1;
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1];
const siteHeader = html => html.match(/<header\b[\s\S]*?<\/header>/)[0];
const EXPECTED = [
  ['ייעוץ ואסטרטגיה שיווקית', 'marketing-strategy', 'service-marketing-strategy'],
  ['ניהול דפי סושיאל', 'social-media-management', 'service-personal-guidance'],
  ['ניהול סושיאל ויצירת תוכן', 'social-media-content', 'service-social-media-content'],
  ['פרסום ממומן בפייסבוק ובאינסטגרם', 'paid-advertising', 'service-paid-advertising'],
  ['הרצאות וסדנאות בשיווק דיגיטלי', 'lectures-workshops', 'service-workshops']
];

const pages = LANGUAGES.flatMap(lang => [
  [lang, 'home', ''], [lang, 'workshops', ''], [lang, 'articles', ''],
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

test('five distinct services keep stable slugs, and the legacy anchor belongs to ניהול דפי סושיאל', () => {
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
      assert.match(html, new RegExp(`^<!doctype html>\\n<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`));
      assert.equal(count(html, '<h1'), 1);
      assert.ok(html.includes(`<h1>${t(service.title)}</h1>`));
      const title = html.match(/<title>([^<]*)<\/title>/)[1];
      assert.equal(title, `${t(service.title)} | ${t(site.hero.name)}`);
      assert.equal(meta(html, 'name', 'description'), t(service.description));
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
      assert.deepEqual(graph[2], { '@type': 'Service', '@id': `${url}#service`, name: service.title[lang], description: service.description[lang], url, provider: { '@id': 'https://katya-alon.com/#person' } });
      assert.deepEqual(graph[3].itemListElement.map(item => item.item), [urlFor(lang, 'home'), url]);

      const main = html.match(/<main\b[\s\S]*<\/main>/)[0];
      for (const value of [service.details.summary, ...service.details.tech_points, ...service.details.second_tech_points, ...service.details.body]) {
        assert.ok(main.includes(t(value)), `${lang}/${service.slug}: missing ${value[lang]}`);
      }
      assert.ok(main.includes(`<h2>${t(site.services.includes_title)}</h2>`) && main.includes(`<h2>${t(site.services.results_title)}</h2>`));
      assert.equal(count(main, 'href="https://wa.me/'), 1);
      assert.ok(main.includes(`<a href="${t(service.details.contact_cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${t(service.details.contact_cta.label)}</a>`));
      assert.ok(main.includes(`<li><a href="${routeFor(lang, 'home')}">${t(site.nav.home)}</a></li><li aria-current="page">${t(service.title)}</li>`), 'breadcrumbs');
      for (const other of services.filter(item => item !== service)) {
        assert.ok(main.includes(`<a href="${routeFor(lang, 'service', other.slug)}">${t(other.title)}</a>`), `${lang}/${service.slug} -> ${other.slug}`);
      }
      for (const article of articles.filter(item => item.service_anchor === service.anchor)) {
        assert.ok(main.includes(`<a href="${routeFor(lang, 'article', article.slug)}">${t(article.title)}</a>`));
      }
    }
  }
  assert.equal(titles.size, 15);
  assert.equal(descriptions.size, 15);
});

test('all 39 pages share the accessible top navigation and keep the old footer links', () => {
  assert.equal(pages.length, 39);
  for (const [lang, page, slug] of pages) {
    const html = readFileSync(fileFor(lang, page, slug), 'utf8');
    const header = siteHeader(html);
    const label = page === 'service' ? `${lang}/${slug}` : `${lang}/${page}${slug ? `/${slug}` : ''}`;
    const navs = [...header.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)].map(match => match[1]);
    assert.equal(navs.length, 2, `${label}: desktop and mobile nav`);
    const expectedCurrent = page === 'home' ? routeFor(lang, 'home') : page === 'workshops' ? routeFor(lang, 'workshops')
      : page === 'service' ? routeFor(lang, 'service', slug) : routeFor(lang, 'articles');
    for (const [index, nav] of navs.entries()) {
      const menuId = `services-menu-${index ? 'mobile' : 'desktop'}`;
      assert.ok(nav.startsWith(`<a href="${routeFor(lang, 'home')}" class="nav-link" data-home-link`), `${label}: home link first`);
      assert.ok(nav.includes(`>${escapeHtml(site.nav.home[lang])}</a>`));
      assert.match(nav, new RegExp(`<button type="button" class="nav-link nav-dropdown-toggle(?: nav-link-current)?" aria-expanded="false" aria-controls="${menuId}" data-nav-dropdown>${escapeHtml(site.nav.services[lang])}<svg class="nav-dropdown-icon" aria-hidden="true"`));
      const menu = nav.match(new RegExp(`<ul id="${menuId}" class="nav-dropdown-menu" hidden>([\\s\\S]*?)</ul>`))?.[1];
      assert.deepEqual([...menu.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]), services.map(service => routeFor(lang, 'service', service.slug)), `${label}: all service pages`);
      for (const service of services) assert.ok(menu.includes(`>${escapeHtml(service.title[lang])}</a>`));
      assert.ok(nav.includes(`<a href="${routeFor(lang, 'workshops')}" class="nav-link" data-workshops-link`));
      assert.ok(nav.includes(`>${escapeHtml(site.nav.articles[lang])}</a>`), `${label}: short articles label`);
      assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map(match => match[1]), [expectedCurrent], `${label}: current page`);
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
      const index = site.services.items.indexOf(service);
      assert.match(home, new RegExp(`<button\\s+id="${service.anchor}"[^>]*data-service-index="${index}"\\s+onclick="openServiceModal\\(${index}\\)"[\\s\\S]*?service-card-title-theme">${escapeHtml(service.title[lang])}<`), `${lang}: card ${service.anchor}`);
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
      vm.runInContext(`openServiceModal(${site.services.items.indexOf(service)});`, context);
      assert.equal(element('modal-title').textContent, service.title[lang]);
      assert.equal(element('modal-service-link').href, routeFor(lang, 'service', service.slug), `${lang}: ${service.slug}`);
      assert.equal(element('modal-service-link').textContent, site.services.learn_more[lang]);
    }
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
