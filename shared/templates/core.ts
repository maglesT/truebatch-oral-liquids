/**
 * The small core every template uses: exact decimals, values with units read from text,
 * the result and refusal shapes, and the "refuse with a plain message" mechanism.
 *
 * GMP values are never JavaScript floating point. Every number comes in as text ("50.300")
 * and is held as a decimal.js Decimal with 50 significant digits.
 */
import { Dec } from './dec.js';
import { Refused, refuse } from './refuse.js';
import { convert, findUnit, whyNot, type Kind, type Unit } from './units.js';
import { checkLimit, type Check, type Limit } from './rounding.js';

export { Dec };

/** A value with its unit: either "50.300 kg" or { value: "50.300", unit: "kg" }. */
export type Q = string | { readonly value: string; readonly unit: string };

/** A parsed value: the exact number, its unit and the text as written (for the worked line). */
export interface Parsed {
  readonly v: Dec;
  readonly unit: Unit;
  readonly text: string;
}

export interface Done {
  readonly ok: true;
  /** Full-precision result; never replaced by a rounded figure. */
  readonly value: Dec;
  readonly unit: string;
  /** The worked line in plain words for the screen. */
  readonly shown: string;
  /** Present when the master attached a limit. */
  readonly check?: Check;
}

export interface Refusal {
  readonly ok: false;
  readonly message: string;
}

export type Outcome<X = object> = (Done & X) | Refusal;

export { Refused, refuse };

/** Runs a template body; a refusal becomes { ok: false, message }. Other errors are bugs and are re-thrown. */
export function run<X extends object>(body: () => Done & X): Outcome<X> {
  try {
    return body();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    throw e;
  }
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Reads a number written as text. JavaScript numbers are refused: they are binary floating point. */
export function num(text: unknown, what: string): Dec {
  if (typeof text !== 'string') {
    refuse(`${what} must be given as text (for example "50.300"), not as a JavaScript number, so that no floating-point error can creep in`);
  }
  const t = text.trim();
  if (!NUMBER.test(t)) refuse(`${what} "${t}" is not a number`);
  return new Dec(t);
}

/** Reads a value with a unit. */
export function parse(q: Q, what: string): Parsed {
  let valueText: string;
  let unitText: string;
  if (typeof q === 'string') {
    const t = q.trim();
    const i = t.search(/\s/);
    valueText = i < 0 ? t : t.slice(0, i);
    unitText = i < 0 ? '' : t.slice(i).trim();
  } else if (q !== null && typeof q === 'object' && 'value' in q) {
    valueText = q.value;
    unitText = q.unit ?? '';
    if (typeof valueText !== 'string') num(valueText, what);
  } else {
    refuse(`${what} is missing`);
  }
  const v = num(valueText, what);
  const unit = findUnit(unitText);
  if (unit === undefined) refuse(`${what}: the unit "${unitText}" is not in the unit list`);
  const shown = shownNumber(v, unit.symbol, { written: valueText });
  return { v, unit, text: unit.symbol === '' ? shown : `${shown} ${unit.symbol}` };
}

/** Number of decimals as written: "50.300" -> 3, "105" -> 0. */
export function decimalsOf(text: string): number {
  const t = text.trim().split(/[eE]/)[0] ?? '';
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}

/** Fixed decimals, half up, for display only. */
export function fmt(v: Dec, decimals: number): string {
  return v.toFixed(decimals, Dec.ROUND_HALF_UP);
}

/**
 * THE display rule for a number inside a worked line (display only: calculations always use the full value).
 * A value written with at most 4 decimals (as typed, or a result written out exactly) is shown as written. A longer
 * one (a full-precision result passed on) is shown at `decimals`, by default the unit's display decimals + 1 (kg 4,
 * g and mg 3, % 2), and at least 4 significant figures when it is small. It is cut, not rounded, and "…" marks the
 * cut, so a reader who rounds the shown figure gets the same result as the calculation.
 */
export function shownNumber(v: Dec, unit: string, o: { written?: string; decimals?: number } = {}): string {
  const w = o.written?.trim();
  if (w !== undefined && decimalsOf(w) <= 4) return w;
  let dp = o.decimals ?? defaultDecimals(unit) + 1;
  if (!v.isZero() && v.abs().lt(1)) dp = Math.max(dp, 3 - Math.floor(Dec.log10(v.abs()).toNumber()));
  const cut = v.toFixed(dp, Dec.ROUND_DOWN);
  return new Dec(cut).eq(v) ? fmt(v, dp) : `${cut}…`;
}

/** Display of a value with unit at a number of decimals: "98.6 %". */
export function show(v: Dec, unit: string, decimals: number): string {
  return unit === '' ? fmt(v, decimals) : `${fmt(v, decimals)} ${unit}`;
}

/** Default display decimals by unit (the master can override with `decimals`). */
export function defaultDecimals(unit: string): number {
  switch (unit) {
    case 'kg':
      return 3;
    case 'g':
    case 'mg':
    case 'L':
    case 'mL':
      return 2;
    case '%':
    case '%w/w':
    case '%RH':
      return 1;
    case 'min':
    case 'units':
    case 'tablets':
    case 'packs':
    case 'nos':
    case 's':
      return 0;
    default:
      return 2;
  }
}

export const HUNDRED = new Dec(100);
export const ZERO = new Dec(0);
export const ONE = new Dec(1);
export const PI = Dec.acos(-1);

/** The optional check of a result against a limit. */
export function checkOf(value: Dec, unit: string, limit: Limit | undefined): { check?: Check } {
  return limit === undefined ? {} : { check: checkLimit(value, unit, limit) };
}

/** Converts a parsed value into a unit of the same kind (refuses otherwise, in plain words). */
export function to(p: Parsed, target: Unit | string): Dec {
  const u = typeof target === 'string' ? findUnit(target) : target;
  if (u === undefined) refuse(`The unit "${String(target)}" is not in the unit list`);
  return convert(p.v, p.unit, u);
}

/** Refuses unless every value is of one of the allowed kinds. */
export function needKind(p: Parsed, kinds: readonly Kind[], what: string): void {
  if (!kinds.includes(p.unit.kind)) {
    const art = (k: string): string => (/^[aeiouAEIOU]/.test(k) ? `an ${k}` : `a ${k}`);
    refuse(`${what} must be ${kinds.map((k) => (k === 'fraction' ? 'a percentage' : art(k))).join(' or ')}; "${p.text}" is ${p.unit.kind === 'number' ? 'a plain number' : art(p.unit.kind)}`);
  }
}

/** Refuses unless all values are of the same kind as the first. */
export function sameKind(ps: readonly Parsed[], what: string): void {
  const first = ps[0];
  if (first === undefined) return;
  for (const p of ps) {
    const why = whyNot(p.unit, first.unit);
    if (why !== undefined && p.unit.kind !== first.unit.kind) refuse(`${what}: ${why}`);
  }
}

export function unitOf(symbol: string): Unit {
  const u = findUnit(symbol);
  if (u === undefined) refuse(`The unit "${symbol}" is not in the unit list`);
  return u;
}

/** A percentage input (% or % w/w), as a plain number of percent. */
export function percent(q: Q, what: string): { v: Dec; text: string } {
  const p = parse(q, what);
  if (p.unit.kind === 'number') return { v: p.v, text: `${p.text} %` };
  needKind(p, ['fraction'], what);
  return { v: to(p, '%'), text: p.text };
}

/** A value computed earlier in the same batch (any template's result), used as an input. */
export interface ResultValue {
  readonly ok: true;
  readonly value: Dec;
  readonly unit: string;
}

export function isResult(x: unknown): x is ResultValue {
  return typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === true && (x as { value?: unknown }).value instanceof Dec;
}

/** Reads a typed value or an earlier result. */
export function parseAny(x: Q | ResultValue, what: string): Parsed {
  if (isResult(x)) {
    const u = unitOf(x.unit);
    const n = shownNumber(x.value, u.symbol);
    return { v: x.value, unit: u, text: u.symbol === '' ? n : `${n} ${u.symbol}` };
  }
  return parse(x, what);
}
