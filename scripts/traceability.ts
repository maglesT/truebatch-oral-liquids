// Rule-to-test traceability: reads the TrueBatch rules (TB-xx, and the packing rules TB-Px) from docs/rules.md and the
// rule IDs at the start of test names in test/ and e2e/, and prints the rule-to-test list. With --check it fails when a rule has no test, unless
// docs/rules.md marks the rule "later" (its feature is not built yet).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const register = readFileSync(path.join(root, 'docs/rules.md'), 'utf8');

interface Rule { id: string; text: string; later: boolean }
const rules: Rule[] = [];
for (const line of register.split('\n')) {
  const m = /^\| (TB-(?:\d\d|P\d)) \| (.+?) \|(?:.*\| (later\b.*?) \|)?/.exec(line);
  if (m) rules.push({ id: m[1]!, text: m[2]!.trim(), later: m[3] !== undefined });
}

const tests = new Map<string, string[]>();
// Server and database tests (Vitest, `it(`) and browser tests (Playwright, `test(`).
const sources = [
  ...readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.ts')).sort().map((f) => `test/${f}`),
  ...readdirSync(path.join(root, 'e2e')).filter((f) => f.endsWith('.spec.ts')).sort().map((f) => `e2e/${f}`),
];
for (const source of sources) {
  const src = readFileSync(path.join(root, source), 'utf8');
  for (const m of src.matchAll(/\b(?:it|test)\(\s*(['"`])(TB-P\d|(?:TB|PL)-\d\d)([\s\S]*?)\1\s*,/g)) {
    const name = `${m[2]}${m[3]}`.replace(/\\'/g, "'").replace(/\$\{[^}]*\}/g, '…');
    tests.set(m[2]!, [...(tests.get(m[2]!) ?? []), `${source}: ${name}`]);
  }
}

const short = (t: string) => (t.length > 110 ? `${t.slice(0, 107)}…` : t);
const covered = rules.filter((r) => tests.has(r.id));
const lines = [
  '| Rule | Requirement | Tests |',
  '|------|-------------|-------|',
  ...rules.map((r) => `| ${r.id} | ${short(r.text).replaceAll('|', '/')} | ${(tests.get(r.id) ?? [r.later ? '*later*' : '**NONE**']).map((x) => x.replaceAll('|', '/')).join('<br>')} |`),
  '',
  `${rules.length} rules, ${covered.length} with tests, ${rules.filter((r) => r.later && !tests.has(r.id)).length} later; ${[...tests.values()].flat().length} rule-named tests (TB and platform PL).`,
];

if (process.argv.includes('--check')) {
  const missing = rules.filter((r) => !tests.has(r.id) && !r.later).map((r) => r.id);
  if (missing.length) console.error(`Rules without tests: ${missing.join(', ')}`);
  console.log(lines.at(-1));
  process.exit(missing.length ? 1 : 0);
}
console.log(lines.join('\n'));
