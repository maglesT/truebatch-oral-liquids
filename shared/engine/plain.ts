/**
 * A result for people (owner, 17 Nov 2026): its value and the limit in a few words first, one verdict (the screen's
 * chip, the PDF's verdict line), and the worked line kept for whoever wants to follow the calculation. Display only:
 * the stored result is never changed.
 */
import type { Stored } from './values.js';

// The verdict at the end of a worked line ("…: PASS", "…: pass", "…: within limits", "…: OUT OF LIMITS (…)"), said once
// elsewhere; a demo note after it stays.
const VERDICT = /:\s*(?:PASS|pass|within limits|FAIL|OUT OF LIMITS(?: \([^)]*\))?)(?=\s*(?: · DEMO: wait skipped)?\s*$)/;
/** A worked line without its closing verdict. */
export const withoutVerdict = (t: string) => t.replace(VERDICT, '');

/** A result's headline: the figure that decided (rounded as the limit is written), or the end of its worked line. */
export function headline(r: Stored): string | null {
  if (!r.ok) return null;
  // The expiry (T27) is a month ("10/2028"), not the shelf life it is worked out from.
  if (typeof r.expiry === 'string' && /^\d{4}-\d{2}$/.test(r.expiry)) return `${r.expiry.slice(5)}/${r.expiry.slice(0, 4)}`;
  const rounded = (r.check as { rounded?: string } | undefined)?.rounded;
  // A check decided in words (pass, accept, match) has no figure: its chip or verdict line says it.
  const figure = rounded !== undefined && /\d/.test(rounded) ? rounded : undefined;
  // Against a target (C1 "around"): the difference from the target as its worked line rounds it, to the decimals of
  // the ± limit ("6.76 kg is +0.1 % from 6.7500 kg" reads "+0.1 %", not the unrounded "+0.148 %").
  if (figure !== undefined && typeof r.deviation === 'string') {
    const d = / is ([+-]?\d[\d.]*) (\S+) from /.exec(r.shown);
    if (d) return `${signed(d[1]!)} ${d[2]}`;
    return `${r.deviation.startsWith('-') ? '' : '+'}${figure} %`;
  }
  if (figure !== undefined && r.unit !== 'units') return figure;
  if (rounded !== undefined || r.unit === 'units') return null;
  // The end of the part of the worked line that comes to the result's own value: "solids = … = 0.750 kg; total liquid =
  // … = 7.500 kg; solvent to add = … = 6.750 kg" is 6.750 kg, not the first part's 0.750 kg. Else the first part's end.
  const ends = r.shown.split('; ').map((part) => /=\s*([^=;]+)$/.exec(part)?.[1]?.trim());
  return ends.find((e) => e !== undefined && sameNumber(e, r.value)) ?? ends[0] ?? `${r.value} ${r.unit}`;
}

/** A difference as written, with its sign; a difference that rounds to zero has none ("0.0", not "-0.0"). */
export const signed = (f: string): string => (Number(f) === 0 ? f.replace(/^[+-]/, '') : /^[+-]/.test(f) ? f : `+${f}`);

/** Whether a figure as written ("6.750 kg", "4,920 packs") is the value, rounded to the figure's decimals. */
function sameNumber(written: string, value: string): boolean {
  const n = /^-?\d[\d,]*(?:\.(\d+))?/.exec(written);
  if (!n) return false;
  const dp = n[1]?.length ?? 0;
  const v = Number(value);
  return Number.isFinite(v) && Math.abs(Number(n[0].replace(/,/g, '')) - v) <= 0.5 * 10 ** -dp + 1e-12;
}

/** The limit a result was checked against, as its check states it ("97.0 to 100.5 %"); null without one. */
export function limitOf(r: Stored): string | null {
  const c = r.ok ? r.check : undefined;
  return (c && /;\s*limit ([^;]+?):\s*(?:within limits|OUT OF LIMITS)/.exec(c.shown)?.[1]) ?? null;
}

/** The short line under a headline: the limit, and a demo skip in plain words. */
export function plainLine(r: Stored): string | null {
  if (!r.ok) return null;
  const limit = limitOf(r);
  const skipped = r.shown.includes('DEMO: wait skipped');
  return [limit && `Limit ${limit}`, skipped && 'DEMO: wait skipped, so only the upper limit was checked'].filter(Boolean).join(' · ') || null;
}
