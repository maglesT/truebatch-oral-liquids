/**
 * A master version is ONE JSON document: the header, the formula, and the stages in order with their steps in order.
 * This schema checks only its shape; whether it makes a good master is for checks.ts. A draft may be incomplete.
 */
import { z } from 'zod';

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'a plain decimal, e.g. "250.0"');
export const keySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lower-case letters, digits and -');
const text = (max = 200) => z.string().trim().max(max);

export const limitSchema = z.object({
  low: z.string().optional(), high: z.string().optional(), unit: z.string(),
  lowStrict: z.boolean().optional(), highStrict: z.boolean().optional(),
  alertLow: z.string().optional(), alertHigh: z.string().optional(),
}).strict();

// A step setting: a value as written ("0.5", "250.0 mg"), a limit, or a reference to an earlier step's field or
// calculation ("stage/step/name"), to a formula line (its batch quantity, adjusted when asked) or to the header.
// Header values (shared/engine/values.ts headerValue): the batch as written, its volume (L; a batch in kg by the
// density), its mass (kg), the density, and for a dry syrup the fill weight per container and the containers expected.
export const HEADER_VALUES = ['batchSize', 'batchVolume', 'batchMass', 'density', 'fillWeight', 'containers'] as const;
export const settingValueSchema = z.union([
  text(),
  limitSchema,
  z.object({ ref: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-zA-Z0-9]+$/, 'stage/step/name') }).strict(),
  z.object({ formula: keySchema, adjusted: z.boolean().optional() }).strict(),
  z.object({ header: z.enum(HEADER_VALUES) }).strict(),
]);

const flowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  // Rounds of the same step until the stop check passes, at most maxRounds (then a deviation note is needed).
  z.object({ kind: z.literal('repeat-until'), maxRounds: z.number().int().min(1).max(500).optional(), stop: z.string().optional() }).strict(),
  z.object({ kind: z.literal('optional-with-reason') }).strict(),
  z.object({ kind: z.literal('qa-hold') }).strict(),
]);

export const stepSchema = z.object({
  key: keySchema,
  block: z.object({ id: z.string(), version: z.number().int().min(1) }).strict(),
  // The name people read (e.g. "Punch and die check — after compression"); without it, the block's name and material.
  name: text(120).optional(),
  instruction: text(4000).optional(),
  settings: z.record(settingValueSchema).default({}),
  // The performer always signs; a second person checks when true.
  checker: z.boolean(),
  // The next step waits for the check (otherwise it opens when this step is done).
  waitForCheck: z.boolean().default(false),
  critical: z.boolean().default(false),
  minMinutes: z.number().int().positive().max(10_000).optional(),
  everyMinutes: z.number().int().positive().max(10_000).optional(),
  // F6 with a changing interval: after `afterMinutes` from the first round, a round every `everyMinutes` (F0030).
  everyMinutesLater: z.object({ afterMinutes: z.number().int().positive().max(10_000), everyMinutes: z.number().int().positive().max(10_000) }).strict().optional(),
  // F4 by a rule: the step is done only when a header value is within the limit (F0040: the bag premix only for a
  // batch of at most 50 kg); otherwise it is not applicable, with no operator choice.
  onlyIf: z.object({ header: z.enum(HEADER_VALUES), limit: limitSchema }).strict().optional(),
  // A spray of a liquid made in excess: the amount of liquid to apply per amount charged (F0339: 971 g per 150 g).
  applyPerCharge: z.object({ liquid: text(40), charge: text(40) }).strict().optional(),
  // Order-critical: this step must come after the step with this key in the same stage (F0318: the drug after the PVP).
  orderAfter: keySchema.optional(),
  flow: flowSchema.default({ kind: 'none' }),
  // Only trained people sign (owner, 17 Nov 2026): the skill Recruitment publishes (training_v1) that the performer and
  // the checker must hold, picked from Recruitment's list (typed only while the link is off). None: anyone may sign.
  training: z.object({ code: text(60).min(1), title: text(200).optional() }).strict().optional(),
}).strict();

export const stageSchema = z.object({
  key: keySchema,
  name: text().min(1),
  kind: z.enum(['normal', 'preparation', 'sub-batch']),
  count: z.number().int().min(2).max(50).optional(),
  roomTypes: z.array(text()).max(20).default([]),
  machineTypes: z.array(text()).max(50).default([]),
  role: text().default(''),
  produces: z.object({ name: text().min(1), holdHours: z.number().positive().max(100_000).optional() }).strict().optional(),
  // Stages whose intermediate this stage uses (preparations must be closed first; their hold time ends here).
  uses: z.array(keySchema).max(20).default([]),
  steps: z.array(stepSchema).max(200),
}).strict();

const form = z.object({
  name: text().min(1), mw: decimal, moleculesPerUnit: z.number().int().min(1).optional(), hydrateOrSolvate: z.boolean().optional(),
  // The ion's charge, for a label claim in mEq (F0393).
  charge: z.number().int().min(1).max(4).optional(),
}).strict();

export const lineSchema = z.object({
  key: keySchema,
  materialItemId: z.string().min(1).max(100),
  code: text(),
  name: text(),
  // mg per mL of a liquid batch (a batch in L, or in kg by the density), or mg per g of a dry syrup powder. The
  // vehicle made up to volume (purified water "q.s.") has none: it is whatever makes the volume or weight.
  mg: decimal.optional(),
  // solvent: the vehicle made up to volume, or a solvent removed in processing (granulation water of a dry syrup).
  role: z.enum(['api', 'excipient', 'solvent']),
  // A granulated dry syrup only: where the material goes (granules, blended after, binder, coating of the granules).
  place: z.enum(['intragranular', 'extragranular', 'binder', 'coating']).optional(),
  // The API's label claim per the header's "claim per" ("120 mg", "10 mEq"), as the header's "claim as" substance;
  // checked, never used.
  labelClaim: text(40).optional(),
  // A batch quantity as written in the source ("12.000 kg"); only checked against mg per mL (or g) × the batch (T8).
  batchQuantity: text(40).optional(),
  // Settings of the adjustment templates, applied in this order: T11 salt factor, T9 potency or T18 content, T16
  // overage; or, for a filler, T10 compensation of the named lines.
  adjust: z.object({
    // `factor`: the salt factor as written in the formula; only checked against the molecular weights, never used.
    salt: z.object({ from: form, to: form, factor: decimal.optional() }).strict().optional(),
    potency: z.object({
      basis: z.enum(['as is', 'anhydrous', 'dried', 'ignited', 'anhydrous and solvent-free']),
      standardIs: z.enum(['anhydrous', 'hydrate or solvate']).optional(),
      assayExpressedAs: z.enum(['anhydrous substance', 'hydrate']).optional(),
      potencyAs: z.enum(['parent', 'element']).optional(),
      assayAbove100: z.enum(['use', 'treat as 100']).optional(),
    }).strict().optional(),
    content: z.object({
      formulaQuantityIs: z.enum(['dry', 'wet']), nominalContent: z.string().optional(), contentSource: z.enum(['certificate', 'in-process result']).optional(),
      // What an in-process result is: the content, or a relative assay in % of theoretical (F0205).
      resultType: z.enum(['content', 'percent of theoretical']).optional(),
    }).strict().optional(),
    overage: z.object({ percent: decimal, maxPercent: decimal.optional() }).strict().optional(),
    compensates: z.array(keySchema).max(20).optional(),
  }).strict().optional(),
}).strict();

// The liquid batch header (plan data change 1, the shape of TrueBatch Injectables' header). A liquid is made in L or
// kg (the formula per mL; a batch in kg turns into its volume by the density); a dry syrup powder in kg (the formula
// per g). A packing master's standard batch is in packs. Nothing worked out from these is typed in the batch.
export const PRODUCT_TYPES = ['solution', 'drops', 'suspension', 'emulsion', 'dry syrup'] as const;
export const BATCH_UNITS = ['L', 'kg', 'packs'] as const;
// What the label claim is per: 1 mL, a dose volume (5 mL, 10 mL …: doseVolumeMl), a drop (dropsPerMl), the whole
// container, 1 g of powder (scoop or weighed per dose), or none (a diluent or vehicle batch: the claim check is
// answered instead).
export const CLAIM_PER = ['mL', 'dose volume', 'drop', 'container', 'g of powder', 'none'] as const;
export const headerSchema = z.object({
  productItemId: z.string().min(1).max(100),
  productCode: text(),
  productName: text(),
  // solution covers syrups, oral solutions and elixirs; dry syrup covers powders for oral suspension or solution.
  type: z.enum(PRODUCT_TYPES).optional(),
  batchSize: decimal,
  batchUnit: z.enum(BATCH_UNITS),
  // g/mL at the stated temperature (°C): every liquid batch has one (a batch in kg, a make-up by weight, the fill).
  densityGPerMl: decimal.optional(),
  densityAtC: decimal.optional(),
  claimPer: z.enum(CLAIM_PER).optional(),
  doseVolumeMl: decimal.optional(),
  dropsPerMl: decimal.optional(),
  // The substance the claim is of: base, salt, ion or element, with its hydrate ("paracetamol", "potassium (K+)").
  claimAs: text(120).optional(),
  // A dry syrup: the powder filled per container (g) and the volume after the patient makes it up (mL).
  fillWeightG: decimal.optional(),
  reconstitutedMl: decimal.optional(),
  doses: z.enum(['single-dose', 'multi-dose']).optional(),
  rxOtc: z.enum(['Rx', 'OTC']).optional(),
  // TL-11: the rooms of master data (codes) where this product's materials are weighed; a balance is offered there or
  // in a room the stage allows (shared/engine/picks.ts). A version made before this setting has none.
  dispensingRooms: z.array(text()).max(20).optional(),
}).strict();

// The author's answer to a calculation warning (checks.ts), keyed by the warning and its item. `about` is the warning
// as answered: when the warning reads differently (the item changed), it needs a new answer.
export const answerSchema = z.object({ about: text(1000), choice: text().min(1), reason: text(1000) }).strict();

// TrueBatch Liquids Packing (TL-P1): a packing master is per product, pack type and size, and destination. Its header
// names the finished pack product and the standard packing batch in packs (batchSize, batchUnit "packs"); `pack` holds
// the rest (the bottle, its fill and closure). Its formula is empty: the packing materials
// are `pack.materials`, and a step setting { formula: key } names one of them.
export const PACK_TYPES = ['blister', 'strip', 'bottle'] as const;
export const PACK_MATERIAL_KINDS = ['foil', 'forming film', 'carton', 'leaflet', 'label', 'shipper', 'bottle', 'closure', 'desiccant', 'other'] as const;
export const DESTINATIONS = ['India domestic', 'Export'] as const;
export const packMaterialSchema = z.object({
  key: keySchema,
  materialItemId: z.string().min(1).max(100),
  code: text(),
  name: text(),
  kind: z.enum(PACK_MATERIAL_KINDS),
  // Printed (artwork): issued only by its step with a second person, reconciled to zero (TL-P4, TL-P6).
  printed: z.boolean(),
  // Coded on the line with the batch number, dates and MRP (TL-P5, TL-P9); leftovers are destroyed.
  coded: z.boolean(),
  perPack: decimal,
  unit: z.enum(['units', 'm', 'g']),
}).strict();
export const packSchema = z.object({
  bulkItemId: z.string().min(1).max(100),
  bulkCode: text(),
  bulkName: text(),
  type: z.enum(PACK_TYPES),
  // Tablets in one blister, strip or bottle, and packs in one carton.
  unitsPerPack: z.number().int().min(1).max(10_000),
  packsPerCarton: z.number().int().min(1).max(1000),
  // The approved shelf life (TL-P8): the expiry is worked out from it, never typed.
  shelfLifeMonths: z.number().int().min(1).max(120),
  // "month before": expiry = month of manufacture + shelf life − 1 (use before the end of that month).
  expiryRule: z.enum(['month before', 'same month']).default('month before'),
  destination: z.enum(DESTINATIONS),
  // Maximum retail price per pack in rupees (India domestic, TL-P9).
  mrp: decimal.optional(),
  // The pack's GTIN, for checking the codes of the customer's serialisation system.
  gtin: z.string().regex(/^\d{14}$/, '14 digits').optional(),
  serialisation: z.boolean().default(false),
  materials: z.array(packMaterialSchema).max(50),
}).strict();

export const masterSchema = z.object({
  header: headerSchema,
  formula: z.array(lineSchema).max(100),
  stages: z.array(stageSchema).max(50),
  answers: z.record(z.string().max(120), answerSchema).optional(),
  pack: packSchema.optional(),
}).strict();

export type MasterDoc = z.infer<typeof masterSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Step = z.infer<typeof stepSchema>;
export type FormulaLine = z.infer<typeof lineSchema>;
export type SettingValue = z.infer<typeof settingValueSchema>;
export type Limit = z.infer<typeof limitSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Pack = z.infer<typeof packSchema>;
export type PackMaterial = z.infer<typeof packMaterialSchema>;

/** Every material a step may name: the formula lines, or a packing master's packing materials. */
export const materialLines = (doc: MasterDoc): (FormulaLine | PackMaterial)[] => [...doc.formula, ...(doc.pack?.materials ?? [])];

export const MASTER_STATES = ['draft', 'in_review', 'approved', 'effective', 'retired'] as const;
export type MasterState = (typeof MASTER_STATES)[number];
