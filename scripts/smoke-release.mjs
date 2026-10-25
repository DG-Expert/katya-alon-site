// Read-only post-deploy smoke checks. No registration POST is ever sent.
// Usage: node scripts/smoke-release.mjs worker | pages <base-url>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTopLevelFlowMap } from './validate-workshop.mjs';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function retry(label, check) {
  let last;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try { return await check(); } catch (error) {
      last = error;
      if (attempt < 5) await wait(3000);
    }
  }
  throw new Error(`${label} smoke check failed after retries: ${last?.message || last}`);
}

export async function checkWorker(endpoint, fetchImpl = fetch) {
  if (!/^https:\/\//.test(endpoint)) throw new Error('Worker endpoint must be HTTPS');
  for (const origin of ['https://dg-expert.github.io', 'https://katya-alon.com']) {
    const response = await fetchImpl(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    if (response.status !== 204) throw new Error(`expected HTTP 204 for ${origin}, received ${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== origin) throw new Error(`unexpected Access-Control-Allow-Origin for ${origin}`);
  }
}

export async function checkPages(baseUrl, fetchImpl = fetch) {
  const url = new URL('./workshops.html', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (url.protocol !== 'https:') throw new Error('Pages URL must be HTTPS');
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`expected a successful response, received ${response.status}`);
  const body = await response.text();
  if (!/<html[\s>]/i.test(body) || !/workshop/i.test(body)) throw new Error('Pages response is not the workshop HTML');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, argument, ...extra] = process.argv.slice(2);
  if (extra.length || !['worker', 'pages'].includes(mode) || (mode === 'pages' && !argument) || (mode === 'worker' && argument)) {
    throw new Error('usage: node scripts/smoke-release.mjs worker | pages <base-url>');
  }

  if (mode === 'worker') {
    const yaml = readFileSync(new URL('../content/workshop.yaml', import.meta.url), 'utf8');
    const endpoint = parseTopLevelFlowMap(yaml, 'registration').endpoint;
    await retry('Worker OPTIONS', () => checkWorker(endpoint));
    console.log('Worker OPTIONS smoke check passed');
  } else {
    await retry('GitHub Pages', () => checkPages(argument));
    console.log('GitHub Pages smoke check passed');
  }
}
