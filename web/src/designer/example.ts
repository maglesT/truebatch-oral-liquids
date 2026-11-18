// Worked examples and the calculation preview. Every number comes from the batch engine and the templates library,
// run on example values; nothing is saved.
import { findBlock, type Block } from '../../../shared/blocks/index.js';
import { refsIn } from '../../../shared/blocks/format.js';
import { evaluate, lineQuantity, store, type Stored, type StepEvent, type Value } from '../../../shared/engine/index.js';
import { callTemplate } from '../../../shared/engine/templates.js';
import { Dec } from '../../../shared/templates/index.js';
import type { FormulaLine, Limit, MasterDoc, Step } from '../../../shared/master/schema.js';

type Num = { value: string; unit: string };
const isNum = (v: unknown): v is Num => typeof v === 'object' && v !== null && 'value' in v && 'unit' in v;
const mid = (l: Limit): string | undefined => {
  if (l.low && l.high) { const d = Math.max(l.low.split('.')[1]?.length ?? 0, l.high.split('.')[1]?.length ?? 0); return new Dec(l.low).plus(l.high).div(2).toFixed(d); }
  return l.low ?? l.high;
};
const vary = (v: string, n: number) => Array.from({ length: n }, (_, i) => new Dec(v).times(new Dec(1).plus(new Dec((i % 5) - 2).div(400))).toFixed(Math.max(v.split('.')[1]?.length ?? 0, 1)));

// The chip gives the verdict: a result text that ends in its own "PASS" or "FAIL" does not say it twice.
export const verdictless = (shown: string) => shown.replace(/:\s*(PASS|FAIL)$/, '');

/** The fields a block's calculations use (only these get example values). */
export const usedFields = (b: Block) => b.fields.filter((f) => b.calcs.some((c) => refsIn(c.args).includes(f.name)));

/** Example values for a step: middle of the limits, the expected answers; then a gross weight that meets the target etc. */
function defaults(doc: MasterDoc, si: number, ti: number): Record<string, Value> {
  const step = doc.stages[si]!.steps[ti]!;
  const b = findBlock(step.block)!;
  const out: Record<string, Value> = {};
  const unitOf = (f: Block['fields'][number]) => {
    const u = f.unit?.startsWith('$') ? step.settings[f.unit.slice(1)] : f.unit;
    return typeof u === 'string' ? u : '';
  };
  for (const f of usedFields(b)) {
    if (f.kind === 'yes-no' || f.kind === 'choice') {
      const c4 = b.calcs.find((c) => c.template === 'C4' && refsIn(c.args).includes(f.name));
      out[f.name] = String((c4?.args.expected as string[] | undefined)?.[0] ?? f.options?.[0] ?? 'yes');
      continue;
    }
    if (f.kind === 'timer') { out[f.name] = EXAMPLE_START; continue; }
    if (f.kind !== 'number') { out[f.name] = 'EXAMPLE-1'; continue; }
    let v = '1.000';
    for (const c of b.calcs) {
      const a = c.args as Record<string, unknown>;
      const lim = typeof a.limit === 'string' ? step.settings[a.limit.slice(1).replace(/\?$/, '')] : undefined;
      if ((a.value === `$${f.name}` || a.readings === `$${f.name}`) && lim && typeof lim === 'object' && 'unit' in lim) v = mid(lim) ?? v;
      if (c.template === 'T4' && (a.parts as { value: string }[]).some((p) => p.value === `$${f.name}`) && !b.calcs.some((x) => x.template === 'T3' && x.args.actual === `$${f.name}`)) v = '0.000';
    }
    out[f.name] = f.count ? vary(v, f.count).map((x) => ({ value: x, unit: unitOf(f) })) : { value: v, unit: unitOf(f) };
  }
  return out;
}

const EXAMPLE_START = '2026-11-15 08:00';
const CERTIFICATE: Record<string, string> = { assay: '99.0', water: '0.5', lod: '0.5', content: '98.0' };
const asNum = (v: unknown): Num | undefined => {
  if (isNum(v)) return v;
  const m = typeof v === 'string' ? /^([+-]?\d+(?:\.\d+)?)\s*(.*)$/.exec(v.trim()) : null;
  return m ? { value: m[1]!, unit: m[2]! } : undefined;
};

/** Second pass: inputs that follow from results (gross = target + tare, output = theoretical × the middle of the yield limits …). */
function follow(b: Block, step: Step, values: Record<string, Value>, res: (n: string) => Num | undefined, fixed: Set<string>) {
  const num = (x: unknown) => (typeof x === 'string' && x.startsWith('$') ? x.slice(1).replace(/\?$/, '') : '');
  const set = (f: string, v: Dec, unit: string) => { if (!fixed.has(f) && isNum(values[f])) values[f] = { value: v.toFixed(3), unit: (values[f] as Num).unit || unit }; };
  const lim = (n: string) => { const l = step.settings[n]; return l && typeof l === 'object' && 'unit' in l ? mid(l) : undefined; };
  for (const c of b.calcs) {
    const a = c.args as Record<string, unknown>;
    const around = a.around as { centre?: string } | undefined;
    if (c.template === 'C1' && around?.centre) {
      const t1 = b.calcs.find((x) => x.name === num(a.value) && x.template === 'T1');
      const centre = res(num(around.centre)); const tare = t1 && values[num((t1.args as { b: string }).b)];
      if (t1 && centre && isNum(tare)) set(num((t1.args as { a: string }).a), new Dec(centre.value).plus(tare.value), centre.unit);
    }
    // A time from start to end: the end is the start plus the middle of the time limits.
    const minutes = c.template === 'T13' ? lim(num(a.limit)) : undefined;
    const unit = (step.settings[num(a.limit)] as Limit | undefined)?.unit;
    if (minutes && values[num(a.start)] === EXAMPLE_START && !fixed.has(num(a.end))) {
      values[num(a.end)] = new Date(Date.parse(`${EXAMPLE_START}:00Z`) + Number(minutes) * 60_000 * (unit === 'h' ? 60 : unit === 's' ? 1 / 60 : 1)).toISOString().slice(0, 16).replace('T', ' ');
    }
    const t = res(num(a.theoretical ?? a.before ?? a.input));
    if (!t) continue;
    if (c.template === 'T3') { const m = lim(num(a.limit)); if (m) set(num(a.actual), new Dec(t.value).times(m).div(100), t.unit); }
    if (c.template === 'T5') { const m = lim(num(a.limit)); if (m) set(num(a.after), new Dec(t.value).times(new Dec(100).plus(m)).div(100), t.unit); }
    // Samples and rejects: a little of the input each.
    if (c.template === 'T4') for (const p of a.parts as { value: string }[]) if (!b.calcs.some((x) => x.template === 'T3' && x.args.actual === p.value)) set(num(p.value), new Dec(t.value).times('0.003'), t.unit);
  }
}

const event = (stage: number, step: number, round: number, values: Record<string, Value>, results: Record<string, Stored>, id: number): StepEvent =>
  ({ id, stage, sub: 1, step, round, kind: 'value', payload: { values, results }, person: 1, at: new Date() });
const where = (doc: MasterDoc, sk: string, tk: string) => { const s = doc.stages.findIndex((x) => x.key === sk); return [s, doc.stages[s]?.steps.findIndex((t) => t.key === tk) ?? -1] as const; };

export interface Example { values: Record<string, Value>; results: Record<string, Stored> }
/**
 * A worked example of a step: example values (or the ones typed over them) run through the engine. Earlier steps it
 * refers to get their own example first (and so do the weighings a compensating filler waits for).
 */
export function workedExample(doc: MasterDoc, si: number, ti: number, typed: Record<string, Value> = {}, depth = 0): Example {
  const step = doc.stages[si]?.steps[ti];
  const b = step && findBlock(step.block);
  if (!step || !b) return { values: {}, results: {} };
  const events: StepEvent[] = [];
  const earlier = new Map<string, Example>();
  const add = (rs: number, rt: number) => {
    if (depth > 3 || rt < 0 || earlier.has(`${rs}/${rt}`)) return;
    const e = workedExample(doc, rs, rt, {}, depth + 1);
    earlier.set(`${rs}/${rt}`, e);
    events.push(event(rs, rt, 1, e.values, e.results, events.length + 1));
  };
  const values: Record<string, Value> = defaults(doc, si, ti);
  for (const v of Object.values(step.settings)) {
    if (typeof v !== 'object') continue;
    if ('ref' in v) { const [sk, tk] = v.ref.split('/'); add(...where(doc, sk!, tk!)); }
    if ('formula' in v && v.adjusted) {
      const line = doc.formula.find((l) => l.key === v.formula);
      for (const f of b.fields) if (CERTIFICATE[f.name] && line?.adjust && !line.adjust.compensates?.length) values[f.name] = { value: CERTIFICATE[f.name]!, unit: '%' };
      for (const k of line?.adjust?.compensates ?? []) doc.stages.forEach((s, rs) => s.steps.forEach((t, rt) => {
        if (Object.values(t.settings).some((x) => typeof x === 'object' && 'formula' in x && x.formula === k && x.adjusted)) add(rs, rt);
      }));
    }
  }
  Object.assign(values, typed);
  const prev = JSON.stringify(b.calcs).includes('"$prev.');
  if (prev) events.push(event(si, ti, 1, values, {}, events.length + 1));
  const key = { stage: si, sub: 1, step: ti, round: prev ? 2 : 1 };
  const first = evaluate(doc, events, key, values);
  const res = (n: string): Num | undefined => {
    const r = first[n];
    if (r?.ok) return { value: r.value, unit: r.unit };
    const v = values[n] ?? step.settings[n];
    if (typeof v === 'object' && v !== null && 'ref' in v) {
      const [sk, tk, name] = v.ref.split('/');
      const e = earlier.get(where(doc, sk!, tk!).join('/'));
      const x = e?.results[name!];
      return x?.ok ? { value: x.value, unit: x.unit } : asNum(e?.values[name!]);
    }
    return asNum(v);
  };
  follow(b, step, values, res, new Set(Object.keys(typed)));
  return { values, results: evaluate(doc, events, key, values) };
}

export interface LotValues { assay?: string; water?: string; lod?: string; content?: string }
export interface Dispensed { line: FormulaLine; standard: Stored; adjusted?: Stored }
/**
 * The calculation preview: each formula line's batch quantity, adjusted with the example lot values (salt factor,
 * potency or content, overage), and the compensating fillers (T10) from the adjusted quantities.
 */
export function dispensing(doc: MasterDoc, lots: Record<string, LotValues>): Dispensed[] {
  const here = { stage: 0, sub: 1, step: 0, round: 1 };
  const valuesOf = (k: string): Record<string, Value> => Object.fromEntries(Object.entries(lots[k] ?? {}).filter(([, v]) => v?.trim()).map(([n, v]) => [n, { value: v!.trim(), unit: '%' }]));
  const adjustedLines = doc.formula.filter((l) => l.adjust && !l.adjust.compensates?.length);
  const out = new Map<string, Dispensed>();
  for (const l of doc.formula) out.set(l.key, { line: l, standard: lineQuantity(doc, [], here, l, false, {}) });
  for (const l of adjustedLines) out.get(l.key)!.adjusted = lineQuantity(doc, [], here, l, true, valuesOf(l.key));
  // The fillers compensate the quantities "weighed" in a preview stage made of the adjusted lines.
  const preview: MasterDoc = { ...doc, stages: [{ key: 'preview', name: 'Preview', kind: 'normal', roomTypes: [], machineTypes: [], role: '', uses: [],
    steps: adjustedLines.map((l, i) => ({ key: `w${i}`, block: { id: 'weigh', version: 1 }, settings: { target: { formula: l.key, adjusted: true } }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' } })) }] };
  const events = adjustedLines.map((l, i) => event(0, i, 1, {}, { target: out.get(l.key)!.adjusted! }, i + 1));
  for (const l of doc.formula) if (l.adjust?.compensates?.length) out.get(l.key)!.adjusted = lineQuantity(preview, events, here, l, true, valuesOf(l.key));
  return doc.formula.map((l) => out.get(l.key)!);
}

/** The theoretical batch weights (T8): tablet weight × batch size. */
export const batchWeight = (doc: MasterDoc, mg: string | undefined) =>
  (mg ? store(callTemplate('T8', { mode: 'per unit', perUnit: `${mg} mg`, count: `${doc.header.batchSize} tablets`, unit: 'kg' })) : undefined);
