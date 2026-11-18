/**
 * What is open in a batch, and its timers, computed from the master version and the step events. Nothing is stored:
 * the event log is the single source of truth.
 */
import { findBlock, type Block } from '../blocks/index.js';
import { materialLines, type MasterDoc, type Step } from '../master/schema.js';
import { keyId, stepState, type EventKind, type State, type StepEvent, type StepKey } from './state.js';
import { c1WithinLimits, convert, Dec, findUnit } from '../templates/index.js';
import { currentValues, durationId, durations, evaluate, failed, headerValue, inputChanges, type Current } from './values.js';
import { CERTIFICATE, fieldLabel, handEntered, handFields } from './links.js';

export interface StepView extends Current {
  key: StepKey;
  id: string;
  stageKey: string;
  stepKey: string;
  state: State;
  needsResign: boolean;
  // Why a waiting step is not open yet.
  blocked?: string;
  events: StepEvent[];
  // The changes to inputs from other steps since the results were worked out: the results shown are worked out
  // again (not stored), and the step must be signed again (and checked again).
  inputChanged: StepEvent[];
  // F4 by rule: the master's rule left this step out (it is not applicable without an operator's choice).
  leftOut?: string;
  // The stop check of a repeat-until round that may still be repeated has not passed: "not yet", not out of limits.
  notYet?: string;
}

/**
 * A step as people name it: the master's name for it, or the block's name and the formula line or the thing checked.
 * A packing material step names its material first ("Issue Printed aluminium foil (PM-101)"), so the issue steps of
 * the pack's materials never look alike.
 */
export function stepTitle(doc: MasterDoc, st: Step): string {
  if (st.name) return st.name;
  const block = findBlock(st.block);
  const line = Object.values(st.settings).find((v): v is { formula: string } => typeof v === 'object' && 'formula' in v);
  const m = line && materialLines(doc).find((l) => l.key === line.formula);
  if (m && block?.title) return block.title.replace('{material}', `${m.name} (${m.code})`);
  const what = line ? m?.name : typeof st.settings.what === 'string' ? st.settings.what : undefined;
  // A pack without a leaflet has its cartons checked, not a leaflet (owner, 17 Nov 2026).
  if (block?.id === 'carton-check' && doc.pack && !doc.pack.materials.some((x) => x.kind === 'leaflet')) return 'Carton check';
  return [block?.name ?? st.key, what].filter(Boolean).join(': ');
}
/** The fields a step asks for: a pack without a leaflet is not asked about a leaflet. */
export function askedFields(doc: MasterDoc, block: Block): Block['fields'] {
  const noLeaflet = block.id === 'carton-check' && doc.pack && !doc.pack.materials.some((x) => x.kind === 'leaflet');
  return noLeaflet ? block.fields.filter((f) => f.name !== 'leaflet') : block.fields;
}
/** Where a step instance is, in words: "Granulation › Dry to an LOD limit (round 2)". */
export function stepLabel(doc: MasterDoc, k: StepKey): string {
  const s = doc.stages[k.stage];
  const st = s?.steps[k.step];
  if (!s || !st) return `step ${keyId(k)}`;
  const extra = [s.kind === 'sub-batch' ? `sub-batch ${k.sub}` : '', st.flow.kind === 'repeat-until' ? `round ${k.round}` : ''].filter(Boolean).join(', ');
  return `${s.name} › ${stepTitle(doc, st)}${extra ? ` (${extra})` : ''}`;
}

/**
 * A step as the other products read it (equipment_use_v1.step_name, material_use_v1.step_name): "Granulation ›
 * Granulate to an end point", with the sub-batch, without the round. Kept with the step's "started" event.
 */
export function stepPlace(doc: MasterDoc, k: StepKey): string {
  const s = doc.stages[k.stage];
  const st = s?.steps[k.step];
  return s && st ? `${s.name} › ${stepTitle(doc, st)}${s.kind === 'sub-batch' ? ` (sub-batch ${k.sub})` : ''}` : `step ${keyId(k)}`;
}

/** F4 by a rule of the master on a header value (e.g. the bag premix only for a batch of at most 50 kg); null when the step is in. */
export function leftOutBy(doc: MasterDoc, st: Step): string | null {
  if (!st.onlyIf) return null;
  const h = headerValue(doc, st.onlyIf.header);
  const value = typeof h === 'string' ? h : h.ok ? { value: h.value, unit: h.unit } : undefined;
  const r = value === undefined ? undefined : c1WithinLimits({ value, limit: st.onlyIf.limit });
  return r?.ok && r.check?.pass ? null : `Left out by the master's rule: only when the ${st.onlyIf.header === 'batchSize' ? 'batch size' : 'core batch weight'} is ${r?.ok ? r.check?.shown ?? '' : 'within its limit'}`;
}
export interface StageView { index: number; key: string; name: string; open: boolean; blocked?: string; closed: boolean }
export interface Timer {
  id: string;
  kind: 'hold' | 'periodic' | 'minimum' | 'duration';
  // The step it applies to (where the timer job records "late").
  key: StepKey;
  label: string;
  from: Date;
  at: Date;
  state: 'running' | 'due soon' | 'due' | 'late';
  // Demo installations only (server/demo.ts): the wait was ended at once by this person; `at` is then the skip.
  skipped?: { person: number | null; at: Date };
}

const MINUTE = 60_000;
// As in the Logbook: due soon once 85 % of the allowed time has passed.
const DUE_SOON = 0.85;
const phase = (from: Date, at: Date, now: Date): Timer['state'] =>
  now > at ? 'late' : now.getTime() - from.getTime() >= (at.getTime() - from.getTime()) * DUE_SOON ? 'due soon' : 'running';
const earliest = (events: readonly StepEvent[], kind: EventKind) =>
  events.filter((e) => e.kind === kind).map((e) => e.at).sort((a, b) => a.getTime() - b.getTime())[0];
const latest = (events: readonly StepEvent[], kinds: EventKind[]) => events.filter((e) => kinds.includes(e.kind)).at(-1)?.at;
const noteAfter = (events: readonly StepEvent[], t: Date | undefined) => events.some((e) => e.kind === 'note' && (!t || e.at > t));
const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * MINUTE);
// Demo only: a 'demo_wait_skipped' event satisfies its timer's wait: the timer is due from the skip and never late.
const skipOf = (events: readonly StepEvent[], id: string) => events.find((e) => e.kind === 'demo_wait_skipped' && e.payload.timer === id);
const skipped = (e: StepEvent | undefined) => (e ? { skipped: { person: e.person, at: e.at } } : {});
/** Demo only: a wait that can be skipped now (running and not skipped yet). */
export const skippable = (t: { state: Timer['state']; skipped?: unknown }) => !t.skipped && (t.state === 'running' || t.state === 'due soon');
/** Demo only: the step a skip is recorded on: the step that waits (a periodic check: the round that started it). */
export const skipKey = (t: Pick<Timer, 'kind' | 'key'>): StepKey => (t.kind === 'periodic' ? { ...t.key, round: t.key.round - 1 } : t.key);

const stopName = (st: Step) => (st.flow.kind === 'repeat-until' ? st.flow.stop ?? findBlock(st.block)?.stop : undefined);
const maxRounds = (st: Step) => (st.flow.kind === 'repeat-until' ? st.flow.maxRounds ?? 1 : 1);
const notYetOf = (st: Step, round: number, results: Current['results']) => {
  const stop = stopName(st);
  return stop && round < maxRounds(st) && failed(results[stop]) ? stop : undefined;
};
/** The results out of limits: a real limit failure, never a round that is "not yet" (TB-14). */
export const outOfLimits = (v: StepView) => Object.entries(v.results).filter(([n, r]) => n !== v.notYet && failed(r));
/** A "not yet" worked line in plain words: the stop check is not reached yet and the rounds go on (a terminated batch: they do not). */
export const notYetText = (shown: string, terminated = false) => shown.replace(/:\s*OUT OF LIMITS(?: \([^)]*\))?/g, terminated ? ': not reached (terminated)' : ': not reached yet, the rounds go on')
  .replace(/:\s*FAIL\b/g, terminated ? ': not reached (terminated)' : ': not yet, the rounds go on');
/** A round of a terminated batch whose stop check is "not reached (terminated)": only the last round of its step. An earlier round was followed by another: its rounds went on. */
// A later round counts only if it was started: a next round that never started (waiting or open) does not mean the rounds went on.
export const cutShort = (terminated: unknown, v: { key: StepKey }, all: readonly { key: StepKey; state?: string }[]) =>
  !!terminated && !all.some((o) => o.key.stage === v.key.stage && o.key.sub === v.key.sub && o.key.step === v.key.step && o.key.round > v.key.round
    && o.state !== 'waiting' && o.state !== 'open');
/** A step a terminated batch left unfinished, in words that never say it is still to come (PDF and screens; owner 16 Nov 2026). */
export const TERMINATED_STATE: Partial<Record<State, string>> = {
  waiting: 'terminated, not started', open: 'terminated, not started', in_progress: 'terminated, not finished', done_awaiting_check: 'terminated, not checked',
};
function stopPassed(v: StepView, st: Step): boolean {
  const r = v.results[stopName(st) ?? ''];
  return r?.ok === true && r.check?.pass === true;
}
// Done enough for what follows: with `wait`, a step that needs a check must be checked.
const finished = (v: StepView, wait: boolean) =>
  v.state === 'done' || v.state === 'checked' || v.state === 'not_applicable' || (v.state === 'done_awaiting_check' && !wait);

/** Why what comes after a step (its last round) cannot open yet; null when it can. */
function after(doc: MasterDoc, st: Step, last: StepView, wait: boolean): string | null {
  const label = `“${stepTitle(doc, st)}”`;
  if (!finished(last, wait)) return `Waits for ${label}${last.state === 'done_awaiting_check' ? ' to be checked' : ''}`;
  if (last.state === 'not_applicable') return null;
  if (st.flow.kind === 'qa-hold' && !last.events.some((e) => e.kind === 'qa_released_hold')) return `Waits for QA to release the hold on ${label}`;
  if (st.flow.kind === 'repeat-until' && !stopPassed(last, st) && !noteAfter(last.events, latest(last.events, ['done']))) {
    return `${label}: the stop check did not pass in ${last.key.round} round(s), the most allowed: a deviation note is needed`;
  }
  return null;
}

/** Hold times: from the producing stage's last step done (the earliest copy) to the start of the stage that uses it. */
export function holdTimers(doc: MasterDoc, events: readonly StepEvent[], now: Date): Timer[] {
  const out: Timer[] = [];
  doc.stages.forEach((s, si) => {
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((p) => p.key === u);
      const p = doc.stages[pi];
      const hours = p?.produces?.holdHours;
      if (!p?.produces || !hours) continue;
      const from = earliest(events.filter((e) => e.stage === pi && e.step === p.steps.length - 1), 'done');
      if (!from) continue;
      const id = `hold:${pi}:${si}`;
      const skip = skipOf(events, id);
      const at = skip?.at ?? plus(from, hours * 60);
      const started = earliest(events.filter((e) => e.stage === si), 'started');
      const state = started ? (started > at && !skip ? 'late' : null) : skip ? 'due' : phase(from, at, now);
      if (state) out.push({ id, kind: 'hold', key: { stage: si, sub: 1, step: 0, round: 1 }, label: `Hold time of ${p.produces.name} (${hours} h) before ${s.name}`, from, at, state, ...skipped(skip) });
    }
  });
  return out;
}

/**
 * Every step instance with its state. The next step opens when the previous is done (or checked, when the master
 * says wait for the check); the next stage opens when the previous stage is closed. Preparation stages open any time
 * and must be closed before the stage that uses them. Repeat-until: rounds of the same step until its stop check
 * passes or the most rounds are reached. A sub-batch stage runs N numbered copies side by side.
 */
export function openSteps(doc: MasterDoc, events: readonly StepEvent[], now: Date): { stages: StageView[]; steps: StepView[] } {
  const byKey = new Map<string, StepEvent[]>();
  for (const e of [...events].sort((a, b) => a.id - b.id)) byKey.set(keyId(e), [...(byKey.get(keyId(e)) ?? []), e]);
  const holds = holdTimers(doc, events, now);
  const stages: StageView[] = [];
  const steps: StepView[] = [];
  doc.stages.forEach((s, si) => {
    const why: string[] = [];
    const prev = doc.stages.slice(0, si).map((x, i) => (x.kind === 'preparation' ? -1 : i)).filter((i) => i >= 0).at(-1);
    if (s.kind !== 'preparation' && prev !== undefined && !stages[prev]!.closed) why.push(`Waits for stage ${doc.stages[prev]!.name} to close`);
    for (const u of s.uses) {
      const pi = doc.stages.findIndex((p) => p.key === u);
      if (doc.stages[pi]?.kind === 'preparation' && !stages[pi]?.closed) why.push(`Waits for the preparation ${doc.stages[pi]!.name} to close`);
    }
    const mine = events.filter((e) => e.stage === si);
    for (const h of holds) {
      if (h.key.stage === si && h.state === 'late' && !earliest(mine, 'started') && !noteAfter(mine, h.at)) why.push(`${h.label} ran out: a deviation note is needed`);
    }
    let closed = true;
    for (let sub = 1; sub <= (s.kind === 'sub-batch' ? s.count ?? 1 : 1); sub++) {
      let gate: string | null = why[0] ?? null;
      s.steps.forEach((st, ti) => {
        let last: StepView;
        for (let round = 1; ; round++) {
          const key = { stage: si, sub, step: ti, round };
          const evs = byKey.get(keyId(key)) ?? [];
          const c = currentValues(evs);
          const inputChanged = inputChanges(events, c.uses);
          // A value entered by hand (a link absent or down) needs a second-person check (owner 15 Nov 2026).
          let { state, needsResign } = stepState(evs, st.checker || handEntered(c.source));
          const leftOut = leftOutBy(doc, st);
          if (leftOut) state = 'not_applicable';
          if (inputChanged.length) {
            c.results = evaluate(doc, events, key, c.values);
            if (state === 'done' || state === 'done_awaiting_check' || state === 'checked') [state, needsResign] = ['in_progress', true];
          }
          const notYet = notYetOf(st, round, c.results);
          last = { key, id: keyId(key), stageKey: s.key, stepKey: st.key, state: state === 'waiting' && gate === null ? 'open' : state, needsResign,
            ...(state === 'waiting' && gate !== null ? { blocked: gate } : {}), events: evs, ...c, inputChanged, ...(leftOut ? { leftOut } : {}), ...(notYet ? { notYet } : {}) };
          steps.push(last);
          // A round that has events is always shown (an earlier round may be back in progress after a correction).
          if (!byKey.has(keyId({ ...key, round: round + 1 })) && (st.flow.kind !== 'repeat-until' || !finished(last, st.waitForCheck) || stopPassed(last, st) || round >= maxRounds(st))) break;
          gate = null;
        }
        // A periodic check that runs alongside (packing): what follows opens once its first round is done.
        const first = findBlock(st.block)?.periodic?.alongside ? steps.find((x) => x.id === keyId({ stage: si, sub, step: ti, round: 1 })) : undefined;
        gate = first ? (finished(first, st.waitForCheck) ? null : `Waits for the first check of “${stepTitle(doc, st)}”`) : after(doc, st, last!, st.waitForCheck);
        if (after(doc, st, last!, true) !== null) closed = false;
      });
    }
    stages.push({ index: si, key: s.key, name: s.name, open: why.length === 0, ...(why[0] ? { blocked: why[0] } : {}), closed });
  });
  return { stages, steps };
}

/** Why the performer cannot sign the step as done now; empty when they can. */
export function doneProblems(doc: MasterDoc, v: StepView, now: Date): string[] {
  const st = doc.stages[v.key.stage]?.steps[v.key.step];
  const block = st && findBlock(st.block);
  if (!st || !block) return ['This step has no block'];
  const p: string[] = [];
  for (const f of [...block.fields, ...handFields(block.fields, v.source)]) if (!f.optional && v.values[f.name] === undefined) p.push(`${f.label} is not recorded`);
  for (const r of Object.values(v.results)) if (!r.ok) p.push(r.message);
  // A value of the lot (its label date, "released", a certificate value) recorded before the step's current lot is the
  // previous lot's: recorded again for this lot before the step is signed (a lot typed by hand after another lot).
  const setAt = (k: string) => v.events.filter((e) => (e.kind === 'value' || e.kind === 'corrected') && e.payload.values && k in e.payload.values).map((e) => e.id).at(-1);
  for (const lf of block.fields.filter((f) => f.kind === 'lot')) {
    // The event that set the current lot (the same lot picked again is not a new lot).
    let lotAt: number | undefined, prev: unknown;
    for (const e of v.events) if ((e.kind === 'value' || e.kind === 'corrected') && e.payload.values && lf.name in e.payload.values) {
      const lot = e.payload.values[lf.name];
      if (JSON.stringify(lot) !== JSON.stringify(prev)) lotAt = e.id;
      prev = lot;
    }
    if (lotAt === undefined) continue;
    for (const k of Object.keys(v.values).filter((x) => x.startsWith(`${lf.name}.`) || CERTIFICATE[x])) {
      const at = setAt(k);
      if (at !== undefined && at < lotAt) p.push(`${fieldLabel([...block.fields, ...handFields(block.fields, v.source)], k)} is the previous lot's: record it for lot ${String(v.values[lf.name])}`);
    }
  }
  const stop = stopName(st);
  const out = block.calcs.filter((c) => c.name !== stop && failed(v.results[c.name])).map((c) => c.label);
  // The note must come after the last value, or after the last change of an input from another step.
  const since = [...v.events.filter((e) => e.kind === 'value' || e.kind === 'corrected'), ...v.inputChanged].map((e) => e.at).sort((a, b) => a.getTime() - b.getTime()).at(-1);
  if (out.length && !noteAfter(v.events, since)) p.push(`Out of limits: ${out.join(', ')}. Add a deviation note first.`);
  const started = earliest(v.events, 'started');
  if (st.minMinutes && started && now < plus(started, st.minMinutes) && !skipOf(v.events, `min:${v.id}`)) {
    p.push(`The minimum time is ${st.minMinutes} min: the step can be finished from ${plus(started, st.minMinutes).toISOString()}`);
  }
  return p;
}

/** Hold times, periodic checks (every N minutes from the previous round's start), minimum times and mixing times. */
export function timers(doc: MasterDoc, events: readonly StepEvent[], now: Date): Timer[] {
  const out = holdTimers(doc, events, now);
  const { steps } = openSteps(doc, events, now);
  for (const v of steps) {
    const st = doc.stages[v.key.stage]!.steps[v.key.step]!;
    const started = earliest(v.events, 'started');
    if (!started) continue;
    if (st.minMinutes && v.state === 'in_progress' && !v.events.some((e) => e.kind === 'done')) {
      const skip = skipOf(v.events, `min:${v.id}`);
      const at = skip?.at ?? plus(started, st.minMinutes);
      out.push({ id: `min:${v.id}`, kind: 'minimum', key: v.key, label: `Minimum time of “${stepTitle(doc, st)}” (${st.minMinutes} min)`, from: started, at,
        state: skip || now >= at ? 'due' : 'running', ...skipped(skip) });
    }
    // A mixing time with a lower limit: from its recorded start until the lower limit is reached (or the end is recorded).
    for (const d of v.state === 'in_progress' ? durations(findBlock(st.block), st) : []) {
      const begun = v.values[d.start];
      const from = new Date(typeof begun === 'string' ? begun : NaN);
      const unit = findUnit(d.limit.unit);
      const ms = Number(d.limit.low) * (unit?.kind === 'time' ? convert(new Dec(1000), unit, findUnit('s')!).toNumber() : NaN);
      if (v.values[d.end] !== undefined || Number.isNaN(from.getTime() + ms)) continue;
      const id = durationId(v.key, d.calc);
      const skip = skipOf(v.events, id);
      const at = skip?.at ?? new Date(from.getTime() + ms);
      out.push({ id, kind: 'duration', key: v.key, label: `${d.label} of “${stepTitle(doc, st)}” (at least ${d.limit.low} ${d.limit.unit})`, from, at,
        state: skip || now >= at ? 'due' : phase(from, at, now), ...skipped(skip) });
    }
    if (st.everyMinutes) {
      const key = { ...v.key, round: v.key.round + 1 };
      const next = steps.find((x) => x.id === keyId(key));
      const nextStart = next && earliest(next.events, 'started');
      // F6 with a changing interval: after the set time from the first round's start, the later interval (F0030).
      const first = steps.find((x) => x.id === keyId({ ...v.key, round: 1 }));
      const firstStart = first && earliest(first.events, 'started');
      const later = st.everyMinutesLater && firstStart && started >= plus(firstStart, st.everyMinutesLater.afterMinutes);
      const every = later ? st.everyMinutesLater!.everyMinutes : st.everyMinutes;
      const id = `every:${keyId(key)}`;
      const skip = skipOf(v.events, id);
      const at = skip?.at ?? plus(started, every);
      const t = { id, kind: 'periodic' as const, key, label: `Check ${key.round} of “${stepTitle(doc, st)}” (every ${every} min)`, from: started, at, ...skipped(skip) };
      if (nextStart) { if (nextStart > at && !skip) out.push({ ...t, state: 'late' }); }
      else if (!stopPassed(v, st) && v.key.round < maxRounds(st)) out.push({ ...t, state: skip ? 'due' : phase(started, at, now) });
    }
  }
  return out;
}
