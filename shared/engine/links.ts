/**
 * Where a recorded value came from (owner 15 Nov 2026). A link that answers gives the value (pulled, it cannot be
 * typed over); a link that is absent (not licensed, switched off) or down (switched on but not answering) leaves it
 * to people: typed by hand from the label or certificate, with a second-person check, and listed for QA.
 */
import type { BlockField } from '../blocks/format.js';

// truebatch_liquids: TrueBatch Oral Liquids' published bulk batches, read by TrueBatch Oral Liquids Packing. recruitment: the people's
// training (training.ts), read when a person signs a step that names one. lims: QC's CoAs and results (lims.ts).
export const PROVIDERS = ['deviations', 'qms', 'logbook', 'mms', 'truebatch_liquids', 'recruitment', 'lims'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type LinkState = 'absent' | 'down' | 'ok';
export const PROVIDER_NAME: Record<Provider, string> = { deviations: 'Deviations', qms: 'QMS', logbook: 'Logbook', mms: 'MMS', truebatch_liquids: 'TrueBatch Oral Liquids', recruitment: 'Recruitment', lims: 'LIMS' };

/**
 * Pulled through a link (with what was read, PL-07), or typed by hand while the link was absent or down. Round 43: or
 * typed by hand because the step has no LIMS lab request of its own (state 'no_request': an in-process field of a step
 * started before round 42, when steps opened no request); it is checked and listed exactly as a link down.
 */
export type Source = { from: 'hand'; link: Provider; state: 'absent' | 'down' | 'no_request' } | { from: Provider; asOf: string | null; shown: string;
  // Round 43: a LIMS in-process pick: the result picked and the lab request it was sampled for (lab_request_v1 counts
  // the request as done; another round of the step may not pick the same result).
  ref?: string; request?: string };
export const isHand = (s: Source | undefined): s is Extract<Source, { from: 'hand' }> => s?.from === 'hand';
/** Why a value was typed by hand, in words: "LIMS link down", "LIMS not linked", "started before LIMS in-process requests". */
export const handWhy = (s: Pick<Extract<Source, { from: 'hand' }>, 'link' | 'state'>, down = 'link down') =>
  s.state === 'no_request' ? 'started before LIMS in-process requests' : `${PROVIDER_NAME[s.link]} ${s.state === 'down' ? down : 'not linked'}`;

/** The link that gives a field kind's value. */
export const LINK_OF: Partial<Record<BlockField['kind'], Provider>> = { lot: 'mms', machine: 'logbook', room: 'logbook', bulk: 'truebatch_liquids' };
/** Certificate values that come with an MMS lot. */
export const CERTIFICATE: Record<string, string> = { assay: 'assay', water: 'water', lod: 'lod', content: 'content' };

const yes = (name: string, label: string): BlockField => ({ name, label, kind: 'yes-no' });
// The questions people answer from the status labels or the lot label when the link does not give the value.
const QUESTIONS: Partial<Record<BlockField['kind'], (f: BlockField) => BlockField[]>> = {
  machine: (f) => [
    yes(`${f.name}.clean`, `${f.label}: the status label says clean, within its clean hold`),
    yes(`${f.name}.calibrated`, `${f.label}: the calibration label is in date`),
    yes(`${f.name}.inService`, `${f.label}: not tagged out of service, maintenance in date`),
    yes(`${f.name}.qualified`, `${f.label}: qualified (label in date)`),
  ],
  room: (f) => [
    yes(`${f.name}.clean`, `${f.label}: the status label says clean, within its clean hold`),
    yes(`${f.name}.inService`, `${f.label}: not tagged out of service`),
    yes(`${f.name}.qualified`, `${f.label}: qualified (label in date)`),
  ],
  lot: (f) => [
    yes(`${f.name}.released`, `${f.label}: the label says RELEASED (approved by QC)`),
    { name: `${f.name}.expiry`, label: `${f.label}: expiry or retest date on the label, whichever is first`, kind: 'text', date: true },
    { name: `${f.name}.report`, label: `${f.label}: QC report or certificate number of the values typed`, kind: 'text', optional: true },
  ],
  bulk: (f) => [
    yes(`${f.name}.released`, `${f.label}: the bulk container labels say RELEASED (QA) for this batch number`),
    yes(`${f.name}.product`, `${f.label}: the labels name the bulk product of this pack`),
  ],
};

/** The questions a hand-entered machine, room or lot adds to the step. */
export function handFields(fields: readonly BlockField[], source: Record<string, Source>): BlockField[] {
  return fields.filter((f) => isHand(source[f.name])).flatMap((f) => QUESTIONS[f.kind]?.(f) ?? []);
}
/** What people saw for a recorded name: a field's label, or a label question's ("machine.clean"), whatever the link is now. */
export function fieldLabel(fields: readonly BlockField[], name: string): string {
  const f = fields.find((x) => x.name === name) ?? fields.find((x) => name.startsWith(`${x.name}.`));
  if (!f) return name;
  return f.name === name ? f.label : QUESTIONS[f.kind]?.(f).find((q) => q.name === name)?.label ?? name;
}
/** A step with a value entered by hand needs a second-person check, whatever the master says. */
export const handEntered = (source: Record<string, Source>) => Object.values(source).some(isHand);

/**
 * Sentences of another product (a Logbook blocker: "Dirty: clean and verify before the next use.") put into one of
 * ours: each without its own closing stop, joined by "; ". The sentence that wraps them ends with one full stop.
 */
export const clauses = (parts: readonly string[]) => parts.map((p) => p.trim().replace(/[\s.;]+$/, '')).filter(Boolean).join('; ');
