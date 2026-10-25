import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const bytes = path => readFileSync(new URL(`../${path}`, import.meta.url)).byteLength;
const indexHtml = read('index.html');
const workshopsHtml = read('workshops.html');
const workshopsCss = read('css/workshops.css');
const workshopsJs = read('js/workshops.js');

function head(html) {
  return html.match(/<head>[\s\S]*?<\/head>/)?.[0] || '';
}

function assertOrdered(source, markers) {
  let previous = -1;
  markers.forEach(marker => {
    const current = source.indexOf(marker);
    assert.ok(current > previous, `${marker} should appear in dependency order`);
    previous = current;
  });
}

test('above-the-fold hero content is never hidden behind reveal state', () => {
  const homeHero = indexHtml.match(/<section id="hero"[\s\S]*?<!-- ═══════════ Clients Strip/)?.[0] || '';
  const workshopHero = workshopsHtml.match(/<section class="workshop-hero"[\s\S]*?<div class="workshop-content-flow">/)?.[0] || '';

  assert.doesNotMatch(homeHero, /fade-up/);
  assert.doesNotMatch(workshopHero, /data-reveal/);
  assert.doesNotMatch(workshopsHtml, /\bis-loading\b/);
  assert.doesNotMatch(workshopsCss, /\.workshop-page\.is-loading/);
  assert.match(workshopsHtml, /content-section-one[\s\S]*?data-reveal/);
});

test('styles load before scripts and deferred dependencies precede application code', () => {
  for (const [html, applicationScript, styles] of [
    [indexHtml, '/js/main.js', ['/css/styles.css', '/css/tailwind.css']],
    [workshopsHtml, '/js/workshops.js', ['/css/styles.css', '/css/workshops.css', '/css/tailwind.css']]
  ]) {
    const pageHead = head(html);
    assertOrdered(pageHead, [
      ...styles,
      'lucide.min.js',
      'js-yaml.min.js',
      applicationScript
    ]);
    assert.match(pageHead, /<link rel="stylesheet" href="\/css\/tailwind\.css">/);
    assert.doesNotMatch(pageHead, /cdn\.tailwindcss\.com|tailwind\.config/);
    assert.match(pageHead, new RegExp(`<script defer src="${applicationScript.replaceAll('.', '\\.')}"></script>`));
    assert.match(pageHead, /<script defer src="[^"]*lucide\.min\.js"><\/script>/);
    assert.match(pageHead, /<script defer src="[^"]*js-yaml\.min\.js"><\/script>/);
  }
});

test('critical typography is self-hosted without a third-party stylesheet', () => {
  for (const html of [indexHtml, workshopsHtml]) {
    assert.doesNotMatch(head(html), /fonts\.(?:googleapis|gstatic)\.com/);
  }
  const styles = read('css/styles.css');
  assert.match(styles, /rubik-normal-hebrew\.woff2/);
  assert.match(styles, /font-display:\s*swap/);
});

test('large portraits use responsive variants and reserve their layout space', () => {
  assert.match(indexHtml, /katya-3-720\.webp 720w, \/assets\/images\/katya-3-1440\.webp 1440w/);
  assert.match(workshopsHtml, /id="power-image"[^>]*width="3360"[^>]*height="5040"/);
  assert.match(workshopsHtml, /id="instructor-image"[^>]*width="1312"[^>]*height="1199"/);
  assert.match(workshopsJs, /katya-2-720\.webp 720w, \/assets\/images\/katya-2-1440\.webp 1440w/);
  assert.match(workshopsJs, /katya-workshop-cutout-480\.webp 480w, \/assets\/images\/katya-workshop-cutout-960\.webp 960w/);
  assert.ok(bytes('assets/images/katya-2-720.webp') < 100_000);
  assert.ok(bytes('assets/images/katya-3-720.webp') < 100_000);
  assert.ok(bytes('assets/images/katya-workshop-cutout-480.webp') < 50_000);
});

test('home has a main landmark and hidden marquee controls leave the tab order', () => {
  assert.equal((indexHtml.match(/<main\b/g) || []).length, 1);
  assert.match(indexHtml, /<main id="main-content">[\s\S]*<\/main>[\s\S]*<footer/);
  assert.match(read('js/main.js'), /aria-hidden="true">\$\{recommendationHtml\(true\)\}/);
  assert.match(read('js/main.js'), /isDuplicate \? 'tabindex="-1"'/);
});

test('registration paste is native and phone normalization remains on input', () => {
  assert.doesNotMatch(workshopsJs, /addEventListener\(['"]paste|handleMobilePaste/);
  assert.match(workshopsJs, /if \(name === 'mobile'\) sanitizeMobileInput\(input\)/);
  assert.doesNotMatch(workshopsHtml, /id="mobile"[\s\S]*?maxlength="15"[\s\S]*?<\/div>/);
});

test('Turnstile waits for registration proximity with interaction fallbacks', () => {
  const loader = workshopsJs.match(/async function loadWorkshopContent\(\)[\s\S]*?\n  }\n\n  document\.addEventListener/)?.[0] || '';
  const scheduler = workshopsJs.match(/function scheduleTurnstile\(\)[\s\S]*?\n  }\n\n  function resetTurnstile/)?.[0] || '';

  assert.match(loader, /scheduleTurnstile\(\)/);
  assert.doesNotMatch(loader, /setupTurnstile\(\)/);
  assert.match(scheduler, /IntersectionObserver/);
  assert.match(scheduler, /rootMargin: '600px 0px'/);
  assert.match(scheduler, /addEventListener\('focusin'/);
  assert.match(scheduler, /addEventListener\('pointerdown'/);
  assert.match(scheduler, /a\[href="#registration"\]/);
});
