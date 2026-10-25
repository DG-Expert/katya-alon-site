// Extracts the EVENT-DETAILS section of gas/Code.gs into an ASCII-only block to paste at the END of the live Code.gs.
// Later function declarations override earlier ones, so the live TEXT, hmacHex_ and other helpers stay untouched.
// Usage: node scripts/make-gas-patch.mjs [out=/tmp/gas-event-patch.gs]
import { readFileSync, writeFileSync } from 'node:fs';

export function buildPatch(src) {
  const a = src.indexOf('// ===== EVENT-DETAILS BEGIN'), b = src.indexOf('// ===== EVENT-DETAILS END =====');
  if (a < 0 || b < 0) throw new Error('markers not found in gas/Code.gs');
  const body = src.slice(a, b + '// ===== EVENT-DETAILS END ====='.length);
  if (/[^\x00-\x7f]/.test(body)) throw new Error('section must be ASCII-only (use \\u escapes)');
  return '// PASTE AT THE VERY END of the live Code.gs (below everything). Overrides parsePayload_ and registrantMessage_; keeps live TEXT/hmacHex_.\n' + body + '\n';
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const out = process.argv[2] || '/tmp/gas-event-patch.gs';
  writeFileSync(out, buildPatch(readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8')));
  console.log('wrote ' + out);
}
