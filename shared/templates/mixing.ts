/**
 * T26 Mix to a target: how much of a donor lot to add to bring a property of the main lot to a target.
 *
 * Mass balance (the property is a mass-weighted average, e.g. a % size fraction, an assay, an LOD):
 *   (mA × a + x × b) ÷ (mA + x) = t   →   x = mA × (t − a) ÷ (b − t)
 * The donor must lie on the far side of the target from the main lot (a < t < b, or b < t < a);
 * otherwise no amount of donor can reach the target, and the template refuses.
 *
 * Settings from the formulation test:
 * - `scale: 'ethanol % v/v'` (F0008, F0250): an alcohol strength in % v/v does not mix by mass (volumes contract).
 *   Each strength is turned into % w/w at 20 °C with the international alcoholometric formula (OIML R 22, as in
 *   Council Directive 76/766/EEC), the mass balance is done in % w/w, and the donor is also shown as a volume.
 * - `basis` (F0027): each lot's value and the target must be on the same basis (e.g. "fraction of total sotalol HCl");
 *   refused otherwise.
 * - `others` (F0450): other properties of the same lots (a second marker) are worked out for the mix and checked
 *   against their limits; refused when out.
 * - Properties that do not mix by mass are refused (F0418): a size (D50, D90), a hardness or force, a pressure, a plain
 *   number such as pH. A mix of particle sizes is predicted with T22 (`t22MixPsd`).
 */
import { defaultDecimals, Dec, fmt, HUNDRED, needKind, parse, refuse, run, sameKind, show, to, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';
import { checkOf } from './core.js';
import type { Kind } from './units.js';

export interface T26Input {
  /** Mass of the main lot (A). */
  readonly mass: Q;
  /** The property of A, e.g. "28.0 %" fines. */
  readonly a: Q;
  /** The same property of the donor lot (B). */
  readonly b: Q;
  /** The target for the mix. */
  readonly target: Q;
  /** What the property is, for the worked line ("fines below 125 µm", "assay", "LOD"). */
  readonly property?: string;
  /** a, b and the target are alcohol strengths in % v/v (ethanol and water). */
  readonly scale?: 'ethanol % v/v';
  /** The basis each value is on: main lot, donor lot, target. Refused unless all three are the same. */
  readonly basis?: { readonly a: string; readonly b: string; readonly target: string };
  /** Other properties of the two lots, worked out for the mix and checked against their limits. */
  readonly others?: readonly { readonly name: string; readonly a: Q; readonly b: Q; readonly limit: Limit }[];
  readonly unit?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

export interface T26Extra {
  readonly totalMass: Dec;
  readonly others?: readonly { readonly name: string; readonly value: Dec; readonly check: Check }[];
  /** With the ethanol scale: the donor's volume at 20 °C, in L. */
  readonly donorVolume?: Dec;
}

const NOT_BY_MASS: Partial<Record<Kind, string>> = {
  length: 'a particle size (D50, D90) is a percentile, not an average: predict the mix with T22 (mixed-lot particle size)',
  force: 'a hardness or force', 'Strong-Cobb hardness': 'a hardness', pressure: 'a pressure', number: 'a plain number such as pH',
};

// OIML R 22 / Directive 76/766/EEC: density of ethanol-water mixtures at 20 °C, kg/m³, as a polynomial of the mass
// fraction p: ρ = A1 + Σ A(k) p^(k−1), k = 2 … 12 (the temperature terms vanish at 20 °C).
const A = ['998.20123', '-192.9769495', '389.1238958', '-1668.103923', '13522.15441', '-88292.78388', '306287.4042',
  '-613838.1234', '747017.2998', '-547846.1354', '223446.0334', '-39032.85426'].map((x) => new Dec(x));
/** Density at 20 °C (kg/m³) of an ethanol-water mixture with mass fraction p (0–1). */
export const ethanolDensity = (p: Dec): Dec => A.reduce((s, k, n) => s.plus(k.times(p.pow(n))), new Dec(0));
const RHO_ETHANOL = ethanolDensity(new Dec(1)); // 789.2391233 kg/m³
/** % v/v at 20 °C → % w/w: solve v = p × ρ(p) ÷ ρ(ethanol) for p (the strength rises with p, so bisection). */
export function ethanolWw(vv: Dec): Dec {
  if (vv.isNegative() || vv.gt(HUNDRED)) refuse('An alcohol strength must be from 0 to 100 % v/v');
  let lo = new Dec(0);
  let hi = new Dec(1);
  for (let n = 0; n < 120; n++) {
    const m = lo.plus(hi).div(2);
    if (m.times(ethanolDensity(m)).div(RHO_ETHANOL).times(HUNDRED).lt(vv)) lo = m; else hi = m;
  }
  return lo.plus(hi).div(2).times(HUNDRED);
}

export function t26MixToTarget(i: T26Input): Outcome<T26Extra> {
  return run(() => {
    const m = parse(i.mass, 'The mass of the main lot');
    needKind(m, ['mass'], 'The mass of the main lot');
    if (!m.v.isPositive() || m.v.isZero()) refuse('The mass of the main lot must be more than zero');
    if (i.basis && (i.basis.a !== i.basis.b || i.basis.a !== i.basis.target)) {
      refuse(`The values are not on the same basis (main lot: ${i.basis.a}; donor: ${i.basis.b}; target: ${i.basis.target}): ` +
        "give each lot's value on the basis of the target (for an isomer ratio, each isomer as a fraction of the total on the same assay basis), or the mix drifts from the target");
    }
    const a = parse(i.a, 'The value of the main lot');
    const b = parse(i.b, 'The value of the donor lot');
    const t = parse(i.target, 'The target');
    sameKind([a, b, t], 'Mix to a target');
    if (a.unit.kind === 'temperature') refuse('Temperatures are not mixed by mass balance');
    const no = NOT_BY_MASS[a.unit.kind];
    if (no !== undefined) refuse(`${i.property ?? 'This property'} does not mix by mass: ${no}`);
    const ethanol = i.scale === 'ethanol % v/v';
    if (ethanol && a.unit.kind !== 'fraction') refuse('An alcohol strength is a % v/v');
    const w = (p: Parsed) => (ethanol ? ethanolWw(to(p, '%')) : to(p, t.unit));
    const av = w(a);
    const bv = w(b);
    const tv = ethanol ? w(t) : t.v;
    const what = i.property ?? (ethanol ? 'the alcohol strength' : 'the value');
    const u = i.unit === undefined ? m.unit : (needKind({ v: new Dec(0), unit: parse(`0 ${i.unit}`, 'unit').unit, text: '' }, ['mass'], 'The result unit'), parse(`0 ${i.unit}`, 'unit').unit);
    const dp = i.decimals ?? defaultDecimals(u.symbol);
    if (av.eq(tv)) {
      const zero = new Dec(0);
      return { ok: true, value: zero, unit: u.symbol, totalMass: to(m, u), shown: `${what} of the main lot (${a.text}) is already at the target ${t.text}: add nothing`, ...checkOf(zero, u.symbol, i.limit) };
    }
    const up = tv.minus(av);
    const down = bv.minus(tv);
    if (down.isZero() || up.isNegative() !== down.isNegative()) {
      refuse(
        `The donor lot (${b.text}) is not on the far side of the target ${t.text} from the main lot (${a.text}): ` +
          `no amount of it can bring ${what} to the target. Choose a donor ${up.isNegative() ? 'below' : 'above'} ${t.text}`,
      );
    }
    const value = to(m, u).times(up).div(down);
    const totalMass = to(m, u).plus(value);
    // The donor's volume at 20 °C: its mass ÷ the density at its strength (kg/m³ = g/L).
    const donorVolume = ethanol ? to({ v: value, unit: u, text: '' }, 'g').div(ethanolDensity(bv.div(HUNDRED))) : undefined;
    let shown = ethanol
      ? `${m.text} × (${fmt(tv, 2)} − ${fmt(av, 2)}) ÷ (${fmt(bv, 2)} − ${fmt(tv, 2)}) (% w/w at 20 °C of ${t.text}, ${a.text}, ${b.text}) = ` +
        `${show(value, u.symbol, dp)} of the donor lot (${fmt(donorVolume!, 2)} L at 20 °C); mix ${show(totalMass, u.symbol, dp)} at ${t.text}`
      : `${m.text} × (${t.text} − ${a.text}) ÷ (${b.text} − ${t.text}) = ${show(value, u.symbol, dp)} of the donor lot; ` +
        `mix ${show(totalMass, u.symbol, dp)} at ${what} ${fmt(t.v, Math.max(1, dp - 1))} ${t.unit.symbol}`;
    const others = (i.others ?? []).map((o) => {
      const oa = parse(o.a, `${o.name} of the main lot`);
      const ob = parse(o.b, `${o.name} of the donor lot`);
      sameKind([oa, ob], o.name);
      const why = NOT_BY_MASS[oa.unit.kind];
      if (why !== undefined) refuse(`${o.name} does not mix by mass: ${why}`);
      const v = to(m, u).times(oa.v).plus(value.times(to(ob, oa.unit))).div(totalMass);
      const check = checkLimit(v, oa.unit, o.limit);
      shown += `; ${o.name} of the mix ${fmt(v, 2)} ${oa.unit.symbol} (${check.shown})`;
      return { name: o.name, value: v, check };
    });
    const out = others.find((o) => !o.check.pass);
    if (out !== undefined) refuse(`${shown}: mixing to the target puts ${out.name} out of its limits; choose another donor lot`);
    return { ok: true, value, unit: u.symbol, totalMass, ...(others.length ? { others } : {}), ...(donorVolume ? { donorVolume } : {}), shown, ...checkOf(value, u.symbol, i.limit) };
  });
}
