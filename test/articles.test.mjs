import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { buildPages, enabledServices, escapeHtml, LANGUAGES, renderArticle, renderPodcasts, routeFor, urlFor } from '../scripts/build-pages.mjs';

const root = new URL('../', import.meta.url);
const source = yaml.load(readFileSync(new URL('content/articles.yaml', root), 'utf8'));
const site = yaml.load(readFileSync(new URL('content/content.yaml', root), 'utf8'));
const count = (html, pattern) => (html.match(pattern) || []).length;
const languageTag = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' };
const services = enabledServices(site);
const standalonePages = site.services.standalone_pages;

function outputPath(stage, lang, page, slug = '') {
  const prefix = lang === 'he' ? '' : lang;
  if (page === 'home') return join(stage, prefix, 'index.html');
  if (page === 'workshops') return join(stage, prefix, 'workshops.html');
  if (page === 'articles') return join(stage, prefix, 'articles', 'index.html');
  if (page === 'podcasts') return join(stage, prefix, 'podcasts', 'index.html');
  if (page === 'service') return join(stage, prefix, 'services', slug, 'index.html');
  return join(stage, prefix, 'articles', slug, 'index.html');
}

test('article source has safe unique slugs, complete translations and no invented dates', () => {
  assert.equal(source.articles.length, 8);
  assert.equal(new Set(source.articles.map(article => article.slug)).size, 8);
  for (const article of source.articles) {
    assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(article.published, null);
    assert.ok(site.services.items.some(service => service.anchor === article.service_anchor && service.enabled !== false));
    for (const field of ['title', 'seo_title', 'meta_description']) {
      for (const lang of LANGUAGES) assert.ok(article[field][lang].trim(), `${article.slug}.${field}.${lang}`);
    }
    for (const [index, block] of article.blocks.entries()) {
      const field = ['h2', 'p', 'strong'].find(key => block[key]);
      const values = field ? [block[field]] : block.ul;
      assert.ok(values?.length, `${article.slug}.blocks.${index} has a known type`);
      for (const value of values) for (const lang of LANGUAGES) assert.ok(value[lang].trim(), `${article.slug}.blocks.${index}.${lang}`);
    }
  }
});

test('all 51 pages expose one H1, main and top-level footer with valid local links', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-articles-'));
  try {
    buildPages(stage);
    const pages = ['home', 'workshops', 'articles', 'podcasts'];
    for (const lang of LANGUAGES) {
      for (const page of pages) {
        const html = readFileSync(outputPath(stage, lang, page), 'utf8');
        assert.equal(count(html, /<h1\b/g), 1, `${lang}/${page} H1`);
        assert.equal(count(html, /<main\b/g), 1, `${lang}/${page} main`);
        assert.equal(count(html, /<footer\b/g), 1, `${lang}/${page} footer`);
      }
      for (const [page, slug] of [...source.articles.map(article => ['article', article.slug]), ...services.map(service => ['service', service.slug]), ...standalonePages.map(page => ['service', page.slug])]) {
        const html = readFileSync(outputPath(stage, lang, page, slug), 'utf8');
        assert.equal(count(html, /<h1\b/g), 1, `${lang}/${slug} H1`);
        assert.equal(count(html, /<main\b/g), 1, `${lang}/${slug} main`);
        assert.equal(count(html, /<footer\b/g), 1, `${lang}/${slug} footer`);
      }
    }

    const social = ['https://www.instagram.com/kate_alon_marketing/', 'https://www.facebook.com/share/1QT8QYg3Gn/'];
    const allPages = lang => [outputPath(stage, lang, 'home'), outputPath(stage, lang, 'workshops'), outputPath(stage, lang, 'articles'), outputPath(stage, lang, 'podcasts'),
      ...source.articles.map(article => outputPath(stage, lang, 'article', article.slug)),
      ...services.map(service => outputPath(stage, lang, 'service', service.slug)),
      ...standalonePages.map(page => outputPath(stage, lang, 'service', page.slug))];
    for (const lang of LANGUAGES) {
      for (const file of allPages(lang)) {
        const footer = readFileSync(file, 'utf8').match(/<footer\b[\s\S]*<\/footer>/)[0];
        assert.ok(footer.includes('<a href="mailto:katya.shivuk@gmail.com" class="footer-email">katya.shivuk@gmail.com</a>'), `${file}: email shows only the address`);
        assert.doesNotMatch(footer, /(?:Email|Электронная почта|דוא״ל)\s*:/, `${file}: no email prefix`);
        const contact = footer.slice(footer.indexOf('https://wa.me'), footer.indexOf('footer-bottom'));
        const order = [...contact.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]);
        assert.deepEqual(order.slice(-2), social, `${file}: social icons are last, Instagram then Facebook`);
        assert.ok(order.findIndex(href => href.includes('registration-privacy')) < order.length - 2, `${file}: privacy link precedes the icons`);
        assert.equal(count(contact, /footer-social-link/g), 2, `${file}: icons share one row`);
        for (const [index, href] of social.entries()) {
          const label = escapeHtml(site.footer[index ? 'facebook' : 'instagram'][lang]);
          const link = footer.match(new RegExp(`<a href="${href}" target="_blank" rel="noopener noreferrer" class="footer-social-link"><svg[^>]*aria-hidden="true"[\\s\\S]*?</svg><span class="visually-hidden"[^>]*>([^<]*)</span></a>`));
          assert.equal(link?.[1], label, `${file}: ${href}`);
        }
      }
    }

    const generated = LANGUAGES.flatMap(allPages);
    assert.equal(generated.length, 51);
    for (const file of generated) {
      const html = readFileSync(file, 'utf8');
      for (const href of [...html.matchAll(/href="(\/[^"?#]*)(?:#[^"]*)?"/g)].map(match => match[1])) {
        if (href.startsWith('//')) continue;
        const relative = href === '/' ? 'index.html' : href.replace(/^\//, '').replace(/\/$/, '/index.html');
        const target = relative.endsWith('.html') || relative.includes('.') ? relative : `${relative}/index.html`;
        assert.ok(existsSync(join(stage, target)) || existsSync(new URL(`.${href}`, root)), `${file}: missing ${href}`);
      }
      for (const src of [...html.matchAll(/(?:src|href)="(\/(?:assets|css|js)\/[^"?#]+)"/g)].map(match => match[1])) {
        assert.ok(existsSync(new URL(`.${src}`, root)) || existsSync(join(stage, src.slice(1))), `${file}: missing asset ${src}`);
      }
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('podcast hubs have localized SEO, safe responsive embeds, language starts and article-listing discovery links', () => {
  const podcastsYaml = readFileSync(new URL('../content/podcasts.yaml', import.meta.url), 'utf8');
  const podcasts = yaml.load(podcastsYaml);
  const template = readFileSync(new URL('../scripts/templates/podcasts.html', import.meta.url), 'utf8');
  const contentYaml = readFileSync(new URL('../content/content.yaml', import.meta.url), 'utf8');
  for (const lang of LANGUAGES) {
    const html = renderPodcasts(template, contentYaml, podcastsYaml, lang);
    const start = lang === 'ru' ? 0 : 29;
    assert.ok(html.includes(`<title>${escapeHtml(podcasts.page.seo_title[lang])}</title>`));
    assert.ok(html.includes(`<link rel="canonical" href="${urlFor(lang, 'podcasts')}">`));
    for (const code of LANGUAGES) assert.ok(html.includes(`hreflang="${code}" href="${urlFor(code, 'podcasts')}`));
    assert.ok(html.includes(`https://www.youtube-nocookie.com/embed/mqJPD6FFGIk?start=${start}`));
    assert.ok(html.includes(`https://www.youtube.com/watch?v=mqJPD6FFGIk${start ? `&t=${start}s` : ''}`));
    assert.match(html, /<iframe [^>]*title="[^"]+"[^>]*loading="lazy"[^>]*allowfullscreen/);
    assert.doesNotMatch(html, /autoplay/i);
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'];
    assert.deepEqual(graph.map(entry => entry['@type']), ['Person', 'WebSite', 'CollectionPage', 'BreadcrumbList']);
    assert.ok(!html.includes('recovibes'));
  }
  const css = readFileSync(new URL('../css/articles.css', import.meta.url), 'utf8');
  assert.match(css, /\.podcast-player \{[^}]*aspect-ratio: 16 \/ 9/);
  const unsafe = podcastsYaml.replace('he: "קטיה אלון מתארחת בפודקאסט"', 'he: "<script>alert(1)</script>"');
  const escaped = renderPodcasts(template, contentYaml, unsafe, 'he');
  assert.ok(escaped.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!escaped.includes('<h2><script>'));
});

test('every article retains its complete language body and SEO graph', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-article-copy-'));
  try {
    buildPages(stage);
    for (const lang of LANGUAGES) {
      for (const article of source.articles) {
        const html = readFileSync(outputPath(stage, lang, 'article', article.slug), 'utf8');
        assert.ok(html.includes(`<h1>${escapeHtml(article.title[lang])}</h1>`));
        const articleBody = html.match(/<div class="article-body">([\s\S]*?)<\/div>/)?.[1] || '';
        assert.equal(count(articleBody, /<h2\b/g), article.blocks.filter(block => block.h2).length, `${lang}/${article.slug} body H2 count`);
        for (const block of article.blocks) {
          for (const value of [block.h2, block.p, block.strong, ...(block.ul || [])].filter(Boolean).map(item => item[lang])) assert.ok(html.includes(escapeHtml(value)), `${lang}/${article.slug}: missing ${value}`);
        }
        assert.match(html, new RegExp(`<link rel="canonical" href="${urlFor(lang, 'article', article.slug).replaceAll('.', '\\.')}">`));
        for (const code of LANGUAGES) assert.ok(html.includes(`hreflang="${code}" href="${urlFor(code, 'article', article.slug)}"`));
        const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'];
        const articleData = graph.find(entry => entry['@type'] === 'Article');
        const breadcrumbs = graph.find(entry => entry['@type'] === 'BreadcrumbList');
        assert.equal(articleData.headline, article.title[lang]);
        assert.equal(articleData.inLanguage, languageTag[lang]);
        assert.deepEqual(articleData.author, { '@id': 'https://katya-alon.com/#person' });
        assert.equal(articleData.mainEntityOfPage['@id'], urlFor(lang, 'article', article.slug));
        for (const field of ['datePublished', 'dateModified', 'image']) assert.ok(!Object.hasOwn(articleData, field));
        assert.equal(breadcrumbs.itemListElement.length, 3);
      }
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('article listing and homepage expose the expected editorial order and four services', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-article-list-'));
  try {
    buildPages(stage);
    for (const lang of LANGUAGES) {
      const listing = readFileSync(outputPath(stage, lang, 'articles'), 'utf8');
      assert.equal(count(listing, /class="article-card"/g), 8);
      assert.ok(listing.includes(`href="${routeFor(lang, 'podcasts')}"`));
      const positions = source.articles.map(article => listing.indexOf(routeFor(lang, 'article', article.slug)));
      assert.deepEqual([...positions].sort((a, b) => a - b), positions);
      const home = readFileSync(outputPath(stage, lang, 'home'), 'utf8');
      assert.equal(count(home, /class="service-row /g), 4);
      assert.equal(count(home, /class="article-card"/g), 3);
      assert.ok(home.includes(escapeHtml(site.site.description[lang])));
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('RecoVibes widget exists only on the three articles listings (he/en/ru), after the cards and before the footer', () => {
  const stage = mkdtempSync(join(tmpdir(), 'recovibes-'));
  try {
    buildPages(stage);
    const tag = '<script src="https://api.recovibes.com/loader.js" data-id="rv_5caee053"></script>';
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : []);
    const pages = walk(stage);
    assert.ok(pages.length >= 24);
    const targets = ['articles', 'en/articles', 'ru/articles'].map(p => join(stage, p, 'index.html'));
    for (const page of pages) {
      if (targets.includes(page)) continue;
      assert.doesNotMatch(readFileSync(page, 'utf8'), /recovibes|rv_5caee053/i, page);
    }
    for (const target of targets) {
      assert.ok(pages.includes(target), target);
      const html = readFileSync(target, 'utf8');
      assert.equal(count(html, /api\.recovibes\.com\/loader\.js/g), 1, target);
      assert.equal(html.split(tag).length - 1, 1, target);
      assert.ok(html.indexOf(tag) < html.indexOf('</head>'), target);
      assert.equal(count(html, /<div data-recovibes><\/div>/g), 1, target);
      assert.equal(count(html, /<div class="articles-recovibes"><div data-recovibes><\/div><\/div>/g), 1, target);
      const at = html.indexOf('<div data-recovibes></div>');
      assert.ok(at > html.indexOf('articles-index-grid'), target);
      assert.ok(at > html.lastIndexOf('</article>'), target);
      assert.ok(at < html.indexOf('<footer'), target);
      assert.equal(count(html, /<article class="article-card"/g), source.articles.length, target);
    }
  } finally { rmSync(stage, { recursive: true, force: true }); }
});

test('strong and ul blocks render as semantic HTML in every language, escaped, with no raw Markdown', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-article-rich-'));
  try {
    buildPages(stage);
    for (const lang of LANGUAGES) {
      for (const article of source.articles) {
        const body = readFileSync(outputPath(stage, lang, 'article', article.slug), 'utf8').match(/<div class="article-body">([\s\S]*?)<\/div>/)[1];
        const strongs = article.blocks.filter(block => block.strong);
        const lists = article.blocks.filter(block => block.ul);
        assert.equal(count(body, /<strong>/g), strongs.length, `${lang}/${article.slug} strong count`);
        assert.equal(count(body, /<ul class="article-list">/g), lists.length, `${lang}/${article.slug} ul count`);
        for (const block of strongs) assert.ok(body.includes(`<p><strong>${escapeHtml(block.strong[lang])}</strong></p>`));
        for (const block of lists) assert.ok(body.includes(`<ul class="article-list">${block.ul.map(item => `<li>${escapeHtml(item[lang])}</li>`).join('')}</ul>`));
        assert.doesNotMatch(body, /\*\*|<p>- /, `${lang}/${article.slug} raw markdown`);
      }
    }
    const bullets = source.articles.find(article => article.slug === 'instagram-posting-frequency-2026').blocks.find(block => block.ul);
    assert.equal(bullets.ul.length, 4);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});

test('strong and ul blocks never emit unescaped markup', () => {
  const evil = { he: '<img src=x onerror=alert(1)>', en: '<img src=x onerror=alert(1)>', ru: '<img src=x onerror=alert(1)>' };
  const articlesYaml = readFileSync(new URL('../content/articles.yaml', import.meta.url), 'utf8').replace(/(  - slug: instagram-posting-frequency-2026[\s\S]*?    blocks:\n)/, `$1      - strong: ${JSON.stringify(evil)}\n      - ul:\n          - ${JSON.stringify(evil)}\n`);
  const template = readFileSync(new URL('../scripts/templates/article.html', import.meta.url), 'utf8');
  const html = renderArticle(template, readFileSync(new URL('../content/content.yaml', import.meta.url), 'utf8'), articlesYaml, 'instagram-posting-frequency-2026', 'en');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});
