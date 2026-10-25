import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { buildPages, LANGUAGES, renderHome, renderWorkshops, urlFor } from '../scripts/build-pages.mjs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = path => readFileSync(new URL(path, projectRoot), 'utf8');

test('robots.txt allows Googlebot and advertises the canonical sitemap', () => {
  const robots = readProjectFile('robots.txt');
  assert.match(robots, /^User-agent: Googlebot$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/katya-alon\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /^Disallow:/m);
});

test('sitemap contains exactly six reciprocal multilingual canonical endpoints', () => {
  const sitemap = readProjectFile('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, [
    'https://katya-alon.com/',
    'https://katya-alon.com/workshops.html',
    'https://katya-alon.com/en/',
    'https://katya-alon.com/en/workshops.html',
    'https://katya-alon.com/ru/',
    'https://katya-alon.com/ru/workshops.html'
  ]);
  assert.ok(locations.every(location => !location.includes('?')));
  assert.equal((sitemap.match(/<url>/g) || []).length, locations.length);
  assert.equal((sitemap.match(/<\/url>/g) || []).length, locations.length);
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);
  for (const entry of entries) {
    const location = entry.match(/<loc>([^<]+)<\/loc>/)[1];
    const page = location.endsWith('workshops.html') ? 'workshops' : 'home';
    for (const lang of LANGUAGES) assert.ok(entry.includes(`hreflang="${lang}" href="${urlFor(lang, page)}"`));
    assert.ok(entry.includes(`hreflang="x-default" href="${urlFor('he', page)}"`));
    assert.equal((entry.match(/<xhtml:link /g) || []).length, 4);
  }
  assert.doesNotMatch(sitemap, /[?&]layout=|application\/ld\+json/);
  assert.match(sitemap, /<\/urlset>\s*$/);
});

test('Pages staging ships prerendered HTML, crawl-control files and nothing private', () => {
  const workflow = readProjectFile('.github/workflows/release.yml');
  const stagingStep = workflow.match(/      - name: Stage only public static files\n        run: \|\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(stagingStep, 'release workflow staging step was not found');

  const script = stagingStep
    .split('\n')
    .map(line => line.replace(/^          /, ''))
    .join('\n');
  const runnerTemp = mkdtempSync(join(tmpdir(), 'katya-pages-stage-'));

  try {
    const result = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', script], {
      cwd: projectRoot,
      env: { ...process.env, RUNNER_TEMP: runnerTemp },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const file of ['robots.txt', 'sitemap.xml']) {
      assert.equal(
        readFileSync(join(runnerTemp, 'pages', file), 'utf8'),
        readProjectFile(file),
        `${file} must be staged byte-for-byte`
      );
    }

    const stage = join(runnerTemp, 'pages');
    assert.deepEqual(readdirSync(stage).sort(), ['assets', 'content', 'css', 'en', 'index.html', 'js', 'robots.txt', 'ru', 'sitemap.xml', 'workshops.html']);
    assert.deepEqual(readdirSync(join(stage, 'en')).sort(), ['index.html', 'workshops.html']);
    assert.deepEqual(readdirSync(join(stage, 'ru')).sort(), ['index.html', 'workshops.html']);
    assert.deepEqual(readdirSync(join(stage, 'content')).sort(), ['content.yaml', 'workshop.yaml']);
    assert.equal(readFileSync(join(stage, 'index.html'), 'utf8'), renderHome(readProjectFile('index.html'), readProjectFile('content/content.yaml')));
    assert.equal(readFileSync(join(stage, 'workshops.html'), 'utf8'), renderWorkshops(readProjectFile('workshops.html'), readProjectFile('content/workshop.yaml')));
    for (const [lang, directory] of [['he', ''], ['en', 'en'], ['ru', 'ru']]) {
      const prefix = directory ? `${directory}/` : '';
      assert.equal(readFileSync(join(stage, prefix, 'index.html'), 'utf8'), renderHome(readProjectFile('index.html'), readProjectFile('content/content.yaml'), lang));
      assert.equal(readFileSync(join(stage, prefix, 'workshops.html'), 'utf8'), renderWorkshops(readProjectFile('workshops.html'), readProjectFile('content/workshop.yaml'), lang));
    }
    for (const file of ['index.html', 'workshops.html', 'en/index.html', 'en/workshops.html', 'ru/index.html', 'ru/workshops.html']) {
      const html = readFileSync(join(stage, file), 'utf8');
      assert.match(html, /<link rel="canonical" href="https:\/\/katya-alon\.com\/(?:en\/|ru\/)?(?:workshops\.html)?">/);
      assert.equal((html.match(/rel="alternate"/g) || []).length, 4);
      assert.doesNotMatch(html, /HMAC|SECRET|CLOUDFLARE_|GAS_URL|script\.google|workers\.dev|turnstile_site_key/i);
      assert.doesNotMatch(html, /(?:href|src)="\.\//);
    }
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test('six-page generation is deterministic', () => {
  const first = mkdtempSync(join(tmpdir(), 'katya-pages-first-'));
  const second = mkdtempSync(join(tmpdir(), 'katya-pages-second-'));
  const paths = ['index.html', 'workshops.html', 'en/index.html', 'en/workshops.html', 'ru/index.html', 'ru/workshops.html'];
  try {
    buildPages(first);
    buildPages(second);
    for (const path of paths) assert.equal(readFileSync(join(first, path), 'utf8'), readFileSync(join(second, path), 'utf8'), path);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('release keeps validate -> prerender check -> Worker -> Pages order', () => {
  const workflow = readProjectFile('.github/workflows/release.yml');
  const job = name => workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`))?.[1] || '';
  assert.match(job('deploy-worker'), /needs: validate/);
  assert.match(job('build-pages'), /needs: deploy-worker/);
  assert.match(job('deploy-pages'), /needs: build-pages/);
  const validate = job('validate');
  assert.ok(validate.indexOf('npm ci') < validate.indexOf('node scripts/build-pages.mjs'));
  assert.ok(validate.indexOf('node scripts/build-pages.mjs') < validate.indexOf('node --test'));
  const pages = job('build-pages');
  assert.ok(pages.indexOf('npm ci') < pages.indexOf('node scripts/build-pages.mjs'));
  assert.ok(pages.indexOf('node scripts/build-pages.mjs') < pages.indexOf('-type l'), 'symlink check must cover generated output');
});
