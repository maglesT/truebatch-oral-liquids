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

// bulk: a bulk tablet batch of TrueBatch Tablets (packing; pulled from its batch_fact_v1, server/pull.ts).
export const FIELD_KINDS = ['number', 'text', 'yes-no', 'choice', 'timer', 'lot', 'machine', 'room', 'bulk'] as const;
export const fieldSchema = z.object({
  name,
  label: z.string().min(1),
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
}).strict();
// A packing line: master data's blister and strip packers, forming machines and bottle lines' tablet counters.
export const PACKING_LINE = ['blister', 'strip pack', 'forming', 'tablet counter', 'packing line'];

export const SETTING_KINDS = ['quantity', 'limit', 'number', 'text', 'material'] as const;
export const settingSchema = z.object({
  name,
  label: z.string().min(1),
  kind: z.enum(SETTING_KINDS),
  // text: the fixed list the master picks from.
  options: z.array(z.string().min(1)).optional(),
  optional: z.boolean().optional(),
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
  // TB-08: weighing, charge-in, yield and line clearance always need a second-person check.
  gmp: z.enum(['weighing', 'charge-in', 'yield', 'line-clearance']).optional(),
  // Default signatures: the performer always signs; a second person checks when true.
  checker: z.boolean(),
  fields: z.array(fieldSchema).min(1),
  settings: z.array(settingSchema),
  calcs: z.array(calcSchema),
  // For repeat-until: the calculation whose check stops the rounds (the master step may name another).
  stop: name.optional(),
  // Rounds every N minutes (periodic in-process checks); the master may not set more than maxMinutes (TB-15).
  // alongside: the steps after it open once its first round is done, and its rounds go on beside them; the stage
  // closes only when its stop check passes (packing: the periodic checks of a running line).
  periodic: z.object({ maxMinutes: z.number().int().positive(), alongside: z.boolean().optional() }).strict().optional(),
  // Packing: the fields recorded when the batch is issued, as the first step of the record (TB-P2, TB-P7).
  atIssue: z.array(name).min(1).optional(),
  // A block of TrueBatch Tablets Packing (a packing master uses these and the general ones; a tablet master never).
  packing: z.boolean().optional(),
  // A new master step from this block starts as a QA hold (the master may change it).
  qaHold: z.boolean().optional(),
  // The name of a step that names a material, "{material}" its name and code: "Issue {material}".
  title: z.string().regex(/\{material\}/).optional(),
}).strict();

export type BlockField = z.infer<typeof fieldSchema>;
export type BlockSetting = z.infer<typeof settingSchema>;
export type Block = z.infer<typeof blockSchema>;

// Packing: "$pack.name" is the master's pack fact, "$batch.name" a batch fact recorded at issue, "$earlier.name" this
// field in the earlier rounds of the step (shared/engine/values.ts).
export const PACK_FACTS = ['unitsPerPack', 'packsPerCarton', 'shelfLifeMonths', 'expiryRule', 'type', 'destination', 'gtin', 'mrp'];
export const BATCH_FACTS = ['line', 'bulk', 'mfgDate', 'tablets', 'packs'];

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
  }
  for (const s of b.settings) if (s.options && (s.kind !== 'text' || !s.options.length)) p.push(`setting ${s.name}: only a text setting has a list`);
  const known = new Set([...b.fields.map((f) => f.name), ...b.settings.map((s) => s.name), ...PACK_FACTS.map((x) => `pack.${x}`), ...BATCH_FACTS.map((x) => `batch.${x}`)]);
  for (const f of b.atIssue ?? []) if (!b.fields.some((x) => x.name === f)) p.push(`atIssue: no field ${f}`);
  for (const c of b.calcs) {
    if (!(c.template in TEMPLATES)) p.push(`calculation ${c.name}: unknown template ${c.template}`);
    for (const r of refsIn(c.args)) if (!known.has(r)) p.push(`calculation ${c.name}: "$${r}" is not a field, setting or earlier calculation`);
    known.add(c.name);
  }
  if (b.stop && !b.calcs.some((c) => c.name === b.stop)) p.push(`stop: no calculation ${b.stop}`);
  return p;
}
