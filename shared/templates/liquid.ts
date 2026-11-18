/**
 * T17 Liquid make-up: coating suspensions, binder solutions, syrups.
 * By weight (% w/w solids) or by volume (% w/v made up to a final volume).
 */
import { defaultDecimals, Dec, fmt, HUNDRED, needKind, parse, percent, refuse, run, show, to, unitOf, ZERO, type Outcome, type Parsed, type Q } from './core.js';
import type { Limit } from './rounding.js';
import { checkOf } from './core.js';

/** A liquid ingredient with its own solids (e.g. Eudragit L 30 D at 30 %), by mass or by volume with its density. */
export interface LiquidIngredient {
  readonly name: string;
  readonly quantity: Q;
  /** Needed when `quantity` is a volume. */
  readonly density?: Q;
  readonly solidsPercent: Q;
}

export type T17Input =
  | {
      readonly mode: 'w/w';
      /** Dry (non-volatile) components, e.g. HPMC, talc, TiO2, also a non-volatile plasticiser. */
      readonly dry: readonly { readonly name: string; readonly quantity: Q }[];
      readonly liquids?: readonly LiquidIngredient[];
      /** % overage for spray loss on everything (default 0). */
      readonly overagePercent?: Q;
      /** Target solids content of the finished liquid, % w/w. */
      readonly targetSolids: Q;
      /** If given, the solvent to add is also shown as a volume. */
      readonly solventDensity?: Q;
      readonly unit?: string;
      readonly decimals?: number;
      readonly limit?: Limit;
    }
  | {
      readonly mode: 'w/v';
      readonly solutes: readonly { readonly name: string; readonly concentration: Q }[];
      readonly finalVolume: Q;
      readonly overagePercent?: Q;
      readonly unit?: string;
      readonly decimals?: number;
      readonly limit?: Limit;
    };

export interface T17Extra {
  /** w/w: total solids; w/v: total solute mass. */
  readonly totalSolids: Dec;
  /** w/w: total liquid weight; w/v: final volume. */
  readonly totalLiquid: Dec;
  readonly totalLiquidUnit: string;
  /** w/w: solvent volume when a density was given. */
  readonly solventVolume?: Dec;
  readonly solutes?: readonly { readonly name: string; readonly value: Dec }[];
}

function massOf(l: LiquidIngredient): Parsed {
  const q = parse(l.quantity, `The quantity of ${l.name}`);
  if (q.unit.kind === 'mass') return q;
  if (q.unit.kind !== 'volume') needKind(q, ['mass', 'volume'], `The quantity of ${l.name}`);
  if (l.density === undefined) refuse(`${l.name} is given by volume; give its density to turn it into a weight`);
  const d = parse(l.density, `The density of ${l.name}`);
  needKind(d, ['density'], `The density of ${l.name}`);
  if (!d.v.isPositive() || d.v.isZero()) refuse(`The density of ${l.name} must be more than zero`);
  const g = to(q, 'mL').times(to(d, 'g/mL'));
  return { v: g, unit: unitOf('g'), text: `${q.text} × ${d.text}` };
}

/**
 * T17 Liquid make-up.
 * w/w: total solids = (dry + each liquid × its solids %) × (100 + overage) ÷ 100; total liquid = solids × 100 ÷ target %;
 * solvent to add = total liquid − dry − liquid ingredients (all with overage). Refused if negative.
 * w/v: each solute = % w/v × final volume ÷ 100 (g per 100 mL), made up to the final volume.
 */
export function t17LiquidMakeUp(i: T17Input): Outcome<T17Extra> {
  return run(() => {
    const ov = i.overagePercent === undefined ? { v: ZERO, text: '0 %' } : percent(i.overagePercent, 'The overage');
    if (ov.v.isNegative()) refuse('An overage cannot be negative');
    const k = HUNDRED.plus(ov.v).div(HUNDRED);
    if (i.mode === 'w/v') {
      const vol = parse(i.finalVolume, 'The final volume');
      needKind(vol, ['volume'], 'The final volume');
      if (!vol.v.isPositive() || vol.v.isZero()) refuse('The final volume must be more than zero');
      const u = unitOf(i.unit ?? 'kg');
      const volMl = to(vol, 'mL').times(k);
      const solutes = i.solutes.map((s) => {
        const c = parse(s.concentration, `The concentration of ${s.name}`);
        needKind(c, ['mass concentration'], `The concentration of ${s.name}`);
        if (c.v.isNegative()) refuse(`The concentration of ${s.name} cannot be negative`);
        const g = to(c, 'mg/mL').times(volMl).div(1000);
        return { name: s.name, value: to({ v: g, unit: unitOf('g'), text: '' }, u), text: c.text };
      });
      const total = solutes.reduce((s, x) => s.plus(x.value), ZERO);
      const dp = i.decimals ?? defaultDecimals(u.symbol);
      const finalV = to({ v: volMl, unit: unitOf('mL'), text: '' }, vol.unit);
      const shown =
        solutes.map((s) => `${s.name} ${s.text} × ${show(finalV, vol.unit.symbol, 2)} = ${show(s.value, u.symbol, dp)}`).join('; ') +
        `; dissolve and make up to ${show(finalV, vol.unit.symbol, 2)}${ov.v.isZero() ? '' : ` (includes ${ov.text} overage)`}`;
      return { ok: true, value: total, unit: u.symbol, totalSolids: total, totalLiquid: finalV, totalLiquidUnit: vol.unit.symbol, solutes: solutes.map((s) => ({ name: s.name, value: s.value })), shown, ...checkOf(total, u.symbol, i.limit) };
    }
    if (i.dry.length === 0 && (i.liquids ?? []).length === 0) refuse('Give the components of the liquid');
    const target = percent(i.targetSolids, 'The target solids content');
    if (!target.v.isPositive() || target.v.isZero() || target.v.gt(HUNDRED)) refuse('The target solids content must be more than 0 and not more than 100 %');
    const dry = i.dry.map((d) => {
      const p = parse(d.quantity, `The quantity of ${d.name}`);
      needKind(p, ['mass'], `The quantity of ${d.name}`);
      if (p.v.isNegative()) refuse(`The quantity of ${d.name} cannot be negative`);
      return { name: d.name, g: to(p, 'g') };
    });
    const liquids = (i.liquids ?? []).map((l) => {
      const m = massOf(l);
      const s = percent(l.solidsPercent, `The solids content of ${l.name}`);
      if (s.v.isNegative() || s.v.gt(HUNDRED)) refuse(`The solids content of ${l.name} must be from 0 to 100 %`);
      return { name: l.name, g: to(m, 'g'), solids: s };
    });
    const dryG = dry.reduce((s, d) => s.plus(d.g), ZERO).times(k);
    const liqG = liquids.reduce((s, l) => s.plus(l.g), ZERO).times(k);
    const solidsG = dry.reduce((s, d) => s.plus(d.g), ZERO).plus(liquids.reduce((s, l) => s.plus(l.g.times(l.solids.v).div(HUNDRED)), ZERO)).times(k);
    const totalG = solidsG.times(HUNDRED).div(target.v);
    const solventG = totalG.minus(dryG).minus(liqG);
    const u = unitOf(i.unit ?? 'kg');
    const asU = (g: Dec): Dec => to({ v: g, unit: unitOf('g'), text: '' }, u);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    if (solventG.isNegative() && !solventG.isZero()) {
      refuse(
        `The liquid ingredients already bring more water/solvent than a ${target.text} solids liquid allows ` +
          `(total ${show(asU(totalG), u.symbol, dp)}, ingredients ${show(asU(dryG.plus(liqG)), u.symbol, dp)}): the solvent to add would be ${show(asU(solventG), u.symbol, dp)}. Lower the target solids or change the master`,
      );
    }
    let solventVolume: Dec | undefined;
    let volText = '';
    if (i.solventDensity !== undefined) {
      const d = parse(i.solventDensity, 'The solvent density');
      needKind(d, ['density'], 'The solvent density');
      if (!d.v.isPositive() || d.v.isZero()) refuse('The solvent density must be more than zero');
      solventVolume = to({ v: solventG.div(to(d, 'g/mL')), unit: unitOf('mL'), text: '' }, 'L');
      volText = ` (${fmt(solventVolume, 2)} L at ${d.text})`;
    }
    const value = asU(solventG);
    const parts = [...dry.map((d) => `${show(asU(d.g), u.symbol, dp)} ${d.name}`), ...liquids.map((l) => `${show(asU(l.g), u.symbol, dp)} ${l.name} × ${l.solids.text}`)];
    const shown =
      `solids = (${parts.join(' + ')})${ov.v.isZero() ? '' : ` × (100 + ${ov.text}) ÷ 100`} = ${show(asU(solidsG), u.symbol, dp)}; ` +
      `total liquid = ${show(asU(solidsG), u.symbol, dp)} × 100 ÷ ${target.text} = ${show(asU(totalG), u.symbol, dp)}; ` +
      `solvent to add = ${show(asU(totalG), u.symbol, dp)} − ${show(asU(dryG.plus(liqG)), u.symbol, dp)} = ${show(value, u.symbol, dp)}${volText}`;
    return {
      ok: true,
      value,
      unit: u.symbol,
      totalSolids: asU(solidsG),
      totalLiquid: asU(totalG),
      totalLiquidUnit: u.symbol,
      ...(solventVolume === undefined ? {} : { solventVolume }),
      shown,
      ...checkOf(value, u.symbol, i.limit),
    };
  });
}
