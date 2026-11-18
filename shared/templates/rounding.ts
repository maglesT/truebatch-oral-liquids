/**
 * Limit comparison with pharmacopoeia rounding (C1 and every template's optional check).
 *
 * Rule (paraphrasing the USP General Notices on rounding, also the usual Ph. Eur. practice for limits
 * written to a number of decimals): the result is rounded to the number of decimals of the limit as
 * written, half up (a 5 in the next place rounds away from zero), and only the rounded figure is
 * compared with the limit. The full-precision value is kept and never replaced.
 * 94.95 against 95.0-105.0 rounds to 95.0 and passes; 94.94 rounds to 94.9 and fails.
 * When the two bounds are written with different decimals the finer one is used.
 *
 * Tiers: the action limits are the specification (outside = fail). Optional alert limits sit inside
 * them; a value inside the action limits but outside the alert limits passes with an ALERT.
 * A limit may be one-sided (low only or high only), and either bound may be strict (< or >).
 */
import { Dec } from './dec.js';
import { refuse } from './refuse.js';
import { shownNumber } from './core.js';
import { convert, findUnit, type Unit } from './units.js';

export interface Limit {
  /** Lower bound as written in the specification, e.g. "97.0". */
  readonly low?: string;
  /** Upper bound as written, e.g. "100.0". */
  readonly high?: string;
  /** Unit the bounds are written in; the value is converted into it before rounding. */
  readonly unit: string;
  /** true: the bound itself fails ("more than", "less than"). Default false (NLT / NMT). */
  readonly lowStrict?: boolean;
  readonly highStrict?: boolean;
  /** Optional alert (warning) bounds inside the action bounds. */
  readonly alertLow?: string;
  readonly alertHigh?: string;
}

export type Level = 'pass' | 'alert' | 'fail';

export interface Check {
  /** false only when outside the action limits. */
  readonly pass: boolean;
  readonly level: Level;
  /** The rounded figure that decided, e.g. "95.0 %". */
  readonly rounded: string;
  readonly shown: string;
}

const PLAIN = /^-?\d+(\.\d+)?$/;

function bound(text: string | undefined, what: string): Dec | undefined {
  if (text === undefined) return undefined;
  if (typeof text !== 'string' || !PLAIN.test(text.trim())) refuse(`The ${what} "${String(text)}" must be a plain decimal as written in the specification (e.g. "95.0")`);
  return new Dec(text.trim());
}

export function writtenDecimals(text: string): number {
  const t = text.trim();
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}

export function roundHalfUp(v: Dec, decimals: number): Dec {
  return v.toDecimalPlaces(decimals, Dec.ROUND_HALF_UP);
}

interface Band {
  low?: Dec;
  high?: Dec;
  lowText?: string;
  highText?: string;
  decimals: number;
}

function band(low: string | undefined, high: string | undefined, what: string): Band | undefined {
  const l = bound(low, `lower ${what}`);
  const h = bound(high, `upper ${what}`);
  if (l === undefined && h === undefined) return undefined;
  if (l !== undefined && h !== undefined && l.gt(h)) refuse(`The lower ${what} ${low} is above the upper ${what} ${high}`);
  const decimals = Math.max(low === undefined ? 0 : writtenDecimals(low), high === undefined ? 0 : writtenDecimals(high));
  return { ...(l === undefined ? {} : { low: l, lowText: low?.trim() }), ...(h === undefined ? {} : { high: h, highText: high?.trim() }), decimals };
}

function inside(r: Dec, b: Band, lowStrict: boolean, highStrict: boolean): 'ok' | 'low' | 'high' {
  if (b.low !== undefined && (lowStrict ? r.lte(b.low) : r.lt(b.low))) return 'low';
  if (b.high !== undefined && (highStrict ? r.gte(b.high) : r.gt(b.high))) return 'high';
  return 'ok';
}

function describe(b: Band, unit: string, lowStrict: boolean, highStrict: boolean): string {
  const u = unit === '' ? '' : ` ${unit}`;
  if (b.lowText !== undefined && b.highText !== undefined) return `${b.lowText} to ${b.highText}${u}`;
  if (b.lowText !== undefined) return `${lowStrict ? 'more than' : 'not less than'} ${b.lowText}${u}`;
  return `${highStrict ? 'less than' : 'not more than'} ${b.highText ?? ''}${u}`;
}

/** Compares a full-precision value (in `valueUnit`) with a limit. */
export function checkLimit(value: Dec, valueUnit: Unit | string, limit: Limit): Check {
  const vu = typeof valueUnit === 'string' ? findUnit(valueUnit) : valueUnit;
  const lu = findUnit(limit.unit ?? '');
  if (vu === undefined) refuse(`The value's unit "${String(valueUnit)}" is not in the unit list`);
  if (lu === undefined) refuse(`The limit's unit "${limit.unit}" is not in the unit list`);
  const action = band(limit.low, limit.high, 'limit');
  if (action === undefined) refuse('A limit needs a lower bound, an upper bound or both');
  const alert = band(limit.alertLow, limit.alertHigh, 'alert limit');
  if (alert !== undefined) {
    if (alert.low !== undefined && action.low !== undefined && alert.low.lt(action.low)) refuse('The lower alert limit must not be below the lower action limit');
    if (alert.high !== undefined && action.high !== undefined && alert.high.gt(action.high)) refuse('The upper alert limit must not be above the upper action limit');
  }
  const v = convert(value, vu, lu);
  const ls = limit.lowStrict ?? false;
  const hs = limit.highStrict ?? false;
  const u = lu.symbol === '' ? '' : ` ${lu.symbol}`;

  const r = roundHalfUp(v, action.decimals);
  const rText = r.toFixed(action.decimals);
  const where = inside(r, action, ls, hs);
  // The rounding is written out only when it changed the value ("0.03333… min rounded to 0 decimals … = 0 min");
  // otherwise the value as checked, plainly ("0 nos; limit not more than 0 nos").
  const rounding = v.eq(r) ? '' : `${shownNumber(v, lu.symbol, { decimals: action.decimals + 2 })}${u} rounded to ${action.decimals} decimal${action.decimals === 1 ? '' : 's'} (as the limit is written) = `;
  const head = `${rounding}${rText}${u}; limit ${describe(action, lu.symbol, ls, hs)}`;
  if (where !== 'ok') {
    return { pass: false, level: 'fail', rounded: `${rText}${u}`, shown: `${head}: OUT OF LIMITS (${where === 'low' ? 'below the lower' : 'above the upper'} limit)` };
  }
  if (alert !== undefined) {
    const ra = roundHalfUp(v, alert.decimals);
    const raText = ra.toFixed(alert.decimals);
    if (inside(ra, alert, false, false) !== 'ok') {
      return { pass: true, level: 'alert', rounded: `${raText}${u}`, shown: `${head}: within limits, but ${raText}${u} is outside the alert limits ${describe(alert, lu.symbol, false, false)}: ALERT` };
    }
  }
  return { pass: true, level: 'pass', rounded: `${rText}${u}`, shown: `${head}: within limits` };
}
