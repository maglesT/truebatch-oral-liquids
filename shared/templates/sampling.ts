/**
 * C7 Sampling plan by lot size (AQL), single sampling, normal inspection.
 *
 * The tables are those of MIL-STD-105E (US Department of Defense, 1989; a US government work in the public
 * domain): Table I (sample size code letters) and Table II-A (single sampling plans for normal inspection).
 * ANSI/ASQ Z1.4 and ISO 2859-1 single sampling, normal inspection give the same numbers. The text of ISO 2859-1
 * is NOT copied here; only the public-domain MIL-STD-105E numbers are used.
 * Check made when this file was written: resolving every arrow below gives the same sample size and accept
 * number as the independent AQLSchemes package (CRAN) tables in all 256 cells (16 code letters × 16 AQLs).
 *
 * Covered: AQL 0.010 to 10 (percent nonconforming). The columns above 10 (nonconformities per 100 units)
 * are not included. "AQL 0" (critical defects, zero accepted) is a plant rule, not a table column: it is
 * taken as accept 0 / reject 1 at the code letter's sample size, and the line says so.
 */
import { Dec } from './dec.js';
import { refuse, run, type Outcome } from './core.js';
import type { Check } from './rounding.js';

export type Level = 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'I' | 'II' | 'III';
const LEVELS: Level[] = ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'];

/** Table I: lot size range (upper end; last open) → code letter per level S-1, S-2, S-3, S-4, I, II, III. */
const TABLE_I: [number, string][] = [
  [8, 'AAAAAAB'],
  [15, 'AAAAABC'],
  [25, 'AABBBCD'],
  [50, 'ABBCCDE'],
  [90, 'BBCCCEF'],
  [150, 'BBCDDFG'],
  [280, 'BCDEEGH'],
  [500, 'BCDEFHJ'],
  [1200, 'CCEFGJK'],
  [3200, 'CDEGHKL'],
  [10000, 'CDFGJLM'],
  [35000, 'CDFHKMN'],
  [150000, 'DEGJLNP'],
  [500000, 'DEGJMPQ'],
  [Infinity, 'DEHKNQR'],
];

const SAMPLE: Record<string, number> = { A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000 };
const LETTERS = 'ABCDEFGHJKLMNPQR';

export const AQLS = ['0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10'] as const;

/**
 * Table II-A, columns AQL 0.010 … 10 as above. A number is the accept number Ac (reject number Re = Ac + 1);
 * "v" = use the first plan below the arrow, "^" = use the first plan above the arrow (the sample size then
 * changes to that plan's).
 */
const TABLE_II_A: Record<string, string> = {
  A: 'v v v v v v v v v v v v v v 0 v',
  B: 'v v v v v v v v v v v v v 0 ^ v',
  C: 'v v v v v v v v v v v v 0 ^ v 1',
  D: 'v v v v v v v v v v v 0 ^ v 1 2',
  E: 'v v v v v v v v v v 0 ^ v 1 2 3',
  F: 'v v v v v v v v v 0 ^ v 1 2 3 5',
  G: 'v v v v v v v v 0 ^ v 1 2 3 5 7',
  H: 'v v v v v v v 0 ^ v 1 2 3 5 7 10',
  J: 'v v v v v v 0 ^ v 1 2 3 5 7 10 14',
  K: 'v v v v v 0 ^ v 1 2 3 5 7 10 14 21',
  L: 'v v v v 0 ^ v 1 2 3 5 7 10 14 21 ^',
  M: 'v v v 0 ^ v 1 2 3 5 7 10 14 21 ^ ^',
  N: 'v v 0 ^ v 1 2 3 5 7 10 14 21 ^ ^ ^',
  P: 'v 0 ^ v 1 2 3 5 7 10 14 21 ^ ^ ^ ^',
  Q: '0 ^ v 1 2 3 5 7 10 14 21 ^ ^ ^ ^ ^',
  R: '^ ^ 1 2 3 5 7 10 14 21 ^ ^ ^ ^ ^ ^',
};

export function codeLetter(lotSize: number, level: Level): string {
  const col = LEVELS.indexOf(level);
  if (col < 0) refuse(`The inspection level "${level}" is not one of ${LEVELS.join(', ')}`);
  const row = TABLE_I.find(([max]) => lotSize <= max);
  return row?.[1][col] ?? refuse('Lot size out of range');
}

/** Single sampling plan (normal) for a code letter and AQL, following the arrows. */
export function plan(letter: string, aql: string): { letter: string; n: number; ac: number; re: number } {
  const col = (AQLS as readonly string[]).indexOf(aql);
  if (col < 0) refuse(`The AQL "${aql}" is not a column of the table (0.010 to 10: ${AQLS.join(', ')})`);
  let k = LETTERS.indexOf(letter);
  for (let guard = 0; guard < 20; guard += 1) {
    const L = LETTERS[k] ?? refuse('Code letter out of range');
    const cell = (TABLE_II_A[L] ?? '').split(' ')[col] ?? '';
    if (cell === 'v') k += 1;
    else if (cell === '^') k -= 1;
    else {
      const ac = Number(cell);
      return { letter: L, n: SAMPLE[L] ?? 0, ac, re: ac + 1 };
    }
  }
  return refuse('The sampling table could not be read');
}

export interface C7Input {
  /** Lot size in units (e.g. tablets from a count by weight). */
  readonly lotSize: string | { readonly value: string; readonly unit: string };
  readonly level: Level;
  /** AQL per defect class, e.g. { critical: "0", major: "0.65", minor: "2.5" }. */
  readonly classes: Readonly<Record<string, string>>;
  /** Defects found per class, once inspected (optional). */
  readonly found?: Readonly<Record<string, number | { readonly value: string; readonly unit: string }>>;
}

export interface ClassPlan {
  readonly name: string;
  readonly aql: string;
  readonly letter: string;
  readonly sampleSize: number;
  readonly accept: number;
  readonly reject: number;
  readonly hundredPercent: boolean;
  readonly found?: number;
  readonly pass?: boolean;
}

/** C7 Sampling plan by lot size: code letter, sample size and accept/reject numbers per defect class; pass/fail when defects are given. */
export function c7SamplingPlan(i: C7Input): Outcome<{ readonly letter: string; readonly plans: readonly ClassPlan[] }> {
  return run(() => {
    // A count from a step comes as a value with its unit; a lot size worked out (packs from tablets) is cut to whole units.
    const lot = typeof i.lotSize === 'object' && i.lotSize !== null ? new Dec(i.lotSize.value).floor().toFixed(0) : i.lotSize;
    if (typeof lot !== 'string' || !/^\d+$/.test(lot.trim())) refuse('The lot size must be a whole number written as text, e.g. "300000"');
    const N = Number(lot);
    if (N < 2) refuse('The lot size must be 2 or more');
    const letter = codeLetter(N, i.level);
    const plans: ClassPlan[] = Object.entries(i.classes).map(([name, aql]) => {
      const p = aql.trim() === '0' ? { letter, n: SAMPLE[letter] ?? 0, ac: 0, re: 1 } : plan(letter, aql.trim());
      const hundred = p.n >= N;
      const n = hundred ? N : p.n;
      const x = i.found?.[name];
      const f = typeof x === 'object' && x !== null ? Number(x.value) : x;
      if (f !== undefined && (!Number.isInteger(f) || f < 0)) refuse(`The number of ${name} defects must be a whole number, 0 or more`);
      return { name, aql, letter: p.letter, sampleSize: n, accept: p.ac, reject: p.re, hundredPercent: hundred, ...(f === undefined ? {} : { found: f, pass: f <= p.ac }) };
    });
    if (plans.length === 0) refuse('Give at least one defect class with its AQL');
    const sample = Math.max(...plans.map((p) => p.sampleSize));
    const decided = plans.every((p) => p.pass !== undefined);
    const pass = decided ? plans.every((p) => p.pass === true) : true;
    // Plain words first (owner, 17 Nov 2026): how many to test and the accept and reject numbers; the table's code
    // letter last, and the letter whose plan the AQL takes only when it moves.
    const moved = plans.filter((p) => p.letter !== letter && !p.hundredPercent);
    const shown =
      `${plans.every((p) => p.hundredPercent) ? `Inspect all ${N}` : `Sample ${sample} of ${N}`} (level ${i.level}). ` +
      plans
        .map((p) => `${p.name}${p.sampleSize !== sample ? ` (${p.hundredPercent ? `all ${p.sampleSize}` : `sample ${p.sampleSize}`})` : ''}: accept ${p.accept}, reject ${p.reject} (AQL ${p.aql}${p.aql.trim() === '0' ? ', zero accepted, plant rule' : ''})${p.found === undefined ? '' : `; found ${p.found}: ${p.pass === true ? 'accept' : 'REJECT'}`}`)
        .join('; ') +
      `. Code letter ${letter}${moved.length ? `; ${moved.map((p) => `the plan for AQL ${p.aql} is at letter ${p.letter}`).join(', ')}` : ''}.`;
    const check: Check = { pass, level: pass ? 'pass' : 'fail', rounded: decided ? (pass ? 'accept' : 'reject') : 'plan only', shown };
    return { ok: true, value: new Dec(sample), unit: 'units', letter, plans, shown, ...(decided ? { check } : {}) };
  });
}
