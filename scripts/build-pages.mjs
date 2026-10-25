// Prerenders all canonical language variants of index.html and workshops.html into a Pages staging directory.
// Source HTML and content/*.yaml stay the only truth; the output is never committed. JS still hydrates/replaces the same nodes.
// Usage: node scripts/build-pages.mjs <stage-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

export const routeFor = (lang, page) => {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  if (!['home', 'workshops'].includes(page)) throw new Error(`build-pages: unsupported page ${page}`);
  const prefix = lang === 'he' ? '/' : `/${lang}/`;
  return page === 'home' ? prefix : `${prefix}workshops.html`;
};

export const urlFor = (lang, page) => new URL(routeFor(lang, page), SITE_URL).href;

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

// All arguments must already be HTML-escaped.
function withHead(html, { title, description, url, lang }) {
  const stripped = html
    .replace(/^[ \t]*<meta (?:name="(?:description|twitter:[a-z]+)"|property="og:[a-z]+")[^>]*>\n/gm, '')
    .replace(/^[ \t]*<link rel="(?:canonical|alternate)"[^>]*>\n/gm, '');
  const alternates = [...LANGUAGES.map(code => `<link rel="alternate" hreflang="${code}" href="${urlFor(code, url.endsWith('workshops.html') ? 'workshops' : 'home')}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlFor('he', url.endsWith('workshops.html') ? 'workshops' : 'home')}">`];
  const meta = [
    `<title>${required(title, 'title')}</title>`,
    `<meta name="description" content="${required(description, 'description')}">`,
    `<link rel="canonical" href="${url}">`,
    ...alternates,
    '<meta property="og:type" content="website">',
    `<meta property="og:locale" content="${OG_LOCALES[lang]}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    '<meta name="twitter:card" content="summary">'
  ].join('\n  ');
  return replaceOnce(stripped, /<title>[^<]*<\/title>/, meta, '<title>');
}

// Home: runs the real js/main.js renderers against escaped content and a recording DOM stub, so markup never drifts.
export function renderHome(html, contentYaml, lang = 'he', mainJs = read('js/main.js')) {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  const content = escapeDeep(yaml.load(contentYaml));
  assertLocaleMaps(content);
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', innerHTML: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } });
    return nodes.get(key);
  };
  const containers = ['about-paragraphs', 'services-list', 'audience-list', 'process-list'];
  const dataKey = selector => selector.match(/^\[data-content="([^"]+)"\]$/)?.[1];
  const document = {
    title: '',
    getElementById: id => (containers.includes(id) ? node(`#${id}`) : null),
    querySelector: selector => (dataKey(selector) ? node(dataKey(selector)) : null),
    querySelectorAll: selector => (dataKey(selector) ? [node(dataKey(selector))] : []),
    addEventListener() {}
  };
  const context = vm.createContext({ document, window: { innerWidth: 0, addEventListener() {} }, console, __content: content });
  vm.runInContext(mainJs, context, { filename: 'js/main.js' });
  vm.runInContext(`siteContent = __content; currentLang = "${lang}"; renderContent("${lang}");`, context);

  let out = fillByAttr(html, 'data-content', key => node(key).textContent);
  for (const id of containers) out = fillById(out, id, required(node(`#${id}`).innerHTML, `#${id}`));
  out = replaceOnce(out, /<div id="process-list" /, `<div id="process-list" dir="${node('#process-list').attributes.dir}" `, '#process-list');
  out = replaceOnce(out, /<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`, '<html language>');
  out = setPageLinks(out, lang, 'home');
  out = setLanguageLinks(out, lang, 'home');
  return withHead(out, { title: document.title, description: content.hero.description[lang], url: urlFor(lang, 'home'), lang });
}

// Workshops: mirrors the Hebrew text-only output of js/workshops.js (renderHero/renderSections/renderPricing/renderInstructor).
export function renderWorkshops(html, workshopYaml, lang = 'he') {
  if (!LANGUAGES.includes(lang)) throw new Error(`build-pages: unsupported language ${lang}`);
  const w = yaml.load(workshopYaml);
  assertLocaleMaps(w, 'workshop', { allowEmpty: true });
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

  let out = fillByAttr(html, 'data-copy', key => text(at(key)));
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
    setText('pricing-session', fill(pricing.session_label, pricing.per_session_price));
    setText('pricing-breakdown', fill(pricing.breakdown_label, pricing.per_session_price));
    setText('pricing-includes', pricing.includes);
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

  setText('form-kicker', at('form.kicker'));
  setText('registration-title', at('form.title'));
  setText('form-intro', at('form.intro'));

  const unresolved = out.match(/\{(?:event\.[a-z_]+|price|total|count|currency|vat)\}/);
  if (unresolved) throw new Error(`build-pages: unresolved token ${unresolved[0]} in workshops.html`);
  out = replaceOnce(out, /<html lang="he" dir="rtl"/, `<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}"`, '<html language>');
  out = setPageLinks(out, lang, 'workshops');
  out = setLanguageLinks(out, lang, 'workshops');
  return withHead(out, { title: text(at('meta.title')), description: text(at('meta.description')), url: urlFor(lang, 'workshops'), lang });
}

function setLanguageLinks(html, activeLang, page) {
  let out = html;
  for (const lang of LANGUAGES) {
    const active = lang === activeLang;
    const pattern = new RegExp(`<a href="[^"]*" class="lang-btn ([^"]*)" id="btn-${lang}"(?: aria-current="page")?>`);
    out = replaceOnce(out, pattern, (_match, classes) => {
      const nextClasses = classes.split(/\s+/).filter(value => value && value !== 'active');
      if (active) nextClasses.push('active');
      return `<a href="${routeFor(lang, page)}" class="lang-btn ${nextClasses.join(' ')}" id="btn-${lang}"${active ? ' aria-current="page"' : ''}>`;
    }, `#btn-${lang}`);
  }
  return out;
}

function setPageLinks(html, lang, page) {
  return html.replace(/<a\b[^>]*>/g, tag => {
    let href;
    if (tag.includes('data-workshops-link')) href = routeFor(lang, 'workshops');
    if (page === 'workshops' && tag.includes('data-home-anchor=')) {
      const anchor = tag.match(/data-home-anchor="([^"]+)"/)?.[1];
      href = `${routeFor(lang, 'home')}#${anchor}`;
    }
    if (page === 'workshops' && tag.includes('id="brand-link"')) href = `${routeFor(lang, 'home')}#hero`;
    return href ? tag.replace(/href="[^"]*"/, `href="${href}"`) : tag;
  });
}

export function buildPages(stageDir) {
  const homeTemplate = read('index.html');
  const workshopTemplate = read('workshops.html');
  const contentYaml = read('content/content.yaml');
  const workshopYaml = read('content/workshop.yaml');
  for (const lang of LANGUAGES) {
    const outputDir = lang === 'he' ? stageDir : join(stageDir, lang);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'index.html'), renderHome(homeTemplate, contentYaml, lang));
    writeFileSync(join(outputDir, 'workshops.html'), renderWorkshops(workshopTemplate, workshopYaml, lang));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stageDir = process.argv[2];
  if (!stageDir) {
    console.error('Usage: node scripts/build-pages.mjs <stage-dir>');
    process.exit(2);
  }
  buildPages(stageDir);
  console.log(`Prerendered six canonical pages into ${stageDir}`);
}
