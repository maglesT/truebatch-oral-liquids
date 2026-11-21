/**
 * The block description format. A block is DATA: the fields a person records, the settings a master step fills, the
 * templates it applies to them, its default instruction and signatures. One engine runs every block the same way; a
 * new block is a new description file (listed in index.ts).
 *
 * Calculation arguments are the template's own input object, written as JSON. A string "$name" is replaced by the
 * value of this step's field, setting or earlier calculation of that name; everything else is passed as written.
 * "$name?" names an optional setting or field (left out when it is not set, and left out of a list). "$prev.name" is the
 * same field or calculation in the previous round of a repeat-until step (in round 1 the calculation waits).
 */
import { z } from 'zod';
import { findUnit } from '../templates/index.js';
import { TEMPLATES } from '../engine/templates.js';

const name = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/);

// bulk: a bulk tablet batch of TrueBatch Liquids (packing; pulled from its batch_fact_v1, server/pull.ts).
export const FIELD_KINDS = ['number', 'text', 'yes-no', 'choice', 'timer', 'lot', 'machine', 'room', 'bulk'] as const;
export const fieldSchema = z.object({
  name,
  label: z.string().min(1),
  // Fix round 21 Nov 2026 (A2): the text setting whose value the master gives as this field's label (what a lab test
  // is: "Assay of metformin"); the label above while the master leaves it empty.
  labelFrom: name.optional(),
  kind: z.enum(FIELD_KINDS),
  // number: the unit from the unit list, or "$setting" when the master step names it.
  unit: z.string().optional(),
  // number: a list of exactly this many readings (e.g. 20 tablet weights).
  count: z.number().int().min(2).max(100).optional(),
  // choice: the fixed list.
  options: z.array(z.string().min(1)).optional(),
  optional: z.boolean().optional(),
  // text: a calendar date, picked from a date picker and kept as YYYY-MM-DD; shown as "31 Oct 2029".
  date: z.boolean().optional(),
  // machine: words of master data's type it takes (any of them, without case), e.g. ["balance"]; none: any type. A type
  // with one of the notTypes words is not taken (a QC lab "Analytical balance" is not a dispensing balance).
  types: z.array(z.string().regex(/^[a-z][a-z ]*$/)).optional(),
  notTypes: z.array(z.string().regex(/^[a-z][a-z ]*$/)).optional(),
  // machine (fix round 21 Nov 2026, A8): a capability the machine must have, named in master data's type or name (any
  // of these words, without case): a bilayer tablet press is "Rotary tablet press 45 station (bilayer)".
  capability: z.array(z.string().regex(/^[a-z][a-z -]*$/)).optional(),
  // number: a QC result of this batch (from the QC report). While the LIMS link answers it is picked from the batch's
  // approved CoA in LIMS (result_v1, its reported figure); absent or down, typed by hand (shared/engine/lims.ts).
  // Round 42 (owner: in-process lab tests are picked from LIMS, not typed): 'in_process' is an in-process test done in
  // the QC lab on a sample of THIS step. The step publishes a lab request when it starts (report.lab_request_v1); the
  // field picks a result of an approved in-process report of that request (its reported figure; a list of readings
  // picks LIMS's individual values, in order, exactly `count` of them). `true` stays the release CoA's result (round 44:
  // no Tablets block uses it now, the uniformity-by-weight assay is in-process; kept for the editions that do).
  qc: z.union([z.literal(true), z.literal('in_process')]).optional(),
  // An in-process list (qc 'in_process', count): what LIMS's reported figure of the result is, worked out again from the
  // values picked and compared (rounded as LIMS wrote it): 'mean' of the values, or 'AV' the acceptance value of
  // content uniformity (T14, with the step's coating). LIMS's own figure must then agree.
  figure: z.enum(['mean', 'AV']).optional(),
  // A staged in-process list: the field that holds the next stage's readings (content uniformity: 20 more after 10).
  // LIMS keeps one result with every value in order (10, then 30 after the second stage): this field takes the first
  // values, the next stage's field the rest.
  nextStage: name.optional(),
}).strict();
// A packing line: master data's blister and strip packers, forming machines and bottle lines' tablet counters.
export const PACKING_LINE = ['filling line', 'bottle filling', 'filling and capping', 'sachet', 'packing line'];

export const SETTING_KINDS = ['quantity', 'limit', 'number', 'text', 'material'] as const;
export const settingSchema = z.object({
  name,
  label: z.string().min(1),
  kind: z.enum(SETTING_KINDS),
  // text: the fixed list the master picks from.
  options: z.array(z.string().min(1)).optional(),
  optional: z.boolean().optional(),
  // quantity: never a batch quantity (as Tablets round 31). Only 'tolerance': a small difference (the largest change
  // between rounds of drying to constant weight), typed only; a formula line, a header value or an earlier step is
  // refused (checks.ts) and the designer does not offer them.
  notBatch: z.enum(['tolerance']).optional(),
}).strict();

export const calcSchema = z.object({
  name,
  label: z.string().min(1),
  template: z.string(),
  args: z.record(z.unknown()),
}).strict();

export const blockSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  version: z.number().int().min(1),
  name: z.string().min(1),
  instruction: z.string().min(1),
  // TL-08: weighing, charge-in, yield and line clearance always need a second-person check.
  gmp: z.enum(['weighing', 'charge-in', 'yield', 'line-clearance']).optional(),
  // Default signatures: the performer always signs; a second person checks when true.
  checker: z.boolean(),
  fields: z.array(fieldSchema).min(1),
  settings: z.array(settingSchema),
  calcs: z.array(calcSchema),
  // For repeat-until: the calculation whose check stops the rounds (the master step may name another).
  stop: name.optional(),
  // Rounds every N minutes (periodic in-process checks); the master may not set more than maxMinutes.
  // alongside: the steps after it open once its first round is done, and its rounds go on beside them; the stage
  // closes only when its stop check passes (packing: the periodic checks of a running line).
  periodic: z.object({ maxMinutes: z.number().int().positive(), alongside: z.boolean().optional() }).strict().optional(),
  // Packing: the fields recorded when the batch is issued, as the first step of the record (TL-P2, TL-P7).
  atIssue: z.array(name).min(1).optional(),
  // A block of TrueBatch Liquids Packing (a packing master uses these and the general ones; a tablet master never).
  packing: z.boolean().optional(),
  // A new master step from this block starts as a QA hold (the master may change it).
  qaHold: z.boolean().optional(),
  // The name of a step that names a material, "{material}" its name and code: "Issue {material}".
  title: z.string().regex(/\{material\}/).optional(),
}).strict();

export type BlockField = z.infer<typeof fieldSchema>;
/** A2: the block's fields with the labels the master step gives them (labelFrom). */
export function labelled(fields: readonly BlockField[], settings: Readonly<Record<string, unknown>>): BlockField[] {
  return fields.map((f) => { const v = f.labelFrom ? settings[f.labelFrom] : undefined; return typeof v === 'string' && v.trim() ? { ...f, label: v.trim() } : f; });
}
export type BlockSetting = z.infer<typeof settingSchema>;
export type Block = z.infer<typeof blockSchema>;

// Packing: "$pack.name" is the master's pack fact, "$batch.name" a batch fact recorded at issue, "$earlier.name" this
// field in the earlier rounds of the step (shared/engine/values.ts).
export const PACK_FACTS = ['packsPerCarton', 'shelfLifeMonths', 'expiryRule', 'type', 'destination', 'gtin', 'mrp', 'fillTarget', 'fillWeight'];
export const BATCH_FACTS = ['line', 'bulk', 'mfgDate', 'quantity', 'readyAt', 'holdHours', 'packs'];

/** The names inside "$name" strings of calculation arguments ("$name?" optional, "$prev.name" the previous round). */
export function refsIn(x: unknown): string[] {
  if (typeof x === 'string') return x.startsWith('$') ? [x.slice(1).replace(/^(prev|earlier)\./, '').replace(/\?$/, '')] : [];
  if (Array.isArray(x)) return x.flatMap(refsIn);
  if (x && typeof x === 'object') return Object.values(x).flatMap(refsIn);
  return [];
}

/** Problems in a block description; empty when it can be used. */
export function blockProblems(b: Block): string[] {
  const p: string[] = [];
  const parsed = blockSchema.safeParse(b);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const names = new Set<string>();
  for (const x of [...b.fields, ...b.settings, ...b.calcs]) {
    if (names.has(x.name)) p.push(`"${x.name}" is used twice`);
    names.add(x.name);
  }
  const settings = new Set(b.settings.map((s) => s.name));
  for (const f of b.fields) {
    if (f.kind === 'number' && !f.unit) p.push(`field ${f.name}: a number needs a unit`);
    if (f.unit?.startsWith('$') ? !settings.has(f.unit.slice(1)) : f.unit !== undefined && !findUnit(f.unit)) p.push(`field ${f.name}: unknown unit ${f.unit}`);
    if (f.kind === 'choice' && !f.options?.length) p.push(`field ${f.name}: a choice needs options`);
    if (f.qc === true && (f.kind !== 'number' || f.count !== undefined)) p.push(`field ${f.name}: only a single number is a QC result from LIMS`);
    if (f.qc === 'in_process' && f.kind !== 'number') p.push(`field ${f.name}: only a number or a list of readings is an in-process result from LIMS`);
    if (f.figure && (f.qc !== 'in_process' || f.count === undefined)) p.push(`field ${f.name}: only an in-process list of readings names LIMS's figure`);
    if (f.figure === 'AV' && !b.settings.some((s) => s.name === 'coating')) p.push(`field ${f.name}: the acceptance value needs the coating setting`);
    if (f.nextStage) {
      const next = b.fields.find((x) => x.name === f.nextStage);
      // A3 (fix round 21 Nov 2026): a chain of stages (dissolution 6, 6, 12), never back to an earlier one.
      const seen = new Set([f.name]);
      for (let x = next; x?.nextStage; x = b.fields.find((y) => y.name === x!.nextStage)) { if (seen.has(x.name)) { p.push(`field ${f.name}: the stages go round in a circle`); break; } seen.add(x.name); }
      if (!next || next.qc !== 'in_process' || next.count === undefined || f.count === undefined || f.qc !== 'in_process') {
        p.push(`field ${f.name}: the next stage is another in-process list of readings`);
      }
    }
  }
  for (const f of b.fields) if (f.labelFrom && b.settings.find((s) => s.name === f.labelFrom)?.kind !== 'text') p.push(`field ${f.name}: its label comes from a text setting`);
  for (const s of b.settings) if (s.options && (s.kind !== 'text' || !s.options.length)) p.push(`setting ${s.name}: only a text setting has a list`);
  for (const s of b.settings) if (s.notBatch && s.kind !== 'quantity') p.push(`setting ${s.name}: only a quantity setting is marked not a batch quantity`);
  const known = new Set([...b.fields.map((f) => f.name), ...b.settings.map((s) => s.name), ...PACK_FACTS.map((x) => `pack.${x}`), ...BATCH_FACTS.map((x) => `batch.${x}`)]);
  for (const f of b.atIssue ?? []) if (!b.fields.some((x) => x.name === f)) p.push(`atIssue: no field ${f}`);
  // "$prev.name" reads the previous round, so it may name any calculation of the block, this one included.
  const all = new Set([...known, ...b.calcs.map((c) => c.name)]);
  const prev = (x: unknown): string[] => (typeof x === 'string' ? (x.startsWith('$prev.') ? [x.slice(6).replace(/\?$/, '')] : [])
    : Array.isArray(x) ? x.flatMap(prev) : x && typeof x === 'object' ? Object.values(x).flatMap(prev) : []);
  for (const c of b.calcs) {
    if (!(c.template in TEMPLATES)) p.push(`calculation ${c.name}: unknown template ${c.template}`);
    const fromPrev = new Set(prev(c.args));
    for (const r of refsIn(c.args)) if (!known.has(r) && !(fromPrev.has(r) && all.has(r))) p.push(`calculation ${c.name}: "$${r}" is not a field, setting or earlier calculation`);
    known.add(c.name);
  }
  if (b.stop && !b.calcs.some((c) => c.name === b.stop)) p.push(`stop: no calculation ${b.stop}`);
  return p;
}
