import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function runLegacyRedirect(script, href) {
  const listeners = new Map();
  const location = new URL(href);
  let replacement = '';
  location.replace = value => { replacement = value; };
  const document = {
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const context = vm.createContext({
    window: { location }, document, URL, URLSearchParams, Intl, console,
    AbortController, AbortSignal, fetch, Response, crypto
  });
  vm.runInContext(script, context);
  listeners.get('DOMContentLoaded')();
  return replacement;
}

test('legacy home language queries redirect once to canonical paths and preserve hashes', () => {
  const script = read('js/main.js');
  assert.equal(
    runLegacyRedirect(script, 'https://katya-alon.com/?lang=ru&layout=story#services'),
    '/ru/#services'
  );
  assert.equal(
    runLegacyRedirect(script, 'https://katya-alon.com/en/?lang=he&keep=1#about'),
    '/?keep=1#about'
  );
});

test('legacy workshop language queries preserve only valid layout preview and hashes', () => {
  const script = read('js/workshops.js');
  assert.equal(
    runLegacyRedirect(script, 'https://katya-alon.com/workshops.html?lang=en&layout=story#registration'),
    '/en/workshops.html?layout=story#registration'
  );
  assert.equal(
    runLegacyRedirect(script, 'https://katya-alon.com/ru/workshops.html?lang=he&layout=unsafe#content-2'),
    '/workshops.html#content-2'
  );
});

test('runtime hydration derives language from path and fetches YAML from the site root', () => {
  const main = read('js/main.js');
  const workshops = read('js/workshops.js');
  assert.match(main, /currentLang = languageFromPath\(\)/);
  assert.match(main, /new URL\('\/content\/content\.yaml', window\.location\.origin\)/);
  assert.match(workshops, /currentLang = requestedLanguage\(\)/);
  assert.match(workshops, /new URL\('\/content\/workshop\.yaml', window\.location\.origin\)/);
  assert.match(workshops, /robots\.content = 'noindex,follow'/);
  assert.match(workshops, /link\.href = `\$\{workshopsPath\(lang\)\}\$\{previewLayout/);
  assert.doesNotMatch(main, /new URL\('\.\/content\//);
  assert.doesNotMatch(workshops, /new URL\('\.\/content\//);
});
