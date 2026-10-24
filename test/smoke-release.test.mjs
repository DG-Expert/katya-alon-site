import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPages, checkWorker } from '../scripts/smoke-release.mjs';

test('Worker smoke check sends only OPTIONS and verifies exact CORS origin', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://dg-expert.github.io' } });
  };
  await checkWorker('https://worker.example.test/api/register', fetchImpl);
  assert.equal(request.options.method, 'OPTIONS');
  assert.equal(request.options.headers.Origin, 'https://dg-expert.github.io');
  await assert.rejects(() => checkWorker('https://worker.example.test/api/register', async () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } })), /unexpected/);
});

test('Pages smoke check requests workshops.html and validates the response', async () => {
  let requested;
  await checkPages('https://example.test/project/', async url => {
    requested = String(url);
    return new Response('<!doctype html><html><title>Workshop</title></html>', { status: 200 });
  });
  assert.equal(requested, 'https://example.test/project/workshops.html');
  await assert.rejects(() => checkPages('http://example.test/', async () => new Response('')), /HTTPS/);
});
