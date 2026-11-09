// Prerenders all canonical language variants of the home, workshop, article index, article, podcast, and service pages.
// Source HTML and content/*.yaml stay the only truth; the output is never committed. JS still hydrates/replaces the same nodes.
// Usage: node scripts/build-pages.mjs <stage-dir>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import yaml from 'js-yaml';

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');
export const SITE_URL = 'https://katya-alon.com/';
export const LANGUAGES = ['he', 'en', 'ru'];
const LAYOUTS = ['conversion', 'story', 'program'];
const LOCALES = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' };
const OG_LOCALES = { he: 'he_IL', en: 'en_US', ru: 'ru_RU' };
const PERSON_ID = new URL('#person', SITE_URL).href;
const WEBSITE_ID = new URL('#website', SITE_URL).href;
const SOCIAL_IMAGE = {
  url: new URL('assets/images/katya-1.webp', SITE_URL).href,
  type: 'image/webp',
  width: 683,
  height: 1024
};

export const routeFor = (lang, page, slug = '') => {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  if (!['home', 'workshops', 'articles', 'article', 'podcasts', 'service'].includes(page)) throw new Error(`build-pages: unsupported page ${page}`);
  const prefix = lang === 'he' ? '/' : `/${lang}/`;
  if (page === 'home') return prefix;
  if (page === 'workshops') return `${prefix}workshops.html`;
  if (page === 'articles') return `${prefix}articles/`;
  if (page === 'podcasts') return `${prefix}podcasts/`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`build-pages: unsafe ${page} slug ${slug}`);
  return `${prefix}${page === 'service' ? 'services' : 'articles'}/${slug}/`;
};

export const urlFor = (lang, page, slug = '') => new URL(routeFor(lang, page, slug), SITE_URL).href;

// Home-page card order; each enabled service also gets its own page. Long-form
// records may retain their original standalone_pages location while becoming active.
export const enabledServices = site => [...site.services.items, ...(site.services.standalone_pages || [])]
  .filter(item => item.enabled !== false)
  .sort((a, b) => a.display_order - b.display_order);

const serviceCardTitle = service => service.card_title || service.title;

export const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const escapeDeep = value => (typeof value === 'string' ? escapeHtml(value)
  : Array.isArray(value) ? value.map(escapeDeep)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeDeep(v)]))
  : value);

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`build-pages: missing text for ${label}`);
  return value;
}

function assertLocaleMaps(value, path = 'content', { allowEmpty = false } = {}) {
  if (!value || typeof value !== 'object') return;
  if (LANGUAGES.some(lang => Object.hasOwn(value, lang))) {
    for (const lang of LANGUAGES) {
      if (typeof value[lang] !== 'string' || (!allowEmpty && !value[lang].trim())) {
        throw new Error(`build-pages: missing ${lang} translation for ${path}`);
      }
    }
  }
  for (const [key, nested] of Object.entries(value)) assertLocaleMaps(nested, `${path}.${key}`, { allowEmpty });
}

// Replaces the inner HTML of every empty element carrying `attr="key"`; every such element must be filled.
function fillByAttr(html, attr, inner) {
  const total = html.split(` ${attr}="`).length - 1;
  let filled = 0;
  const out = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\s${attr}="([^"]+)"[^>]*>)\\s*(</\\2>)`, 'g'), (_m, open, _tag, key, close) => {
    filled += 1;
    return open + required(inner(key), `${attr}="${key}"`) + close;
  });
  if (filled !== total) throw new Error(`build-pages: ${total - filled} ${attr} element(s) are not empty and could not be prerendered`);
  return out;
}

// Replaces the inner HTML of the single empty element with this id.
function fillById(html, id, inner) {
  let count = 0;
  const out = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\sid="${id}"[^>]*>)\\s*(</\\2>)`, 'g'), (_m, open, _tag, close) => {
    count += 1;
    return open + inner + close;
  });
  if (count !== 1) throw new Error(`build-pages: expected one empty #${id}, found ${count}`);
  return out;
}

function replaceOnce(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) || [];
  if (matches.length !== 1) throw new Error(`build-pages: expected one ${label}, found ${matches.length}`);
  return html.replace(pattern, replacement);
}

// Title and description are already HTML-escaped; structured-data values are raw source text.
function jsonLd({ siteName, lang, extraGraph = [] }) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': PERSON_ID,
        name: 'Katya Alon',
        url: SITE_URL,
        image: {
          '@type': 'ImageObject',
          url: SOCIAL_IMAGE.url,
          width: SOCIAL_IMAGE.width,
          height: SOCIAL_IMAGE.height
        }
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: SITE_URL,
        name: required(siteName, 'structured data site name'),
        inLanguage: LOCALES[lang],
        publisher: { '@id': PERSON_ID }
      },
      ...extraGraph
    ]
  }).replaceAll('<', '\\u003c');
}

function withHead(html, { title, description, url, lang, siteName, imageAlt, page = 'home', slug = '', ogType = 'website', extraGraph = [] }) {
  const stripped = html
    .replace(/^[ \t]*<meta (?:name="(?:description|twitter:[a-z]+)"|property="og:[a-z_:]+")[^>]*>\n/gm, '')
    .replace(/^[ \t]*<link rel="(?:canonical|alternate)"[^>]*>\n/gm, '');
  const alternates = [...LANGUAGES.map(code => `<link rel="alternate" hreflang="${code}" href="${urlFor(code, page, slug)}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlFor('he', page, slug)}">`];
  const meta = [
    `<title>${required(title, 'title')}</title>`,
    `<meta name="description" content="${required(description, 'description')}">`,
    `<link rel="canonical" href="${url}">`,
    ...alternates,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:locale" content="${OG_LOCALES[lang]}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${SOCIAL_IMAGE.url}">`,
    `<meta property="og:image:secure_url" content="${SOCIAL_IMAGE.url}">`,
    `<meta property="og:image:type" content="${SOCIAL_IMAGE.type}">`,
    `<meta property="og:image:width" content="${SOCIAL_IMAGE.width}">`,
    `<meta property="og:image:height" content="${SOCIAL_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${escapeHtml(required(imageAlt, 'social image alt'))}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:image" content="${SOCIAL_IMAGE.url}">`,
    `<script type="application/ld+json">${jsonLd({ siteName, lang, extraGraph })}</script>`
  ].join('\n  ');
  return replaceOnce(stripped, /<title>[^<]*<\/title>/, meta, '<title>');
}

// Home: runs the real js/main.js renderers against escaped content and a recording DOM stub, so markup never drifts.
export function renderHome(html, contentYaml, lang = 'he', mainJs = read('js/main.js'), articlesYaml = read('content/articles.yaml')) {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  const rawContent = yaml.load(contentYaml);
  const rawArticles = yaml.load(articlesYaml);
  assertLocaleMaps(rawContent);
  assertLocaleMaps(rawArticles, 'articles', { allowEmpty: true });
  const content = escapeDeep(rawContent);
  const articles = escapeDeep(rawArticles);
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', innerHTML: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } });
    return nodes.get(key);
  };
  const containers = ['about-paragraphs', 'trust-facts', 'services-list', 'audience-list', 'process-list', 'home-articles-list'];
  const dataKey = selector => selector.match(/^\[data-content="([^"]+)"\]$/)?.[1];
  const document = {
    title: '',
    getElementById: id => (containers.includes(id) ? node(`#${id}`) : null),
    querySelector: selector => (dataKey(selector) ? node(dataKey(selector)) : null),
    querySelectorAll: selector => (dataKey(selector) ? [node(dataKey(selector))] : []),
    addEventListener() {}
  };
  const context = vm.createContext({ document, window: { innerWidth: 0, addEventListener() {} }, console, __content: content, __articles: articles });
  vm.runInContext(mainJs, context, { filename: 'js/main.js' });
  vm.runInContext(`siteContent = __content; siteArticles = __articles; currentLang = "${lang}"; renderContent("${lang}");`, context);

  let out = fillByAttr(html, 'data-content', key => node(key).textContent);
  for (const id of containers) out = fillById(out, id, required(node(`#${id}`).innerHTML, `#${id}`));
  out = replaceOnce(out, /<div id="process-list" /, `<div id="process-list" dir="${node('#process-list').attributes.dir}" `, '#process-list');
  out = fillSiteNav(out, rawContent, lang, 'home');
  out = replaceOnce(out, /<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`, '<html language>');
  out = setPageLinks(out, lang, 'home');
  out = setLanguageLinks(out, lang, 'home');
  return withHead(out, {
    title: document.title,
    description: content.site.description[lang],
    url: urlFor(lang, 'home'),
    lang,
    siteName: rawContent.site.title[lang],
    imageAlt: rawContent.hero.portrait_placeholder[lang],
    page: 'home'
  });
}

// Workshops: mirrors the Hebrew text-only output of js/workshops.js (renderHero/renderSections/renderPricing/renderInstructor).
export function renderWorkshops(html, workshopYaml, lang = 'he', contentYaml = read('content/content.yaml')) {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  const w = yaml.load(workshopYaml);
  const siteContent = yaml.load(contentYaml);
  assertLocaleMaps(w, 'workshop', { allowEmpty: true });
  assertLocaleMaps(siteContent);
  if (!LAYOUTS.includes(w?.layout)) throw new Error('build-pages: workshop layout must be conversion, story, or program');
  const event = w.event;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event?.first_session_date)) throw new Error('build-pages: event.first_session_date is required');

  const date = new Date(`${event.first_session_date}T00:00:00Z`);
  const part = options => new Intl.DateTimeFormat(LOCALES[lang], { timeZone: 'UTC', ...options }).formatToParts(date)
    .filter(p => ['day', 'month', 'year', 'literal'].includes(p.type)).map(p => p.value).join('').replace(/\s*г\.$/, '').trim();
  const tokens = {
    'event.sessions': String(event.session_count),
    'event.hours': String(event.total_hours),
    'event.date': part({ day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
    'event.date_short': part({ day: 'numeric', month: 'short', year: 'numeric' }),
    'event.date_long': part({ day: 'numeric', month: 'long', year: 'numeric' })
  };
  const translated = value => (typeof value === 'string' ? value : value?.[lang] || '')
    .replace(/\{(event\.[a-z_]+)\}/g, (match, key) => (key in tokens ? tokens[key] : match));
  const at = path => path.split('.').reduce((v, k) => (v && Object.hasOwn(v, k) ? v[k] : undefined), w);
  const text = value => escapeHtml(translated(value));
  const tag = (name, className, value) => `<${name}${className ? ` class="${className}"` : ''}>${text(value)}</${name}>`;

  const siteAt = path => path.split('.').reduce((v, k) => (v && Object.hasOwn(v, k) ? v[k] : undefined), siteContent);
  let out = fillByAttr(html, 'data-copy', key => text(at(key)));
  out = fillByAttr(out, 'data-site-copy', key => escapeHtml(siteAt(key)?.[lang] || ''));
  out = replaceOnce(out, /(<body class="[^"]*)\blayout-conversion\b/, `$1layout-${w.layout}`, 'body layout class');
  const set = (id, value) => { out = fillById(out, id, value); };
  const setText = (id, value) => set(id, text(value));

  setText('layout-label', w.layout_labels?.[w.layout]);
  setText('hero-eyebrow', at('hero.eyebrow'));
  set('workshop-title', required(text(at('hero.title')), 'hero.title'));
  setText('hero-subtitle', at('hero.subtitle'));
  setText('hero-description', at('hero.description'));
  setText('details-kicker', at('hero.details_kicker'));
  setText('details-heading', at('hero.details_heading'));
  set('hero-details-list', (w.hero.details || []).map(d => `<div class="hero-detail">${tag('dt', '', d.label)}${tag('dd', '', d.value)}</div>`).join(''));

  const sections = w.sections || {};
  if (sections.content_1 === true) {
    setText('content-1-kicker', at('content_1.kicker'));
    setText('content-1-title', at('content_1.title'));
    set('content-1-paragraphs', (w.content_1.paragraphs || []).map(p => tag('p', '', p)).join(''));
    setText('cta-1', at('ctas.after_content_1'));
  }
  if (sections.content_2 === true) {
    setText('content-2-kicker', at('content_2.kicker'));
    setText('content-2-title', at('content_2.title'));
    setText('content-2-intro', at('content_2.intro'));
    set('content-2-items', (w.content_2.items || []).map((item, i) => `<li class="workshop-item"><span class="workshop-item-number">${String(i + 1).padStart(2, '0')}</span>${tag('h3', 'workshop-item-title', item.title)}${tag('p', 'workshop-item-text', item.text)}</li>`).join(''));
    setText('cta-2', at('ctas.after_power_image'));
  }
  if (sections.content_3 === true) {
    setText('content-3-kicker', at('content_3.kicker'));
    setText('content-3-title', at('content_3.title'));
    setText('content-3-intro', at('content_3.intro'));
    set('content-3-items', (w.content_3.items || []).map(item => `<div class="faq-item">${tag('dt', 'faq-question', item.question)}${tag('dd', 'faq-answer', item.answer)}</div>`).join(''));
  }

  const pricing = w.pricing;
  if (sections.pricing === true && pricing) {
    const price = amount => (Number.isFinite(Number(amount)) ? new Intl.NumberFormat(LOCALES[lang]).format(Number(amount)) : '');
    const fill = (template, amount) => translated(template)
      .replaceAll('{price}', price(amount)).replaceAll('{total}', price(pricing.current_price)).replaceAll('{count}', price(pricing.session_count))
      .replaceAll('{currency}', translated(pricing.currency)).replaceAll('{vat}', translated(pricing.vat_text));
    setText('pricing-kicker', pricing.kicker);
    setText('pricing-title', pricing.title);
    setText('pricing-intro', pricing.intro);
    set('pricing-original', `<del>${escapeHtml(fill(pricing.original_label, pricing.original_price))}</del>`);
    setText('pricing-current', fill(pricing.current_label, pricing.current_price));
    setText('pricing-breakdown', fill(pricing.breakdown_label, pricing.per_session_price));
    setText('pricing-deadline', pricing.deadline);
    setText('pricing-after', fill(pricing.after_deadline, pricing.original_price));
    setText('pricing-cta', pricing.cta);
  }

  const instructor = w.instructor;
  if (sections.instructor === true && instructor) {
    setText('instructor-kicker', instructor.kicker);
    setText('instructor-title', instructor.title);
    setText('instructor-caption', `${translated(instructor.title)}, ${translated(instructor.role)}`);
    set('instructor-bio', (instructor.paragraphs || []).map(p => tag('p', '', p)).join(''));
  }

  out = fillSiteNav(out, siteContent, lang, 'workshops');
  setText('form-kicker', at('form.kicker'));
  setText('registration-title', at('form.title'));
  setText('form-intro', at('form.intro'));

  const unresolved = out.match(/\{(?:event\.[a-z_]+|price|total|count|currency|vat)\}/);
  if (unresolved) throw new Error(`build-pages: unresolved token ${unresolved[0]} in workshops.html`);
  out = replaceOnce(out, /<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`, '<html language>');
  out = setPageLinks(out, lang, 'workshops');
  out = setLanguageLinks(out, lang, 'workshops');
  return withHead(out, {
    title: text(at('meta.title')),
    description: text(at('meta.description')),
    url: urlFor(lang, 'workshops'),
    lang,
    siteName: translated(instructor.title),
    imageAlt: translated(instructor.image.alt),
    page: 'workshops'
  });
}

function setLanguageLinks(html, activeLang, page, slug = '') {
  let out = html;
  for (const lang of LANGUAGES) {
    const active = lang === activeLang;
    const pattern = new RegExp(`<a href="[^"]*" class="lang-btn ([^"]*)" id="btn-${lang}"(?: aria-current="page")?>`);
    out = replaceOnce(out, pattern, (_match, classes) => {
      const nextClasses = classes.split(/\s+/).filter(value => value && value !== 'active');
      if (active) nextClasses.push('active');
      return `<a href="${routeFor(lang, page, slug)}" class="lang-btn ${nextClasses.join(' ')}" id="btn-${lang}"${active ? ' aria-current="page"' : ''}>`;
    }, `#btn-${lang}`);
  }
  return out;
}

function setPageLinks(html, lang, page) {
  return html.replace(/<a\b[^>]*>/g, tag => {
    let href;
    if (tag.includes('data-workshops-link')) href = `${routeFor(lang, 'workshops')}${tag.includes('data-privacy-fragment') ? '#registration-privacy' : ''}`;
    if (tag.includes('data-articles-link')) href = routeFor(lang, 'articles');
    if (tag.includes('data-home-link')) href = routeFor(lang, 'home');
    if (tag.includes('data-home-anchor=')) {
      const anchor = tag.match(/data-home-anchor="([^"]+)"/)?.[1];
      href = `${routeFor(lang, 'home')}#${anchor}`;
    }
    if (page === 'workshops' && tag.includes('id="brand-link"')) href = `${routeFor(lang, 'home')}#hero`;
    return href ? tag.replace(/href="[^"]*"/, `href="${href}"`) : tag;
  });
}

const localized = (value, lang) => required(value?.[lang], `translation.${lang}`);
const BREADCRUMB_LABEL = { he: 'פירורי לחם', en: 'Breadcrumb', ru: 'Навигационная цепочка' };
const CHEVRON = '<svg class="nav-dropdown-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

// The one top navigation for every page: home, a Services disclosure (js/nav.js) listing every service page, workshops, articles.
function siteNav(site, lang, page, slug, menuId) {
  const current = condition => (condition ? ' aria-current="page"' : '');
  const label = key => escapeHtml(localized(site.nav[key], lang));
  const services = enabledServices(site).map(service => `<li><a href="${routeFor(lang, 'service', service.slug)}"${current(page === 'service' && service.slug === slug)}>${escapeHtml(localized(serviceCardTitle(service), lang))}</a></li>`).join('');
  return `<a href="${routeFor(lang, 'home')}" class="nav-link" data-home-link${current(page === 'home')}>${label('home')}</a>`
    + `<div class="nav-dropdown"><button type="button" class="nav-link nav-dropdown-toggle${page === 'service' ? ' nav-link-current' : ''}" aria-expanded="false" aria-controls="${menuId}" data-nav-dropdown>${label('services')}${CHEVRON}</button><ul id="${menuId}" class="nav-dropdown-menu" hidden>${services}</ul></div>`
    + `<a href="${routeFor(lang, 'workshops')}" class="nav-link" data-workshops-link${current(page === 'workshops')}>${label('workshops')}</a>`
    + `<a href="${routeFor(lang, 'articles')}" class="nav-link" data-articles-link${current(page === 'articles' || page === 'article')}>${label('articles')}</a>`;
}

// index.html and workshops.html keep empty desktop/mobile nav containers that only the build fills.
const fillSiteNav = (html, site, lang, page) => fillById(fillById(html, 'site-nav-desktop', siteNav(site, lang, page, '', 'services-menu-desktop')),
  'site-nav-mobile', siteNav(site, lang, page, '', 'services-menu-mobile'));

function shellHeader(site, lang, page, slug = '') {
  const menuLabel = lang === 'he' ? 'פתיחת תפריט' : lang === 'ru' ? 'Открыть меню' : 'Open menu';
  const languageLabel = lang === 'he' ? 'בחירת שפה' : lang === 'ru' ? 'Выбор языка' : 'Choose language';
  const navLinks = menuId => siteNav(site, lang, page, slug, menuId);
  const languages = LANGUAGES.map(code => `<a href="${routeFor(code, page, slug)}" class="lang-btn px-2 py-0.5 rounded${code === lang ? ' active' : ''}"${code === lang ? ' aria-current="page"' : ''}>${code.toUpperCase()}</a>`).join('<span class="separator-theme" aria-hidden="true">|</span>');
  return `<a href="#main-content" class="site-skip-link">${lang === 'he' ? 'דלגו לתוכן הראשי' : lang === 'ru' ? 'Перейти к основному содержанию' : 'Skip to main content'}</a>
  <header class="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b site-header-theme">
    <div class="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
      <a href="${routeFor(lang, 'home')}" class="site-logo-link" aria-label="Katya Alon home"><img src="/assets/images/katya-logo-96.webp" srcset="/assets/images/katya-logo-96.webp 1x, /assets/images/katya-logo-192.webp 2x" alt="Katya Alon" class="site-logo" width="500" height="500"></a>
      <nav class="hidden lg:flex items-center gap-4 text-sm font-light nav-text-theme site-primary-nav" aria-label="${escapeHtml(localized(site.footer.navigation_label, lang))}">${navLinks('services-menu-desktop')}</nav>
      <div class="flex items-center gap-3"><div class="flex items-center gap-1 text-sm border rounded-full px-2 sm:px-3 py-1.5 lang-switcher-theme" role="group" aria-label="${languageLabel}">${languages}</div><button id="mobile-menu-button" type="button" class="lg:hidden site-menu-button" aria-label="${menuLabel}" aria-controls="mobile-nav" aria-expanded="false" onclick="toggleArticleMenu()"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button></div>
    </div>
    <div id="mobile-nav" class="mobile-nav-theme" hidden><nav class="max-w-6xl mx-auto px-5 pb-5 pt-3 flex flex-col gap-3 text-sm nav-text-theme" aria-label="${escapeHtml(localized(site.footer.navigation_label, lang))}">${navLinks('services-menu-mobile')}</nav></div>
  </header>`;
}

// Brand icons are inline SVG (no network); the visually hidden text is the accessible name, the glyphs are decorative.
// index.html carries the same markup (labels filled from data-content), so keep the two in step.
const SOCIAL = [
  ['https://www.instagram.com/kate_alon_marketing/', '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/>'],
  ['https://www.facebook.com/share/1QT8QYg3Gn/', '<path d="M14 8.5h2.5V5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3.5h2.5V21H14v-6.5h2.4l.6-3.5H14V8.9c0-.2.1-.4.4-.4z" fill="currentColor" stroke="none"/>']
];
export const socialIcons = (instagramLabel, facebookLabel) => `<div class="footer-social">${SOCIAL.map(([href, glyph], index) => `<a href="${href}" target="_blank" rel="noopener noreferrer" class="footer-social-link"><svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg><span class="visually-hidden">${escapeHtml(index ? facebookLabel : instagramLabel)}</span></a>`).join('')}</div>`;

function shellFooter(site, lang) {
  const home = routeFor(lang, 'home');
  const f = site.footer;
  return `<footer class="site-footer footer-theme"><div class="max-w-6xl mx-auto px-5"><div class="footer-grid">
    <div class="footer-intro"><p class="footer-brand-name">Katya Alon</p><p>${escapeHtml(localized(f.summary, lang))}</p></div>
    <nav aria-label="${escapeHtml(localized(f.navigation_label, lang))}"><h2>${escapeHtml(localized(f.navigation_label, lang))}</h2><ul><li><a href="${home}">${escapeHtml(localized(f.home, lang))}</a></li><li><a href="${home}#about">${escapeHtml(localized(site.nav.about, lang))}</a></li><li><a href="${home}#process">${escapeHtml(localized(site.nav.process, lang))}</a></li></ul></nav>
    <nav aria-label="${escapeHtml(localized(f.services_label, lang))}"><h2>${escapeHtml(localized(f.services_label, lang))}</h2><ul><li><a href="${home}#services">${escapeHtml(localized(site.nav.services, lang))}</a></li><li><a href="${routeFor(lang, 'workshops')}">${escapeHtml(localized(site.nav.workshops, lang))}</a></li><li><a href="${routeFor(lang, 'articles')}">${escapeHtml(localized(f.articles, lang))}</a></li></ul></nav>
    <div aria-label="${escapeHtml(localized(f.contact_label, lang))}"><h2>${escapeHtml(localized(f.contact_label, lang))}</h2><ul><li><a href="https://wa.me/972547838645">${escapeHtml(localized(f.whatsapp, lang))}</a></li><li><a href="mailto:katya.shivuk@gmail.com" class="footer-email">katya.shivuk@gmail.com</a></li><li><a href="${routeFor(lang, 'workshops')}#registration-privacy">${escapeHtml(localized(f.privacy_notice, lang))}</a></li></ul>${socialIcons(localized(f.instagram, lang), localized(f.facebook, lang))}</div>
    </div><div class="footer-bottom"><p>Katya Alon &copy; <span data-current-year></span></p><p>${escapeHtml(localized(f.rights, lang))}</p></div></div></footer>`;
}

function replaceTemplate(template, values) {
  return Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), template);
}

function articleExtraGraph(article, lang) {
  const url = urlFor(lang, 'article', article.slug);
  return [
    {
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: localized(article.title, lang),
      description: localized(article.meta_description, lang),
      inLanguage: LOCALES[lang],
      author: { '@id': PERSON_ID },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: lang === 'he' ? 'דף הבית' : lang === 'ru' ? 'Главная' : 'Home', item: urlFor(lang, 'home') },
        { '@type': 'ListItem', position: 2, name: lang === 'he' ? 'מאמרים וטיפים' : lang === 'ru' ? 'Статьи и советы' : 'Articles and Tips', item: urlFor(lang, 'articles') },
        { '@type': 'ListItem', position: 3, name: localized(article.title, lang), item: url }
      ]
    }
  ];
}

const RECOVIBES_SCRIPT = '<script src="https://api.recovibes.com/loader.js" data-id="rv_5caee053"></script>';

export function renderArticlesIndex(template, contentYaml, articlesYaml, lang = 'he') {
  const site = yaml.load(contentYaml);
  const source = yaml.load(articlesYaml);
  assertLocaleMaps(source, 'articles', { allowEmpty: true });
  const cards = [...source.articles].sort((a, b) => a.order - b.order).map(article => `<article class="article-card"><h2><a href="${routeFor(lang, 'article', article.slug)}">${escapeHtml(localized(article.title, lang))}</a></h2><p>${escapeHtml(localized(article.meta_description, lang))}</p><a class="article-card-link" href="${routeFor(lang, 'article', article.slug)}">${escapeHtml(localized(source.ui.read_article, lang))}</a></article>`).join('');
  let out = replaceTemplate(template, {
    HEADER: shellHeader(site, lang, 'articles'),
    FOOTER: shellFooter(site, lang),
    TITLE: escapeHtml(localized(source.ui.listing_title, lang)),
    DESCRIPTION: escapeHtml(localized(source.ui.listing_description, lang)),
    ARTICLES: cards,
    PODCASTS_PROMO: `<aside class="articles-podcasts-promo" aria-labelledby="podcasts-promo-title"><p class="articles-podcasts-kicker">${escapeHtml(localized(source.ui.podcasts_promo_kicker, lang))}</p><h2 id="podcasts-promo-title"><a href="${routeFor(lang, 'podcasts')}">${escapeHtml(localized(source.ui.podcasts_promo_title, lang))}</a></h2><p>${escapeHtml(localized(source.ui.podcasts_promo_description, lang))}</p><a class="article-card-link" href="${routeFor(lang, 'podcasts')}">${escapeHtml(localized(source.ui.podcasts_promo_link, lang))}</a></aside>`
  }).replace(/<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`);
  // User-requested third-party widget: the three articles listing routes only (he/en/ru; vendor snippet verbatim).
  out = out
    .replace('</head>', `  ${RECOVIBES_SCRIPT}\n</head>`)
    .replace('</aside>\n    </div>\n  </main>', '</aside>\n      <div class="articles-recovibes"><div data-recovibes></div></div>\n    </div>\n  </main>');
  return withHead(out, { title: escapeHtml(localized(source.ui.listing_seo_title, lang)), description: escapeHtml(localized(source.ui.listing_description, lang)), url: urlFor(lang, 'articles'), lang, siteName: localized(site.site.title, lang), imageAlt: localized(site.hero.portrait_placeholder, lang), page: 'articles' });
}

function podcastsExtraGraph(source, lang) {
  const url = urlFor(lang, 'podcasts');
  return [
    { '@type': 'CollectionPage', '@id': `${url}#webpage`, name: localized(source.page.title, lang), description: localized(source.page.meta_description, lang), url, inLanguage: LOCALES[lang], isPartOf: { '@id': WEBSITE_ID }, about: { '@id': PERSON_ID } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: localized(source.ui.breadcrumbs_home, lang), item: urlFor(lang, 'home') },
      { '@type': 'ListItem', position: 2, name: localized(source.page.title, lang), item: url }
    ] }
  ];
}

export function renderPodcasts(template, contentYaml, podcastsYaml, lang = 'he') {
  const site = yaml.load(contentYaml);
  const source = yaml.load(podcastsYaml);
  assertLocaleMaps(site);
  assertLocaleMaps({ ...source, episodes: source.episodes.map(({ youtube_id, start_seconds, ...episode }) => episode) }, 'podcasts');
  const text = value => escapeHtml(localized(value, lang));
  const episodes = source.episodes.map(episode => {
    if (!/^[\w-]{11}$/.test(episode.youtube_id)) throw new Error('build-pages: invalid YouTube video ID');
    if (episode.source_url !== `https://www.youtube.com/watch?v=${episode.youtube_id}`) throw new Error('build-pages: invalid podcast source URL');
    const start = Number(episode.start_seconds?.[lang]);
    if (!Number.isInteger(start) || start < 0) throw new Error(`build-pages: invalid podcast start time for ${lang}`);
    const embed = `https://www.youtube-nocookie.com/embed/${episode.youtube_id}?start=${start}`;
    const watch = `${episode.source_url}${start ? `&t=${start}s` : ''}`;
    return `<article class="podcast-episode"><div class="podcast-player"><iframe src="${embed}" title="${text(episode.iframe_title)}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"></iframe></div><div class="podcast-episode-copy"><h2>${text(episode.title)}</h2><p>${text(episode.description)}</p><p class="podcast-language-note"><em>${text(episode.language_note)}</em></p><p><a class="podcast-watch-link" href="${watch}" target="_blank" rel="noopener noreferrer">${text(source.ui.watch_on_youtube)}</a></p></div></article>`;
  }).join('');
  const breadcrumbs = `<nav class="article-breadcrumbs" aria-label="${BREADCRUMB_LABEL[lang]}"><ol><li><a href="${routeFor(lang, 'home')}">${text(source.ui.breadcrumbs_home)}</a></li><li aria-current="page">${text(source.page.title)}</li></ol></nav>`;
  const out = replaceTemplate(template, { HEADER: shellHeader(site, lang, 'podcasts'), FOOTER: shellFooter(site, lang), BREADCRUMBS: breadcrumbs, TITLE: text(source.page.title), INTRO: source.page.intro.map(paragraph => `<p>${text(paragraph)}</p>`).join(''), EPISODES: episodes })
    .replace(/<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`);
  return withHead(out, { title: text(source.page.seo_title), description: text(source.page.meta_description), url: urlFor(lang, 'podcasts'), lang, siteName: localized(site.site.title, lang), imageAlt: localized(site.hero.portrait_placeholder, lang), page: 'podcasts', extraGraph: podcastsExtraGraph(source, lang) });
}

export function renderArticle(template, contentYaml, articlesYaml, slug, lang = 'he') {
  const site = yaml.load(contentYaml);
  const source = yaml.load(articlesYaml);
  const article = source.articles.find(item => item.slug === slug);
  if (!article) throw new Error(`build-pages: unknown article ${slug}`);
  const service = enabledServices(site).find(item => item.anchor === article.service_anchor);
  if (!service) throw new Error(`build-pages: article ${slug} needs an enabled service_anchor`);
  const body = article.blocks.map(block => {
    if (block.h2) return `<h2>${escapeHtml(localized(block.h2, lang))}</h2>`;
    if (block.strong) return `<p><strong>${escapeHtml(localized(block.strong, lang))}</strong></p>`;
    if (block.ul) return `<ul class="article-list">${block.ul.map(item => `<li>${escapeHtml(localized(item, lang))}</li>`).join('')}</ul>`;
    const text = escapeHtml(localized(block.p, lang));
    return `<p>${block.link_slug ? `<a href="${routeFor(lang, 'article', block.link_slug)}">${text}</a>` : text}</p>`;
  }).join('');
  const breadcrumbs = `<nav class="article-breadcrumbs" aria-label="${BREADCRUMB_LABEL[lang]}"><ol><li><a href="${routeFor(lang, 'home')}">${escapeHtml(localized(source.ui.breadcrumbs_home, lang))}</a></li><li><a href="${routeFor(lang, 'articles')}">${escapeHtml(localized(source.ui.breadcrumbs_articles, lang))}</a></li><li aria-current="page">${escapeHtml(localized(article.title, lang))}</li></ol></nav>`;
  const related = `<aside class="article-related" aria-labelledby="related-title"><h2 id="related-title">${escapeHtml(localized(source.ui.related_title, lang))}</h2><ul><li><a href="${routeFor(lang, 'service', service.slug)}">${escapeHtml(localized(source.ui.related_service, lang))}</a></li><li><a href="${routeFor(lang, 'articles')}">${escapeHtml(localized(source.ui.all_articles, lang))}</a></li><li><a href="${routeFor(lang, 'home')}#contact">${escapeHtml(localized(source.ui.contact, lang))}</a></li></ul></aside>`;
  let out = replaceTemplate(template, {
    HEADER: shellHeader(site, lang, 'article', slug),
    FOOTER: shellFooter(site, lang),
    BREADCRUMBS: breadcrumbs,
    TITLE: escapeHtml(localized(article.title, lang)),
    AUTHOR: `${escapeHtml(localized(source.ui.author_label, lang))} <a href="${routeFor(lang, 'home')}#about">${escapeHtml(localized(source.ui.author, lang))}</a>`,
    BODY: body,
    RELATED: related
  }).replace(/<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`);
  return withHead(out, { title: escapeHtml(localized(article.seo_title, lang)), description: escapeHtml(localized(article.meta_description, lang)), url: urlFor(lang, 'article', slug), lang, siteName: localized(site.site.title, lang), imageAlt: localized(site.hero.portrait_placeholder, lang), page: 'article', slug, ogType: 'article', extraGraph: articleExtraGraph(article, lang) });
}

function serviceExtraGraph(site, service, lang, page = null) {
  const url = urlFor(lang, 'service', service.slug);
  const name = page?.heading ? localized(page.heading, lang) : localized(service.title, lang);
  const description = page?.meta_description ? localized(page.meta_description, lang) : localized(service.description, lang);
  return [
    {
      '@type': 'Service',
      '@id': `${url}#service`,
      name,
      description,
      url,
      provider: { '@id': PERSON_ID }
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: localized(site.nav.home, lang), item: urlFor(lang, 'home') },
        { '@type': 'ListItem', position: 2, name, item: url }
      ]
    }
  ];
}

// Opt-in long-form layout for the marketing-strategy service. Labels and text stay separate so list labels can be semantic bold text.
function marketingStrategyPage(page, contact, text) {
  const labeledPoints = items => `<ul class="service-points service-rich-points">${items.map(item => `<li><strong>${text(item.label)}</strong> ${text(item.text)}</li>`).join('')}</ul>`;
  const points = items => `<ul class="service-points service-rich-points">${items.map(item => `<li>${text(item)}</li>`).join('')}</ul>`;
  const introCallout = page.intro_callout ? `<p><strong>${text(page.intro_callout)}</strong></p>` : '';
  const outcomeCallout = page.outcome_callout ? `<p class="service-statement"><strong>${text(page.outcome_callout)}</strong></p>` : '';
  const audience = page.audience_title ? `<section class="service-intro service-rich-audience"><h2>${text(page.audience_title)}</h2>${page.audience_paragraphs.map(paragraph => `<p>${text(paragraph)}</p>`).join('')}</section>` : '';
  return {
    title: text(page.heading),
    lead: `<strong>${text(page.lead)}</strong>`,
    body: `<section class="service-intro">${page.paragraphs.map(paragraph => `<p>${text(paragraph)}</p>`).join('')}${introCallout}</section>`
      + `<section class="service-panel service-rich-panel"><h2>${text(page.includes_title)}</h2>${labeledPoints(page.includes)}</section>`
      + `<section class="service-panel service-rich-panel"><h2>${text(page.outcomes_title)}</h2>${points(page.outcomes)}</section>`
      + outcomeCallout
      + audience
      + `<section class="service-contact service-rich-contact"><h2>${text(page.closing_title)}</h2>${page.closing_paragraphs.map(paragraph => `<p>${text(paragraph)}</p>`).join('')}<p><strong>${text(page.callout)}</strong></p><p>${text(page.cta_intro)}</p><p><a href="${text(contact.href)}" class="cta-primary cta-image-button text-sm font-medium">${text(contact.label)}</a></p></section>`
  };
}

// The personal-training detail page has a richer, fixed structure while sharing the
// same enabled service record as its home card and menu entry.
function standaloneTrainingPage(page, text) {
  const points = items => `<ul class="service-points service-rich-points">${items.map(item => `<li>${text(item)}</li>`).join('')}</ul>`;
  const labeledPoints = items => `<ul class="service-points service-rich-points">${items.map(item => `<li><strong>${text(item.label)}</strong> ${text(item.text)}</li>`).join('')}</ul>`;
  return {
    title: text(page.title),
    lead: `<strong>${text(page.lead)}</strong>`,
    body: `<section class="service-intro"><p>${text(page.intro)}</p></section>`
      + `<section class="service-panel service-rich-panel"><h2>${text(page.first_title)}</h2>${points(page.first_points)}</section>`
      + `<p class="service-statement"><strong>${text(page.first_callout)}</strong></p>`
      + `<section class="service-panel service-rich-panel"><h2>${text(page.second_title)}</h2>${labeledPoints(page.second_points)}</section>`
      + `<p class="service-statement"><strong>${text(page.second_callout)}</strong></p>`
      + `<hr class="service-divider">`
      + `<section class="service-contact service-rich-contact"><p><strong>${text(page.closing_callout)}</strong></p><p>${text(page.closing)}</p><p><a href="${text(page.contact_cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${text(page.contact_cta.label)}</a></p></section>`
  };
}

// Opt-in layout for a service with a `page` block (paid-advertising): two option cards, shared statement, optional results gallery, contact CTA.
function richServicePage(page, contact, text, lang) {
  const cta = option => `<a href="${text(option.cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${text(option.cta.label)}</a>`;
  const cards = page.options.map(option => `<section class="service-option"><h2>${text(option.title)}</h2>${option.paragraphs.map(p => `<p>${text(p)}</p>`).join('')}<p class="service-option-cta">${cta(option)}</p></section>`).join('');
  const { results } = page;
  const figures = results.enabled ? results.items.map(item => `<figure class="results-item"><figcaption>${text(item.caption)}</figcaption><a class="results-frame" href="${item.src}" data-gallery-link aria-label="${text(results.viewer.open)}: ${text(item.caption)}"><img src="${item.thumb}" srcset="${item.thumb} 768w, ${item.thumb_2x} 1152w" sizes="(min-width: 861px) 512px, calc(100vw - 4.5rem)" width="768" height="${Math.round(768 * item.height / item.width)}" alt="${text(item.alt)}" loading="lazy" decoding="async"></a></figure>`).join('') : '';
  const gallery = results.enabled ? `<section class="service-results" aria-labelledby="results-title"><h2 id="results-title">${text(results.title)}</h2><p class="results-intro">${text(results.intro)}</p><div class="results-grid">${figures}</div>`
    + `<dialog class="results-viewer" data-gallery-viewer aria-label="${text(results.title)}"><div class="results-viewer-bar"><button type="button" class="results-viewer-close" data-gallery-close aria-label="${text(results.viewer.close)}">×</button></div><div class="results-viewer-scroll" tabindex="0" role="group" aria-label="${text(results.viewer.pan)}"><img alt="" data-gallery-image width="1536" height="1024"></div></dialog>`
    + `<p class="results-note">${text(results.note)}</p></section>` : '';
  const firstLine = text(page.heading);
  const accent = text(page.heading_accent);
  return {
    title: `${firstLine} <span class="service-accent">${accent}</span>`,
    body: `<div class="service-options">${cards}</div><p class="service-statement"><strong>${text(page.statement)}</strong></p>${gallery}`
      + `<section class="service-contact"><p>${text(page.contact.text)}</p><p><a href="${text(contact.href)}" class="cta-primary cta-image-button text-sm font-medium">${text(contact.label)}</a></p></section>`
  };
}

// Service detail page: the same YAML item that feeds the home-page card and modal.
export function renderService(template, contentYaml, articlesYaml, slug, lang = 'he') {
  const site = yaml.load(contentYaml);
  const { articles } = yaml.load(articlesYaml);
  assertLocaleMaps(site);
  const services = enabledServices(site);
  const service = services.find(item => item.slug === slug);
  if (!service) throw new Error(`build-pages: unknown service ${slug}`);
  const text = value => escapeHtml(localized(value, lang));
  const details = service.details;
  const cta = details?.contact_cta;
  const ui = site.services;
  const points = items => `<ul class="service-points">${items.map(item => `<li>${text(item)}</li>`).join('')}</ul>`;
  const related = (id, title, links) => (links.length ? `<aside class="article-related" aria-labelledby="${id}"><h2 id="${id}">${text(title)}</h2><ul>${links.map(([href, label]) => `<li><a href="${href}">${text(label)}</a></li>`).join('')}</ul></aside>` : '');
  const body = details && `<p class="service-summary">${text(details.summary)}</p>`
    + `<section class="service-panel"><h2>${text(ui.includes_title)}</h2>${points(details.tech_points)}</section>`
    + `<section class="service-panel"><h2>${text(ui.results_title)}</h2>${points(details.second_tech_points)}</section>`
    + details.body.map(paragraph => `<p>${text(paragraph)}</p>`).join('')
    + `<p class="service-cta"><a href="${text(cta.href)}" class="cta-primary cta-image-button text-sm font-medium">${text(cta.label)}</a></p>`;
  const rich = service.page ? richServicePage(service.page, details.contact_cta, text, lang) : null;
  const marketing = service.marketing_page ? marketingStrategyPage(service.marketing_page, details.contact_cta, text) : null;
  const training = service.card_title ? standaloneTrainingPage(service, text) : null;
  const pageContent = rich || marketing || training;
  const out = replaceTemplate(pageContent ? template.replace('article-reading', 'article-wide').replace('\n        <p class="service-lead">{{DESCRIPTION}}</p>', (marketing || training) ? '\n        <p class="service-lead service-rich-lead">{{DESCRIPTION}}</p>' : '').replace('<script defer src="/js/nav.js"></script>', rich ? '<script defer src="/js/nav.js"></script>\n  <script defer src="/js/gallery.js"></script>' : '<script defer src="/js/nav.js"></script>') : template, {
    HEADER: shellHeader(site, lang, 'service', slug),
    FOOTER: shellFooter(site, lang),
    BREADCRUMBS: `<nav class="article-breadcrumbs" aria-label="${BREADCRUMB_LABEL[lang]}"><ol><li><a href="${routeFor(lang, 'home')}">${text(site.nav.home)}</a></li><li aria-current="page">${(marketing || training) ? pageContent.title : text(serviceCardTitle(service))}</li></ol></nav>`,
    TITLE: pageContent ? pageContent.title : text(service.title),
    DESCRIPTION: (marketing || training) ? pageContent.lead : text(service.description),
    BODY: pageContent ? pageContent.body : body,
    RELATED: related('more-services-title', ui.more_title, services.filter(item => item !== service).map(item => [routeFor(lang, 'service', item.slug), serviceCardTitle(item)]))
      + related('related-articles-title', ui.articles_title, articles.filter(article => article.service_anchor === service.anchor)
        .sort((a, b) => a.order - b.order).map(article => [routeFor(lang, 'article', article.slug), article.title]))
  }).replace(/<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`);
  const metadata = service.marketing_page || (training ? service : null);
  return withHead(out, { title: metadata ? text(metadata.seo_title) : `${text(serviceCardTitle(service))} | ${text(site.hero.name)}`, description: metadata ? text(metadata.meta_description) : text(service.description), url: urlFor(lang, 'service', slug), lang, siteName: localized(site.site.title, lang), imageAlt: localized(site.hero.portrait_placeholder, lang), page: 'service', slug, extraGraph: serviceExtraGraph(site, service, lang, metadata) });
}

export function renderSitemap(articlesYaml = read('content/articles.yaml'), contentYaml = read('content/content.yaml')) {
  const source = yaml.load(articlesYaml);
  const pages = [
    ['home', ''],
    ['workshops', ''],
    ['articles', ''],
    ['podcasts', ''],
    ...source.articles.map(article => ['article', article.slug]),
    ...enabledServices(yaml.load(contentYaml)).map(service => ['service', service.slug])
  ];
  const entries = LANGUAGES.flatMap(lang => pages.map(([page, slug]) => {
    const alternates = [...LANGUAGES.map(code => `<xhtml:link rel="alternate" hreflang="${code}" href="${urlFor(code, page, slug)}" />`), `<xhtml:link rel="alternate" hreflang="x-default" href="${urlFor('he', page, slug)}" />`].join('');
    return `  <url><loc>${urlFor(lang, page, slug)}</loc>${alternates}</url>`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}

export function buildPages(stageDir) {
  const homeTemplate = read('index.html');
  const workshopTemplate = read('workshops.html');
  const articlesTemplate = read('scripts/templates/articles.html');
  const podcastsTemplate = read('scripts/templates/podcasts.html');
  const articleTemplate = read('scripts/templates/article.html');
  const serviceTemplate = read('scripts/templates/service.html');
  const contentYaml = read('content/content.yaml');
  const workshopYaml = read('content/workshop.yaml');
  const articlesYaml = read('content/articles.yaml');
  const podcastsYaml = read('content/podcasts.yaml');
  const articleSource = yaml.load(articlesYaml);
  const slugs = articleSource.articles.map(article => article.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error('build-pages: article slugs must be unique');
  const serviceSlugs = enabledServices(yaml.load(contentYaml)).map(service => service.slug);
  if (new Set(serviceSlugs).size !== serviceSlugs.length) throw new Error('build-pages: service slugs must be unique');
  writeFileSync(join(stageDir, 'sitemap.xml'), renderSitemap(articlesYaml, contentYaml));
  for (const lang of LANGUAGES) {
    const outputDir = lang === 'he' ? stageDir : join(stageDir, lang);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'index.html'), renderHome(homeTemplate, contentYaml, lang, undefined, articlesYaml));
    writeFileSync(join(outputDir, 'workshops.html'), renderWorkshops(workshopTemplate, workshopYaml, lang, contentYaml));
    const articlesDir = join(outputDir, 'articles');
    mkdirSync(articlesDir, { recursive: true });
    writeFileSync(join(articlesDir, 'index.html'), renderArticlesIndex(articlesTemplate, contentYaml, articlesYaml, lang));
    const podcastsDir = join(outputDir, 'podcasts');
    mkdirSync(podcastsDir, { recursive: true });
    writeFileSync(join(podcastsDir, 'index.html'), renderPodcasts(podcastsTemplate, contentYaml, podcastsYaml, lang));
    for (const slug of slugs) {
      const articleDir = join(articlesDir, slug);
      mkdirSync(articleDir, { recursive: true });
      writeFileSync(join(articleDir, 'index.html'), renderArticle(articleTemplate, contentYaml, articlesYaml, slug, lang));
    }
    for (const slug of serviceSlugs) {
      const serviceDir = join(outputDir, 'services', slug);
      mkdirSync(serviceDir, { recursive: true });
      writeFileSync(join(serviceDir, 'index.html'), renderService(serviceTemplate, contentYaml, articlesYaml, slug, lang));
    }
  }

  const cssDir = join(stageDir, 'css');
  mkdirSync(cssDir, { recursive: true });
  const tailwindCli = fileURLToPath(new URL('node_modules/tailwindcss/lib/cli.js', ROOT));
  const result = spawnSync(process.execPath, [
    tailwindCli,
    '--config', fileURLToPath(new URL('tailwind.config.cjs', ROOT)),
    '--input', fileURLToPath(new URL('tailwind.css', import.meta.url)),
    '--output', join(cssDir, 'tailwind.css'),
    '--minify'
  ], { cwd: fileURLToPath(ROOT), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`build-pages: Tailwind CSS compilation failed: ${result.stderr || result.stdout}`);
  }
  versionAssets(stageDir);
  return LANGUAGES.length * (4 + slugs.length + serviceSlugs.length);
}

// Cache-bust local CSS/JS: HTML is revalidated quickly while assets are cached longer, so a new page must never
// run with an older cached script (that left the service modal CTA empty). The URL changes with the file content.
export function versionAssets(stageDir) {
  const pages = [];
  const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.html')) pages.push(path);
  });
  walk(stageDir);
  const hashes = new Map();
  const stamp = ref => {
    if (!hashes.has(ref)) hashes.set(ref, createHash('sha256').update(readFileSync(join(stageDir, ref))).digest('hex').slice(0, 10));
    return `${ref}?v=${hashes.get(ref)}`;
  };
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const out = html.replace(/\b(href|src)="(\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (match, attr, ref) => (existsSync(join(stageDir, ref)) ? `${attr}="${stamp(ref)}"` : match));
    if (out !== html) writeFileSync(page, out);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stageDir = process.argv[2];
  if (stageDir === '--write-sitemap') {
    writeFileSync(new URL('sitemap.xml', ROOT), renderSitemap());
    console.log('Updated sitemap.xml with all canonical routes');
    process.exit(0);
  }
  if (!stageDir) {
    console.error('Usage: node scripts/build-pages.mjs <stage-dir>');
    process.exit(2);
  }
  console.log(`Prerendered ${buildPages(stageDir)} canonical pages into ${stageDir}`);
}
