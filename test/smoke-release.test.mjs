import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPages, checkWorker } from '../scripts/smoke-release.mjs';

test('Worker smoke check sends only OPTIONS and verifies both exact CORS origins', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': options.headers.Origin } });
  };
  await checkWorker('https://worker.example.test/api/register', fetchImpl);
  assert.deepEqual(requests.map(({ options }) => options.method), ['OPTIONS', 'OPTIONS']);
  assert.deepEqual(requests.map(({ options }) => options.headers.Origin), ['https://dg-expert.github.io', 'https://katya-alon.com']);
  await assert.rejects(() => checkWorker('https://worker.example.test/api/register', async () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })), /unexpected/);
});

test('Pages smoke check requests and validates all 24 canonical paths', async () => {
  const requested = [];
  await checkPages('https://example.test/project/', async url => {
    requested.push(String(url));
    const lang = String(url).includes('/en/') ? 'en' : String(url).includes('/ru/') ? 'ru' : 'he';
    return new Response(`<!doctype html><html lang="${lang}"><head><link rel="canonical" href="https://katya-alon.com/${lang === 'he' ? '' : `${lang}/`}"></head></html>`, { status: 200 });
  });
  assert.equal(requested.length, 24);
  for (const path of ['', 'workshops.html', 'articles/', 'articles/organic-instagram-marketing/']) {
    assert.ok(requested.includes(`https://example.test/project/${path}`));
    assert.ok(requested.includes(`https://example.test/project/en/${path}`));
    assert.ok(requested.includes(`https://example.test/project/ru/${path}`));
  }
  await assert.rejects(() => checkPages('http://example.test/', async () => new Response('')), /HTTPS/);
});
