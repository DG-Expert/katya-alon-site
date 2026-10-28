import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { buildPages, enabledServices, escapeHtml, LANGUAGES, routeFor, urlFor } from '../scripts/build-pages.mjs';

const root = new URL('../', import.meta.url);
const source = yaml.load(readFileSync(new URL('content/articles.yaml', root), 'utf8'));
const site = yaml.load(readFileSync(new URL('content/content.yaml', root), 'utf8'));
const count = (html, pattern) => (html.match(pattern) || []).length;
const languageTag = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' };
const services = enabledServices(site);

function outputPath(stage, lang, page, slug = '') {
  const prefix = lang === 'he' ? '' : lang;
  if (page === 'home') return join(stage, prefix, 'index.html');
  if (page === 'workshops') return join(stage, prefix, 'workshops.html');
  if (page === 'articles') return join(stage, prefix, 'articles', 'index.html');
  if (page === 'service') return join(stage, prefix, 'services', slug, 'index.html');
  return join(stage, prefix, 'articles', slug, 'index.html');
}

test('article source has safe unique slugs, complete translations and no invented dates', () => {
  assert.equal(source.articles.length, 5);
  assert.equal(new Set(source.articles.map(article => article.slug)).size, 5);
  for (const article of source.articles) {
    assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(article.published, null);
    assert.ok(site.services.items.some(service => service.anchor === article.service_anchor && service.enabled !== false));
    for (const field of ['title', 'seo_title', 'meta_description']) {
      for (const lang of LANGUAGES) assert.ok(article[field][lang].trim(), `${article.slug}.${field}.${lang}`);
    }
    for (const [index, block] of article.blocks.entries()) {
      const field = block.h2 ? 'h2' : 'p';
      for (const lang of LANGUAGES) assert.ok(block[field][lang].trim(), `${article.slug}.blocks.${index}.${field}.${lang}`);
    }
  }
});

test('all 39 pages expose one H1, main and top-level footer with valid local links', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-articles-'));
  try {
    buildPages(stage);
    const pages = ['home', 'workshops', 'articles'];
    for (const lang of LANGUAGES) {
      for (const page of pages) {
        const html = readFileSync(outputPath(stage, lang, page), 'utf8');
        assert.equal(count(html, /<h1\b/g), 1, `${lang}/${page} H1`);
        assert.equal(count(html, /<main\b/g), 1, `${lang}/${page} main`);
        assert.equal(count(html, /<footer\b/g), 1, `${lang}/${page} footer`);
      }
      for (const [page, slug] of [...source.articles.map(article => ['article', article.slug]), ...services.map(service => ['service', service.slug])]) {
        const html = readFileSync(outputPath(stage, lang, page, slug), 'utf8');
        assert.equal(count(html, /<h1\b/g), 1, `${lang}/${slug} H1`);
        assert.equal(count(html, /<main\b/g), 1, `${lang}/${slug} main`);
        assert.equal(count(html, /<footer\b/g), 1, `${lang}/${slug} footer`);
      }
    }

    const social = ['https://www.instagram.com/kate_alon_marketing/', 'https://www.facebook.com/share/1QT8QYg3Gn/'];
    const allPages = lang => [outputPath(stage, lang, 'home'), outputPath(stage, lang, 'workshops'), outputPath(stage, lang, 'articles'),
      ...source.articles.map(article => outputPath(stage, lang, 'article', article.slug)),
      ...services.map(service => outputPath(stage, lang, 'service', service.slug))];
    for (const lang of LANGUAGES) {
      for (const file of allPages(lang)) {
        const footer = readFileSync(file, 'utf8').match(/<footer\b[\s\S]*<\/footer>/)[0];
        for (const [index, href] of social.entries()) {
          const label = escapeHtml(site.footer[index ? 'facebook' : 'instagram'][lang]);
          assert.ok(footer.includes(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`) ||
            footer.includes(`<a href="${href}" target="_blank" rel="noopener noreferrer" data-site-copy="footer.${index ? 'facebook' : 'instagram'}">${label}</a>`) ||
            footer.includes(`<a href="${href}" target="_blank" rel="noopener noreferrer" data-content="footer.${index ? 'facebook' : 'instagram'}">${label}</a>`),
          `${file}: ${href}`);
        }
      }
    }

    const generated = LANGUAGES.flatMap(allPages);
    assert.equal(generated.length, 39);
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
          const value = block.h2?.[lang] || block.p?.[lang];
          assert.ok(html.includes(escapeHtml(value)), `${lang}/${article.slug}: missing ${value}`);
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

test('article listing and homepage expose the expected editorial order and five services', () => {
  const stage = mkdtempSync(join(tmpdir(), 'katya-article-list-'));
  try {
    buildPages(stage);
    for (const lang of LANGUAGES) {
      const listing = readFileSync(outputPath(stage, lang, 'articles'), 'utf8');
      assert.equal(count(listing, /class="article-card"/g), 5);
      const positions = source.articles.map(article => listing.indexOf(routeFor(lang, 'article', article.slug)));
      assert.deepEqual([...positions].sort((a, b) => a - b), positions);
      const home = readFileSync(outputPath(stage, lang, 'home'), 'utf8');
      assert.equal(count(home, /class="service-row /g), 5);
      assert.equal(count(home, /class="article-card"/g), 3);
      assert.ok(home.includes(escapeHtml(site.site.description[lang])));
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
});
