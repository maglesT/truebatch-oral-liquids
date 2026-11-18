/**
 * Packing templates (TrueBatch Tablets Packing): T27 expiry from the shelf life (TB-P8), C8 printed data against the
 * batch data (TB-P5, TB-P9) and C9 codes of the customer's serialisation system read from sample packs. Dates are
 * plain text (YYYY-MM-DD); a printed date is a month.
 */
import { Dec } from './dec.js';
import { refuse, run, type Outcome } from './core.js';
import type { Check } from './rounding.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
type Rule = 'month before' | 'same month';
const word = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const checkOf = (pass: boolean, shown: string): Check => ({ pass, level: pass ? 'pass' : 'fail', rounded: pass ? 'match' : 'mismatch', shown });

/** The month (YYYY-MM) of a date written YYYY-MM-DD or YYYY-MM. */
function monthOf(date: string, what: string): string {
  const m = /^(\d{4})-(\d{2})(-(\d{2}))?$/.exec(typeof date === 'string' ? date.trim() : '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) refuse(`${what} "${String(date)}" is not a date written YYYY-MM-DD`);
  return `${m[1]}-${m[2]}`;
}

/** The expiry month: the month of manufacture + the shelf life (− 1 month with "month before"). */
export function expiryMonth(manufactured: string, months: string, rule: Rule = 'month before'): string {
  const n = Number(typeof months === 'string' ? months.trim() : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 120) refuse(`The shelf life "${String(months)}" must be a whole number of months, 1 to 120`);
  const m = monthOf(manufactured, 'The date of manufacture');
  const index = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n - (rule === 'same month' ? 0 : 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- T27 Expiry from the shelf life
export interface T27Input { readonly manufactured: string; readonly months: string; readonly rule?: Rule }

/** T27 Expiry from the approved shelf life (TB-P8): never typed. */
export function t27Expiry(i: T27Input): Outcome<{ readonly expiry: string; readonly manufactured: string }> {
  return run(() => {
    const expiry = expiryMonth(i.manufactured, i.months, i.rule);
    const mfg = monthOf(i.manufactured, 'The date of manufacture');
    const shown = `Manufactured ${word(mfg)}, shelf life ${i.months.trim()} months${i.rule === 'same month' ? '' : ' (to the end of the month before)'}: expiry ${word(expiry)}`;
    return { ok: true, value: new Dec(i.months.trim()), unit: '', expiry, manufactured: mfg, shown };
  });
}

// The labels printed before a value, in the common Indian print styles, with any dots, colons and spaces: "MFG.DT.",
// "MFD.", "Mfg. Date", "EXP.DT.", "EXP.", "Expiry date", "Use before"; "M.R.P. Rs."; "B.No.", "Batch No.".
const DATE_LABEL = /^(M\W*F\W*[GD]|MANUFACTURED|EXP(IRY)?|USE\W*BEFORE|USE\W*BY)(\W*(DATE|DT))?\W*/;
const BATCH_LABEL = /^(B\W*NO|BATCH\W*NO|BATCH)\W*/;

/** A printed month: "10/2028", "10-28", "OCT 2028", "EXP. OCT.2028", "EXP.DT. 10/2028", "2028-10". */
export function printedMonth(text: string): string | null {
  const t = text.toUpperCase().trim().replace(DATE_LABEL, '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]!.padStart(2, '0')}` : null;
  m = /^(\d{1,2}|[A-Z]{3})[A-Z]*[\s./-]*(\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  const month = /^\d/.test(m[1]!) ? Number(m[1]) : MONTHS.indexOf(m[1]!) + 1;
  if (month < 1 || month > 12) return null;
  return `${m[2]!.length === 2 ? `20${m[2]}` : m[2]}-${String(month).padStart(2, '0')}`;
}
// "M.R.P. Rs. 125.00 (Incl. of all taxes)", "MRP Rs.125.00 incl. of all taxes", "MRP ₹ 125/-": the amount.
const money = (t: string) => t.toUpperCase().replace(/\(?\s*INCL.*$/, '').replace(/^\W*M\W*R\W*P\W*/, '').replace(/RS\.?|INR|₹|\/-|,|\s|:/g, '').replace(/\.$/, '');
const plain = (t: string) => t.toUpperCase().replace(/\s+/g, '');

// ---------------------------------------------------------------- C8 Printed data against the batch data
export type C8Input = { readonly what: string; readonly printed: string } & (
  | { readonly kind: 'text'; readonly expected: string }
  | { readonly kind: 'month'; readonly expected: string }
  | { readonly kind: 'expiry'; readonly manufactured: string; readonly months: string; readonly rule?: Rule }
  | { readonly kind: 'money'; readonly expected?: string });

/** C8 Printed data (batch number, dates, MRP) as read from the pack, against the batch record (TB-P9). */
export function c8PrintedData(i: C8Input): Outcome {
  return run(() => {
    const printed = typeof i.printed === 'string' ? i.printed.trim() : refuse(`${i.what}: the printed text is missing`);
    let pass: boolean;
    let expected: string;
    if (i.kind === 'text') {
      expected = i.expected.trim();
      // As printed, or after its label ("B.No. TB260001"); the number itself must be the same.
      pass = [printed, printed.toUpperCase().replace(BATCH_LABEL, '')].some((p) => plain(p) === plain(expected));
    } else if (i.kind === 'money') {
      if (i.expected === undefined) {
        expected = 'no MRP';
        pass = ['NONE', '-', 'NA', 'N/A'].includes(printed.toUpperCase());
      } else {
        expected = `Rs. ${new Dec(i.expected).toFixed(2)}`;
        const p = money(printed);
        pass = /^\d+(\.\d+)?$/.test(p) && new Dec(p).eq(i.expected);
      }
    } else {
      const want = i.kind === 'month' ? monthOf(i.expected, 'The date of manufacture') : expiryMonth(i.manufactured, i.months, i.rule);
      expected = `${word(want)}${i.kind === 'expiry' ? ` (manufactured ${word(monthOf(i.manufactured, 'The date of manufacture'))} + ${i.months.trim()} months)` : ''}`;
      pass = printedMonth(printed) === want;
    }
    const shown = `${i.what} printed "${printed}"; batch record ${expected}: ${pass ? 'matches' : 'DOES NOT MATCH'}`;
    return { ok: true, value: new Dec(pass ? 0 : 1), unit: 'units', check: checkOf(pass, shown), shown };
  });
}

// ---------------------------------------------------------------- C9 Serialisation codes of sample packs
/** The GS1 element strings of one code, written "(01)…(17)…(10)…(21)…" or raw ("01…17…10…<GS>21…"). */
export function gs1(code: string): Record<string, string> | null {
  const c = code.replace(/^\]d2/, '');
  const out: Record<string, string> = {};
  if (c.startsWith('(')) {
    for (const m of c.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]!] = m[2]!;
    return Object.keys(out).length ? out : null;
  }
  let rest = c;
  while (rest.length) {
    const ai = rest.slice(0, 2);
    const fixed = ({ '01': 14, '17': 6, '11': 6, '15': 6 } as Record<string, number>)[ai];
    if (fixed) { out[ai] = rest.slice(2, 2 + fixed); rest = rest.slice(2 + fixed); continue; }
    if (ai !== '10' && ai !== '21') return null;
    const end = rest.search(/[\u001d|]/);
    out[ai] = end < 0 ? rest.slice(2) : rest.slice(2, end);
    rest = end < 0 ? '' : rest.slice(end + 1);
  }
  return out;
}
const gtinValid = (g: string) => /^\d{14}$/.test(g) && [...g.slice(0, 13)].reduce((s, d, n) => s + Number(d) * (n % 2 === 0 ? 3 : 1), 0) % 10 === (10 - Number(g[13])) % 10;
const SERIAL = /^[!"%-?A-Z_a-z]{1,20}$/;

export interface C9Input {
  /** The codes read from the sample packs, separated by spaces or new lines. */
  readonly codes: string;
  readonly gtin: string;
  readonly batch: string;
  readonly manufactured: string;
  readonly months: string;
  readonly rule?: Rule;
  /** The codes read earlier in this batch (earlier rounds): a serial read twice is refused. */
  readonly earlier?: string;
}

/** C9 Serialisation sample: each code's GTIN, batch and expiry are this batch's, its serial well formed and new in the batch. */
export function c9SerialCodes(i: C9Input): Outcome<{ readonly serials: readonly string[] }> {
  return run(() => {
    const codes = (typeof i.codes === 'string' ? i.codes : '').split(/\s+/).filter(Boolean);
    if (!codes.length) refuse('Read at least one code from a sample pack');
    if (!gtinValid(i.gtin)) refuse(`The pack's GTIN "${i.gtin}" is not 14 digits with a right check digit`);
    const expiry = expiryMonth(i.manufactured, i.months, i.rule);
    const seen = new Set((i.earlier ?? '').split(/\s+/).filter(Boolean).map((c) => gs1(c)?.['21']).filter((s): s is string => !!s));
    const problems: string[] = [];
    const serials: string[] = [];
    codes.forEach((code, n) => {
      const e = gs1(code);
      const p: string[] = [];
      if (!e) p.push('not a GS1 code');
      else {
        if (e['01'] !== i.gtin) p.push(`GTIN ${e['01'] ?? 'missing'}, not ${i.gtin}`);
        if ((e['10'] ?? '').toUpperCase() !== i.batch.trim().toUpperCase()) p.push(`batch ${e['10'] ?? 'missing'}, not ${i.batch}`);
        const exp = e['17'] && /^\d{6}$/.test(e['17']) ? `20${e['17'].slice(0, 2)}-${e['17'].slice(2, 4)}` : null;
        if (exp !== expiry) p.push(`expiry ${e['17'] ?? 'missing'}, not ${word(expiry)}`);
        const s = e['21'];
        if (!s || !SERIAL.test(s)) p.push(`serial ${s ? `"${s}" is not 1 to 20 GS1 characters` : 'missing'}`);
        else if (seen.has(s)) p.push(`serial ${s} was already read in this batch`);
        else { seen.add(s); serials.push(s); }
      }
      if (p.length) problems.push(`code ${n + 1}: ${p.join(', ')}`);
    });
    const pass = problems.length === 0;
    const shown = `${codes.length} code${codes.length === 1 ? '' : 's'} read against GTIN ${i.gtin}, batch ${i.batch}, expiry ${word(expiry)}: ${pass ? 'all match, serials new in this batch' : `REFUSED (${problems.join('; ')})`}`;
    return { ok: true, value: new Dec(codes.length), unit: 'units', serials, check: checkOf(pass, shown), shown };
  });
}
