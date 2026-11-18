/**
 * The batch's own status and what QA reviews, computed from the step events and the batch events (production
 * approval, QC approval, release or rejection, QA closing a deviation note). Nothing is stored but the events.
 */
import type { Permission } from '../../server/auth.js';
import { findBlock } from '../blocks/index.js';
import type { MasterDoc } from '../master/schema.js';
import { openSteps, outOfLimits, stepLabel, timers, type StepView, type Timer } from './batch.js';
import { keyId, parseKey, type State, type StepEvent } from './state.js';
import { failed } from './values.js';
import { isHand, PROVIDER_NAME, type LinkState, type Source } from './links.js';
import type { Returned } from './stock.js';
import { trainingTyped } from './training.js';

export const BATCH_EVENT_KINDS = ['production_approved', 'qc_approved', 'released', 'rejected', 'deviation_closed'] as const;
export type BatchEventKind = (typeof BATCH_EVENT_KINDS)[number];
// A batch QA terminated (stopped, not finished) is a rejection with `terminated` (owner, 16 Nov 2026): the record is kept.
// `returns`: what went back to stores unused of each lot the batch used (stock.ts returnsOf).
export interface BatchEvent { id: number; kind: BatchEventKind; payload: { reportNo?: string; note?: number; reason?: string; terminated?: boolean; returns?: Returned[]; bulk?: BulkChecked }; person: number; at: Date }

export const BATCH_STATUSES = ['in production', 'manufacturing complete', 'production approved', 'QC approved', 'released', 'rejected'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export type BatchAction = 'production-approve' | 'qc-approve' | 'release' | 'reject' | 'terminate' | 'close-deviation';
export const BATCH_ACTIONS: Record<BatchAction, { event: BatchEventKind; permission: Permission; from?: BatchStatus; meaning?: 'production_approved' | 'qc_approved' | 'released' | 'rejected' }> = {
  'production-approve': { event: 'production_approved', permission: 'truebatch.batch.supervise', from: 'manufacturing complete', meaning: 'production_approved' },
  'qc-approve': { event: 'qc_approved', permission: 'truebatch.qc.approve', from: 'production approved', meaning: 'qc_approved' },
  release: { event: 'released', permission: 'truebatch.qa.release', from: 'QC approved', meaning: 'released' },
  reject: { event: 'rejected', permission: 'truebatch.qa.release', from: 'QC approved', meaning: 'rejected' },
  // QA stops a batch still in production that cannot be finished, with a reason (TB-21 rows in test/release.test.ts).
  terminate: { event: 'rejected', permission: 'truebatch.qa.release', meaning: 'rejected' },
  'close-deviation': { event: 'deviation_closed', permission: 'truebatch.qa.release' },
};

/** "Terminated by … at …: reason", with what went back to stores unused of each lot the batch used (screens and PDF). */
export function terminatedText<T extends string | Date>(t: { personName: string; at: T; payload: { reason?: string; returns?: Returned[] } }, clock: (at: T) => string): string {
  const back = t.payload.returns ?? [];
  return `Terminated by ${t.personName} at ${clock(t.at)}: ${t.payload.reason ?? ''}${back.length
    ? ` · Back to stores unused: ${back.map((r) => `lot ${r.lot}${r.material ? ` (${r.material})` : ''} ${r.value} ${r.unit}`).join(', ')}; the rest counts as used` : ''}`;
}

/**
 * A note with a reference is a linked deviation. While the Deviations link answers, its status is Deviations' (TB-21):
 * open until closed (or rejected) there. Otherwise it is open until QA closes it by hand with a reason.
 * The number comes back too (owner, 17 Nov 2026): a note written without a number that Deviations filed a deviation
 * from (its deviation_v1.source_ref names the note, deviation_note_v1) is that deviation, read live while the link
 * answers (`filed`). `typed`: the number was typed by hand while the link was off or down.
 */
export interface Deviation { note: number; step: string; reference: string; text: string; open: boolean; by: number | null; closed?: BatchEvent; status?: string; closedAt?: string | null; where?: string;
  filed?: boolean; typed?: boolean }
/** A deviation as read from the Deviations system now (server/links.ts); `number` for one found by the note it was filed from. */
export interface DeviationStatus { status: string; closedAt: string | null; number?: string }
/** The key, in the deviations read, of the deviation filed from a note (its number is not in the note). */
export const filedKey = (note: number) => `note:${note}`;
export const DEVIATION_DONE = ['closed', 'rejected'];
const DEVIATION_WORDS: Record<string, string> = { classification: 'waiting for classification', investigation: 'under investigation', capa: 'waiting for its CAPA', closure: 'waiting for closure' };
/** A status of the Deviations system in plain words (its workflow step names are not shown as keys). */
export const deviationStatusWords = (s: string) => DEVIATION_WORDS[s] ?? s.replaceAll('_', ' ');
export function deviations(events: readonly StepEvent[], batchEvents: readonly BatchEvent[], read?: ReadonlyMap<string, DeviationStatus> | null): Deviation[] {
  return events.filter((e) => e.kind === 'note').flatMap((e) => {
    const filed = e.payload.reference ? undefined : read?.get(filedKey(e.id));
    const reference = e.payload.reference ?? filed?.number;
    if (!reference) return [];
    const closed = batchEvents.find((b) => b.kind === 'deviation_closed' && b.payload.note === e.id);
    const r = filed ?? read?.get(reference);
    const base = { note: e.id, step: keyId(e), reference, text: e.payload.text ?? '', by: e.person, ...(closed ? { closed } : {}),
      ...(filed ? { filed: true } : {}), ...(isHand(e.payload.source?.reference) ? { typed: true } : {}) };
    return [r ? { ...base, open: !DEVIATION_DONE.includes(r.status), status: r.status, closedAt: r.closedAt } : { ...base, open: !closed }];
  });
}
/**
 * A deviation's number and status in words, as the step, the release review and the PDF show it:
 * "DEV-26-0001 · under investigation (Deviations)", "DEV-7 (typed by hand) · open", "… · closed by QA".
 */
export function deviationText(d: Pick<Deviation, 'reference' | 'open' | 'status' | 'filed' | 'typed'>): string {
  const status = d.status !== undefined ? `${deviationStatusWords(d.status)} (Deviations)` : d.open ? 'open' : 'closed by QA';
  return `${deviationNumber(d)} · ${status}`;
}
/** The number, and where it came from when it was not picked from Deviations: typed by hand, or filed there from the note. */
export const deviationNumber = (d: Pick<Deviation, 'reference' | 'filed' | 'typed'>) =>
  `${d.reference}${d.typed ? ' (typed by hand)' : ''}${d.filed ? ' (filed in Deviations from this note)' : ''}`;

/**
 * Packing (whole-suite run, S24): the deviations of the bulk batch packed that are still open, read for QA's review
 * through two links: TrueBatch Tablets' deviation notes of the bulk batch (deviation_note_v1) and, for their numbers
 * and status, the Deviations system (with the deviations that name the bulk batch there). `state` is the first link
 * that did not answer (`link`); then nothing was checked and QA confirms by hand at release, typed.
 */
export interface BulkDeviation { number: string; status: string; title: string | null; step: string | null }
export interface BulkDeviations { bulk: string; state: LinkState; link?: 'truebatch' | 'deviations'; open: BulkDeviation[] }
/** What release recorded of the bulk batch's deviations: checked through the links, or QA's typed confirmation. */
export type BulkChecked = { bulk: string; state: LinkState; link?: 'truebatch' | 'deviations'; typed?: string };
export const bulkOpenText = (bulk: string, d: BulkDeviation) =>
  `Deviation ${d.number} of the bulk batch ${bulk}${d.step ? ` (${d.step})` : ''} is still open in the Deviations system (${deviationStatusWords(d.status)}): it is closed there first`;
export const bulkNotCheckedText = (b: { bulk: string; state: LinkState; link?: 'truebatch' | 'deviations' }) =>
  `Bulk deviations not checked (${PROVIDER_NAME[b.link ?? 'deviations']} link ${b.state === 'down' ? 'down' : 'off'}): bulk batch ${b.bulk}`;
/** The release line of the bulk batch's deviations, on screen and in the PDF. */
export const bulkCheckedText = (c: BulkChecked) => (c.typed !== undefined
  ? `${bulkNotCheckedText(c)}; QA confirmed by hand (typed): ${c.typed}`
  : `Bulk batch ${c.bulk}: no deviation open in the Deviations system`);
/** Why QA may not release the packing batch for its bulk batch's deviations: one still open, or not checked and not confirmed. */
export function bulkRefusal(b: BulkDeviations | null, typed?: string): string[] {
  if (!b) return [];
  if (b.state !== 'ok') return typed?.trim() ? [] : [`${bulkNotCheckedText(b)}. Check them in the Deviations system and type what you found.`];
  return b.open.map((d) => bulkOpenText(b.bulk, d));
}

/** Every timer that ran over, with the deviation notes made after it (a hold: in the using stage; a check: on it). */
export function lateItems(doc: MasterDoc, events: readonly StepEvent[], now: Date): { timer: Timer; notes: StepEvent[] }[] {
  return timers(doc, events, now).filter((t) => t.state === 'late').map((timer) => ({
    timer,
    notes: events.filter((e) => e.kind === 'note' && e.at > timer.at && e.stage === timer.key.stage && (timer.kind === 'hold' || keyId(e) === keyId(timer.key))),
  }));
}

const FINISHED = ['done', 'checked', 'not_applicable'];
const STATE_WORDS: Record<State, string> = { waiting: 'is not started', open: 'is not started', in_progress: 'is in progress', done_awaiting_check: 'is waiting for its check', done: 'is done', checked: 'is checked', not_applicable: 'is not applicable' };
const isYield = (doc: MasterDoc, v: StepView) => findBlock(doc.stages[v.key.stage]!.steps[v.key.step]!.block)?.gmp === 'yield';

// QC approves before QA releases, for a packing record too (owner, 15 Nov 2026: "QC signs first").
// packing: a packing batch (its status reads in words as one: "packing complete", statusWords).
export interface BatchView { status: BatchStatus; open: string[]; late: string[]; deviations: Deviation[]; yieldOut: string[]; packing: boolean }

/** The batch status, and what stands in the way of the next signature; `read`: the deviations as Deviations has them now. */
export function batchView(doc: MasterDoc, events: readonly StepEvent[], batchEvents: readonly BatchEvent[], now: Date, read?: ReadonlyMap<string, DeviationStatus> | null): BatchView {
  const { stages, steps } = openSteps(doc, events, now);
  const open = [
    ...steps.filter((s) => !FINISHED.includes(s.state)).map((s) => `${stepLabel(doc, s.key)} ${s.needsResign ? 'needs signing again' : STATE_WORDS[s.state]}`),
    ...stages.filter((s) => !s.closed).map((s) => `Stage ${s.name} is not closed`),
  ];
  const late = lateItems(doc, events, now).filter((l) => !l.notes.length).map((l) => `${l.timer.label} ran over: a deviation note is needed`);
  const devs = deviations(events, batchEvents, read).map((d) => ({ ...d, where: stepLabel(doc, parseKey(d.step)!) }));
  const yieldOut = steps.filter((s) => isYield(doc, s) && Object.values(s.results).some(failed) && !devs.some((d) => d.step === s.id))
    .map((s) => `The yield of ${stepLabel(doc, s.key)} is out of limits: a deviation note with its reference is needed`);
  const has = (k: BatchEventKind) => batchEvents.some((e) => e.kind === k);
  const status: BatchStatus = has('released') ? 'released' : has('rejected') ? 'rejected' : has('qc_approved') ? 'QC approved'
    : has('production_approved') ? 'production approved' : open.length ? 'in production' : 'manufacturing complete';
  return { status, open, late, deviations: devs, yieldOut, packing: !!doc.pack };
}

/**
 * A batch status in words for people (the key stays as it is in the API and the published views): a packing batch
 * whose steps are all done is "packing complete"; `capital`: the first letter in capitals, as a chip or a heading.
 */
export function statusWords(status: string, packing: boolean, capital = false): string {
  const w = packing && status === 'manufacturing complete' ? 'packing complete' : status;
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

/** Why the person may not do the batch action now; null when they may. */
export function batchRefusal(action: BatchAction, v: BatchView, user: { id?: number; permissions: readonly string[] }, note?: number): { status: 403 | 409; error: string; problems: string[] } | null {
  const rule = BATCH_ACTIONS[action];
  if (!user.permissions.includes(rule.permission)) return { status: 403, error: 'forbidden', problems: ['You do not have the permission for this action.'] };
  const no = (...problems: string[]) => (problems.length ? { status: 409 as const, error: 'not_ready', problems } : null);
  const words = statusWords(v.status, v.packing);
  if (action === 'close-deviation' || action === 'terminate') {
    if (v.status === 'released' || v.status === 'rejected') return no(`The batch is ${words}.`);
    // Still in production: production has not signed the record. After that, QC and QA decide at release.
    if (action === 'terminate') return ['in production', 'manufacturing complete'].includes(v.status) ? null : no(`Not possible while the batch is ${words}: QA decides at release.`);
    const d = v.deviations.find((x) => x.note === note && x.open);
    if (!d) return no('There is no open deviation note with this number.');
    if (d.status !== undefined) return no(`The status of ${d.reference} comes from the Deviations system (now ${deviationStatusWords(d.status)}): it is closed there.`);
    // By hand: a second person, who checked the closure in the deviation system or its paper record.
    if (d.by === user.id) return { status: 403, error: 'own_work', problems: ['You typed this deviation number: another QA person closes it.'] };
    return null;
  }
  // TB-20: the record is complete before production signs.
  if (action === 'production-approve' && v.status === 'in production') return no(...v.open);
  if (v.status !== rule.from) return no(`Not possible while the batch is ${words}.`);
  if (action === 'production-approve') return no(...v.late);
  if (action === 'qc-approve') return null;
  // TB-21: release or rejection only with every linked deviation closed; TB-18: a yield out of limits blocks release.
  const open = v.deviations.filter((d) => d.open).map((d) => `Deviation ${d.reference} (${d.where ?? `step ${d.step}`}) is ${d.status ? `still open in the Deviations system (${deviationStatusWords(d.status)}): it is closed there first` : 'open'}`);
  return no(...open, ...(action === 'release' ? v.yieldOut : []));
}

/** What QA reviews before release (TB-21): every change, departure and finding of the batch. Signatures are the server's. */
export function review(doc: MasterDoc, events: readonly StepEvent[], batchEvents: readonly BatchEvent[], now: Date, read?: ReadonlyMap<string, DeviationStatus> | null) {
  const { steps } = openSteps(doc, events, now);
  const notes = (s: StepView) => s.events.filter((e) => e.kind === 'note');
  return {
    corrections: steps.flatMap((s) => s.replaced.map((r) => ({ step: s.id, ...r }))),
    sentBack: events.filter((e) => e.kind === 'sent_back'),
    late: lateItems(doc, events, now),
    outOfLimits: steps.flatMap((s) => outOfLimits(s).map(([calc, r]) => ({ step: s.id, calc, shown: r.ok ? r.shown : '', notes: notes(s) }))),
    inputChanged: steps.filter((s) => s.inputChanged.length).map((s) => ({ step: s.id, changes: s.inputChanged })),
    deviations: deviations(events, batchEvents, read),
    // Every value typed by hand because a link was absent or down (owner 15 Nov 2026), and who typed it.
    hand: events.flatMap((e) => Object.entries(e.payload.source ?? {}).filter(([, x]) => isHand(x))
      .map(([field, x]) => ({ step: keyId(e), event: e.id, kind: e.kind, field, ...(x as Extract<Source, { from: 'hand' }>), person: e.person, at: e.at }))),
    notApplicable: events.filter((e) => e.kind === 'not_applicable'),
    // Every signature whose training was typed by hand because Recruitment was not reachable (owner, 17 Nov 2026).
    trainingTyped: trainingTyped(events),
    // Demo installations only: every wait ended at once by a person (server/demo.ts).
    demoSkips: events.filter((e) => e.kind === 'demo_wait_skipped'),
    batchEvents,
  };
}
