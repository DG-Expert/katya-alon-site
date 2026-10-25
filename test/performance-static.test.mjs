import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
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
      'fonts.googleapis.com/css2',
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
