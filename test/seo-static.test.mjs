import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('sitemap contains only the confirmed Hebrew-default canonical endpoints', () => {
  const sitemap = readProjectFile('sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /Multilingual expansion awaits a separate indexing strategy/);

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, [
    'https://katya-alon.com/',
    'https://katya-alon.com/workshops.html'
  ]);
  assert.ok(locations.every(location => !location.includes('?')));
  assert.equal((sitemap.match(/<url>/g) || []).length, locations.length);
  assert.equal((sitemap.match(/<\/url>/g) || []).length, locations.length);
  assert.match(sitemap, /<\/urlset>\s*$/);
});

test('Pages staging copies both crawl-control files into the public artifact', () => {
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
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});
