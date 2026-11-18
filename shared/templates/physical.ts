/**
 * T22 Sieve analysis, T23 Compact strength and solid fraction, T24 Extruder specific mechanical energy,
 * T25 Absolute humidity.
 */
import { checkOf, Dec, fmt, HUNDRED, needKind, ONE, parse, percent, PI, refuse, run, sameKind, show, to, ZERO, type Outcome, type Parsed, type Q } from './core.js';
import { checkLimit, type Check, type Limit } from './rounding.js';

// ---------------------------------------------------------------- T22 Sieve analysis
export interface T22Input {
  /** Weight of the sample put on the top sieve. */
  readonly sample: Q;
  /** Sieves from the coarsest to the finest, each with the weight retained on it. */
  readonly sieves: readonly { readonly aperture: Q; readonly retained: Q }[];
  /** Weight in the pan (below the finest sieve). */
  readonly pan: Q;
  /** "% fines" = % passing this sieve (must be one of the sieves). */
  readonly finesBelow?: Q;
  /** Median size d50 by interpolation of the cumulative % passing: straight-line or on a log scale of size. */
  readonly median?: 'linear' | 'log';
  readonly recoveryLimit?: Limit;
  readonly finesLimit?: Limit;
}

export interface T22Extra {
  readonly fractions: readonly { readonly aperture: string; readonly retainedPercent: Dec; readonly cumulativeRetained: Dec; readonly passing: Dec }[];
  readonly panPercent: Dec;
  readonly fines?: Dec;
  readonly finesCheck?: Check;
  /** d50 in µm. */
  readonly d50?: Dec;
}

/**
 * T22 Sieve analysis. % retained on each sieve is of the total weight recovered (sum of all sieves and the
 * pan); recovery = total recovered ÷ sample × 100 (the value of this template).
 */
export function t22SieveAnalysis(i: T22Input): Outcome<T22Extra> {
  return run(() => {
    if (i.sieves.length === 0) refuse('Give at least one sieve');
    const sample = parse(i.sample, 'The sample weight');
    needKind(sample, ['mass'], 'The sample weight');
    if (!sample.v.isPositive() || sample.v.isZero()) refuse('The sample weight must be more than zero');
    const sv = i.sieves.map((s, n) => ({ a: parse(s.aperture, `Sieve ${n + 1} aperture`), r: parse(s.retained, `Weight on sieve ${n + 1}`) }));
    const pan = parse(i.pan, 'The pan weight');
    if (pan.v.isNegative()) refuse('The pan weight cannot be negative');
    sameKind([sample, pan, ...sv.map((s) => s.r)], 'Sieve weights');
    for (const s of sv) {
      needKind(s.a, ['length'], 'A sieve aperture');
      if (s.r.v.isNegative()) refuse('A retained weight cannot be negative');
    }
    const um = sv.map((s) => to(s.a, 'µm'));
    for (let n = 1; n < um.length; n += 1) {
      if (!(um[n] ?? ZERO).lt(um[n - 1] ?? ZERO)) refuse('List the sieves from the coarsest to the finest, each finer than the one above');
    }
    const g = (p: Parsed): Dec => to(p, 'g');
    const total = sv.reduce((s, x) => s.plus(g(x.r)), g(pan));
    if (total.isZero()) refuse('Nothing was recovered from the sieves');
    let cum = ZERO;
    const fractions = sv.map((s) => {
      const pc = g(s.r).div(total).times(HUNDRED);
      cum = cum.plus(pc);
      return { aperture: s.a.text, um: to(s.a, 'µm'), retainedPercent: pc, cumulativeRetained: cum, passing: HUNDRED.minus(cum) };
    });
    const panPercent = g(pan).div(total).times(HUNDRED);
    const recovery = total.div(g(sample)).times(HUNDRED);

    let fines: Dec | undefined;
    let finesCheck: Check | undefined;
    let finesText = '';
    if (i.finesBelow !== undefined) {
      const fb = parse(i.finesBelow, 'The fines sieve');
      finesText = fb.text;
      const f = fractions.find((x) => x.um.eq(to(fb, 'µm')));
      if (f === undefined) refuse(`The fines sieve ${fb.text} is not one of the sieves used`);
      fines = f.passing;
      if (i.finesLimit !== undefined) finesCheck = checkLimit(fines, '%', i.finesLimit);
    }
    let d50: Dec | undefined;
    if (i.median !== undefined) {
      const first = fractions[0];
      const last = fractions[fractions.length - 1];
      if (first === undefined || last === undefined) refuse('Give at least one sieve');
      if (first.passing.lt(50)) refuse(`More than half the sample stayed on the coarsest sieve (${first.aperture}); the median is above the sieve range`);
      if (last.passing.gt(50)) refuse(`More than half the sample passed the finest sieve (${last.aperture}); the median is below the sieve range`);
      for (let n = 1; n < fractions.length; n += 1) {
        const a = fractions[n - 1];
        const b = fractions[n];
        if (a === undefined || b === undefined) continue;
        if (a.passing.gte(50) && b.passing.lte(50)) {
          const span = a.passing.minus(b.passing);
          const f = span.isZero() ? ZERO : new Dec(50).minus(b.passing).div(span);
          d50 = i.median === 'linear' ? b.um.plus(f.times(a.um.minus(b.um))) : Dec.exp(Dec.ln(b.um).plus(f.times(Dec.ln(a.um).minus(Dec.ln(b.um)))));
          break;
        }
      }
      if (d50 === undefined && first.passing.eq(50)) d50 = first.um;
    }
    const shown =
      fractions.map((f) => `${f.aperture}: ${fmt(f.retainedPercent, 1)} % (cumulative ${fmt(f.cumulativeRetained, 1)} %)`).join('; ') +
      `; pan ${fmt(panPercent, 1)} %; recovered ${show(total, 'g', 2)} of ${sample.text} = ${fmt(recovery, 1)} %` +
      (fines === undefined ? '' : `; fines (passing ${finesText}) ${fmt(fines, 1)} %`) +
      (d50 === undefined ? '' : `; d50 = ${fmt(d50, 0)} µm (${i.median} interpolation)`);
    return {
      ok: true,
      value: recovery,
      unit: '%',
      fractions: fractions.map(({ aperture, retainedPercent, cumulativeRetained, passing }) => ({ aperture, retainedPercent, cumulativeRetained, passing })),
      panPercent,
      ...(fines === undefined ? {} : { fines }),
      ...(finesCheck === undefined ? {} : { finesCheck }),
      ...(d50 === undefined ? {} : { d50 }),
      shown,
      ...checkOf(recovery, '%', i.recoveryLimit),
    };
  });
}

// ---------------------------------------------------------------- T22 Mixed-lot particle size (F0418)
export interface T22MixInput {
  /** Each lot with its mass and its laser-diffraction table: size classes (same for every lot) and cumulative % undersize. */
  readonly lots: readonly { readonly name: string; readonly mass: Q; readonly table: readonly { readonly size: Q; readonly undersize: Q }[] }[];
  /** The percentiles wanted, e.g. ["50", "90"] for D0.5 and D0.9. */
  readonly percentiles: readonly string[];
  /** Straight-line (default) or log-size interpolation between size classes. */
  readonly interpolation?: 'linear' | 'log';
  /** Limits per percentile, e.g. { "90": { low: "40", high: "70", unit: "µm" } }. */
  readonly limits?: Readonly<Record<string, Limit>>;
}

/**
 * Predicted particle-size distribution of a mix of API lots: the cumulative % undersize of the mix at each size class
 * is the mass-weighted mean of the lots' (it is a mass fraction); the percentiles are then read by interpolation.
 * Percentiles themselves never mix by mass (T26 refuses them). The value is the first percentile asked for, in µm.
 */
export function t22MixPsd(i: T22MixInput): Outcome<{ readonly percentiles: readonly { readonly p: string; readonly size: Dec; readonly check?: Check }[] }> {
  return run(() => {
    if (i.lots.length < 2) refuse('A mix needs at least two lots');
    if (i.percentiles.length === 0) refuse('Name the percentiles wanted (e.g. 50 and 90)');
    const lots = i.lots.map((l) => ({ name: l.name, m: parse(l.mass, `The mass of ${l.name}`), rows: l.table.map((r) => ({ x: to(parse(r.size, 'A size class'), 'µm'), u: percent(r.undersize, '% undersize').v })) }));
    sameKind(lots.map((l) => l.m), 'Lot masses');
    const first = lots[0]!.rows;
    if (first.length < 2) refuse('Each table needs at least two size classes');
    for (const l of lots) {
      needKind(l.m, ['mass'], `The mass of ${l.name}`);
      if (l.rows.length !== first.length || l.rows.some((r, n) => !r.x.eq(first[n]!.x))) refuse(`${l.name} is not on the same size classes as ${lots[0]!.name}: report every lot on one set of classes`);
      if (l.rows.some((r, n) => n > 0 && (!r.x.gt(l.rows[n - 1]!.x) || r.u.lt(l.rows[n - 1]!.u)))) refuse(`The table of ${l.name} must go from the finest class up, with the % undersize never falling`);
    }
    const total = lots.reduce((s, l) => s.plus(to(l.m, 'g')), ZERO);
    const mix = first.map((r, n) => ({ x: r.x, u: lots.reduce((s, l) => s.plus(to(l.m, 'g').times(l.rows[n]!.u)), ZERO).div(total) }));
    const out = i.percentiles.map((pt) => {
      const p = new Dec(pt);
      const k = mix.findIndex((r) => r.u.gte(p));
      if (k <= 0) refuse(`D${pt} lies outside the size classes given (${fmt(mix[0]!.u, 1)}–${fmt(mix[mix.length - 1]!.u, 1)} % undersize)`);
      const lo = mix[k - 1]!;
      const hi = mix[k]!;
      const f = p.minus(lo.u).div(hi.u.minus(lo.u));
      const size = i.interpolation === 'log' ? Dec.exp(Dec.ln(lo.x).plus(f.times(Dec.ln(hi.x).minus(Dec.ln(lo.x))))) : lo.x.plus(f.times(hi.x.minus(lo.x)));
      const lim = i.limits?.[pt];
      return { p: pt, size, ...(lim ? { check: checkLimit(size, 'µm', lim) } : {}) };
    });
    const shown = `mix of ${lots.map((l) => `${l.m.text} ${l.name}`).join(' + ')}: ` + out.map((o) => `D${o.p} = ${fmt(o.size, 1)} µm${o.check ? ` (${o.check.shown})` : ''}`).join('; ');
    // The check is the first percentile out of limits, else the first one checked.
    const worst = out.find((o) => o.check && !o.check.pass) ?? out.find((o) => o.check);
    return { ok: true, value: out[0]!.size, unit: 'µm', percentiles: out, shown, ...(worst?.check ? { check: worst.check } : {}) };
  });
}

// ---------------------------------------------------------------- T23 Compact strength and solid fraction
export type T23Input =
  | {
      readonly mode: 'compact';
      /**
       * flat round: 2F ÷ (π D t). convex round: Pitt, Newton and Stanley (1988) equation with the wall (band) thickness.
       * fracture area: breaking force per fracture area F ÷ (D × H) in N/mm², as some dossiers state it (F0039).
       */
      readonly shape: 'flat round' | 'convex round' | 'fracture area';
      readonly force: Q;
      readonly diameter: Q;
      /** Overall thickness. */
      readonly thickness: Q;
      /** Convex only: the thickness of the straight band (central cylinder). */
      readonly wallThickness?: Q;
      /** For apparent density / solid fraction: the compact's weight, and the material's true density. */
      readonly weight?: Q;
      readonly trueDensity?: Q;
      /** Volume of a convex compact (needed for its solid fraction; a flat round one is computed). */
      readonly volume?: Q;
      readonly decimals?: number;
      readonly limit?: Limit;
    }
  | {
      readonly mode: 'ribbon';
      readonly envelopeDensity: Q;
      readonly trueDensity: Q;
      readonly decimals?: number;
      readonly limit?: Limit;
    };

export interface T23Extra {
  readonly apparentDensity?: Dec;
  readonly solidFraction?: Dec;
  readonly porosity?: Dec;
}

/** T23: tensile strength (MPa); apparent density, solid fraction and porosity from the true density. */
export function t23CompactStrength(i: T23Input): Outcome<T23Extra> {
  return run(() => {
    if (i.mode === 'ribbon') {
      const env = parse(i.envelopeDensity, 'The envelope density');
      const tru = parse(i.trueDensity, 'The true density');
      needKind(env, ['density'], 'The envelope density');
      needKind(tru, ['density'], 'The true density');
      if (!tru.v.isPositive() || tru.v.isZero()) refuse('The true density must be more than zero');
      const sf = to(env, tru.unit).div(tru.v);
      if (sf.gt(ONE)) refuse('The envelope density cannot be higher than the true density');
      const porosity = ONE.minus(sf).times(HUNDRED);
      const dp = i.decimals ?? 3;
      return { ok: true, value: sf, unit: '', solidFraction: sf, porosity, apparentDensity: to(env, 'g/cm³'), shown: `solid fraction = ${env.text} ÷ ${tru.text} = ${fmt(sf, dp)}; porosity ${fmt(porosity, 1)} %`, ...checkOf(sf, '', i.limit) };
    }
    const F = parse(i.force, 'The breaking force');
    const D = parse(i.diameter, 'The diameter');
    const t = parse(i.thickness, 'The thickness');
    needKind(F, ['force'], 'The breaking force');
    needKind(D, ['length'], 'The diameter');
    needKind(t, ['length'], 'The thickness');
    const f = to(F, 'N');
    const d = to(D, 'mm');
    const th = to(t, 'mm');
    if (!f.isPositive() || !d.isPositive() || !th.isPositive() || d.isZero() || th.isZero()) refuse('Force, diameter and thickness must be more than zero');
    let sigma: Dec;
    let line: string;
    if (i.shape === 'fracture area') {
      sigma = f.div(d.times(th));
      line = `breaking force per fracture area = ${show(f, 'N', 1)} ÷ (${show(d, 'mm', 2)} × ${show(th, 'mm', 2)}) = ${fmt(sigma, i.decimals ?? 2)} N/mm²`;
    } else if (i.shape === 'flat round') {
      sigma = f.times(2).div(PI.times(d).times(th));
      line = `tensile strength = 2 × ${show(f, 'N', 1)} ÷ (π × ${show(d, 'mm', 2)} × ${show(th, 'mm', 2)}) = ${fmt(sigma, i.decimals ?? 2)} MPa`;
    } else {
      if (i.wallThickness === undefined) refuse('A convex tablet needs the wall (band) thickness');
      const W = parse(i.wallThickness, 'The wall thickness');
      needKind(W, ['length'], 'The wall thickness');
      const w = to(W, 'mm');
      if (!w.isPositive() || w.isZero() || w.gt(th)) refuse('The wall thickness must be more than zero and not more than the overall thickness');
      const bracket = new Dec('2.84').times(th.div(d)).minus(new Dec('0.126').times(th.div(w))).plus(new Dec('3.15').times(w.div(d))).plus('0.01');
      if (!bracket.isPositive()) refuse('These dimensions are outside the range of the convex-tablet equation');
      sigma = f.times(10).div(PI.times(d.pow(2))).div(bracket);
      line = `tensile strength = 10 × ${show(f, 'N', 1)} ÷ (π × ${show(d, 'mm', 2)}²) ÷ (2.84 t/D − 0.126 t/W + 3.15 W/D + 0.01) = ${fmt(sigma, i.decimals ?? 2)} MPa`;
    }
    let extra: T23Extra = {};
    if (i.weight !== undefined || i.trueDensity !== undefined) {
      if (i.weight === undefined || i.trueDensity === undefined) refuse('The solid fraction needs both the weight and the true density');
      const m = parse(i.weight, 'The compact weight');
      const tru = parse(i.trueDensity, 'The true density');
      needKind(m, ['mass'], 'The compact weight');
      needKind(tru, ['density'], 'The true density');
      let volCm3: Dec;
      if (i.volume !== undefined) {
        const v = parse(i.volume, 'The volume');
        needKind(v, ['volume'], 'The volume');
        volCm3 = to(v, 'mL');
      } else {
        if (i.shape !== 'flat round') refuse('For a convex compact give its volume to get the solid fraction');
        volCm3 = PI.times(d.pow(2)).times(th).div(4).div(1000);
      }
      const app = to(m, 'g').div(volCm3);
      const sf = app.div(to(tru, 'g/cm³'));
      if (sf.gt(ONE)) refuse('The apparent density came out higher than the true density; check the weight, dimensions and true density');
      const porosity = ONE.minus(sf).times(HUNDRED);
      extra = { apparentDensity: app, solidFraction: sf, porosity };
      line += `; apparent density = ${m.text} ÷ ${fmt(volCm3, 4)} cm³ = ${fmt(app, 3)} g/cm³; solid fraction = ${fmt(app, 3)} ÷ ${tru.text} = ${fmt(sf, 3)}; porosity ${fmt(porosity, 1)} %`;
    }
    const su = i.shape === 'fracture area' ? 'N/mm²' : 'MPa';
    return { ok: true, value: sigma, unit: su, ...extra, shown: line, ...checkOf(sigma, su, i.limit) };
  });
}

// ---------------------------------------------------------------- T24 Specific mechanical energy
export interface T24Input {
  readonly motorPower: Q;
  readonly torquePercent: Q;
  readonly screwSpeed: Q;
  readonly maxScrewSpeed: Q;
  readonly feedRate: Q;
  /** Gearbox efficiency as a fraction, default "1". */
  readonly efficiency?: string;
  readonly decimals?: number;
  readonly limit?: Limit;
}

/** T24 SME (kWh/kg) = motor power × torque % ÷ 100 × speed ÷ max speed × efficiency ÷ feed rate. */
export function t24SpecificEnergy(i: T24Input): Outcome {
  return run(() => {
    const P = parse(i.motorPower, 'The motor power');
    needKind(P, ['power'], 'The motor power');
    const tq = percent(i.torquePercent, 'The torque');
    const N = parse(i.screwSpeed, 'The screw speed');
    const Nmax = parse(i.maxScrewSpeed, 'The maximum screw speed');
    needKind(N, ['rotation speed'], 'The screw speed');
    needKind(Nmax, ['rotation speed'], 'The maximum screw speed');
    const feed = parse(i.feedRate, 'The feed rate');
    needKind(feed, ['mass rate'], 'The feed rate');
    const eta = parse(i.efficiency ?? '1', 'The efficiency').v;
    if (tq.v.isNegative() || tq.v.gt(HUNDRED)) refuse('The torque must be from 0 to 100 %');
    if (!Nmax.v.isPositive() || Nmax.v.isZero() || N.v.isNegative() || N.v.gt(Nmax.v)) refuse('The screw speed must be from 0 up to the maximum screw speed');
    if (!feed.v.isPositive() || feed.v.isZero()) refuse('The feed rate must be more than zero');
    if (!eta.isPositive() || eta.isZero() || eta.gt(ONE)) refuse('The efficiency must be more than 0 and not more than 1');
    const value = to(P, 'kW').times(tq.v).div(HUNDRED).times(N.v.div(Nmax.v)).times(eta).div(to(feed, 'kg/h'));
    const shown = `SME = ${P.text} × ${tq.text} ÷ 100 × ${N.text} ÷ ${Nmax.text} × ${eta.toString()} ÷ ${feed.text} = ${fmt(value, i.decimals ?? 3)} kWh/kg`;
    return { ok: true, value, unit: 'kWh/kg', shown, ...checkOf(value, 'kWh/kg', i.limit) };
  });
}

// ---------------------------------------------------------------- T25 Absolute humidity
export interface T25Input {
  readonly relativeHumidity: Q;
  readonly temperature: Q;
  /** Air pressure (default 1013.25 hPa). */
  readonly pressure?: Q;
  /** g water per kg of dry air (default), or per m³ of air (F0033: inlet air 6-9 g/m³). */
  readonly per?: 'kg dry air' | 'm³ air';
  readonly decimals?: number;
  readonly limit?: Limit;
}

/**
 * T25 Absolute humidity (g water per kg dry air) from % RH and temperature, by the Magnus formula over water
 * with the WMO (Sonntag 1990) constants: e_s = 6.112 × exp(17.62 t ÷ (243.12 + t)) hPa, valid −45 to 60 °C;
 * e = RH ÷ 100 × e_s; x = 621.98 × e ÷ (p − e) g/kg (621.98 = 1000 × molar mass of water ÷ molar mass of dry air).
 * Also gives the dew point from the same formula.
 */
export function t25AbsoluteHumidity(i: T25Input): Outcome<{ readonly dewPoint: Dec }> {
  return run(() => {
    const rh = parse(i.relativeHumidity, 'The relative humidity');
    needKind(rh, ['relative humidity'], 'The relative humidity');
    const T = parse(i.temperature, 'The temperature');
    needKind(T, ['temperature'], 'The temperature');
    const t = to(T, '°C');
    if (t.lt(-45) || t.gt(60)) refuse('The formula is valid from −45 to 60 °C');
    if (rh.v.isNegative() || rh.v.isZero() || rh.v.gt(HUNDRED)) refuse('The relative humidity must be more than 0 and not more than 100 % RH');
    const p = i.pressure === undefined ? new Dec('1013.25') : to(parse(i.pressure, 'The pressure'), 'hPa');
    const a = new Dec('17.62');
    const b = new Dec('243.12');
    const es = new Dec('6.112').times(Dec.exp(a.times(t).div(b.plus(t))));
    const e = rh.v.div(HUNDRED).times(es);
    if (e.gte(p)) refuse('The vapour pressure cannot reach the air pressure');
    // Per m³ of air: ρ = e × M(water) ÷ (R × T) with e in Pa, M = 18.01528 g/mol, R = 8.314462618 J/(mol K).
    const perM3 = i.per === 'm³ air';
    const value = perM3 ? e.times(100).times('18.01528').div(new Dec('8.314462618').times(t.plus('273.15'))) : new Dec('621.98').times(e).div(p.minus(e));
    const vu = perM3 ? 'g/m³' : 'g/kg';
    const gamma = Dec.ln(rh.v.div(HUNDRED)).plus(a.times(t).div(b.plus(t)));
    const dewPoint = b.times(gamma).div(a.minus(gamma));
    const shown = `${rh.text} at ${T.text} (${fmt(p, 2)} hPa): saturation ${fmt(es, 2)} hPa, vapour ${fmt(e, 2)} hPa → ${fmt(value, i.decimals ?? 2)} ${perM3 ? 'g/m³ of air' : 'g/kg dry air'}; dew point ${fmt(dewPoint, 1)} °C`;
    return { ok: true, value, unit: vu, dewPoint, shown, ...checkOf(value, vu, i.limit) };
  });
}
