/**
 * The state of one step (one round of one copy) is computed from its events, as the Logbook computes status from its
 * entries: nothing is stored, the event log is the single source of truth.
 */
import type { Permission } from '../../server/auth.js';
import type { Stored, Value } from './values.js';
import type { Source } from './links.js';

export const EVENT_KINDS = ['started', 'value', 'done', 'checked', 'sent_back', 'corrected', 'not_applicable', 'late', 'qa_released_hold', 'note', 'demo_wait_skipped'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Stage and step are positions in the master (from 0); sub-batch and round are numbers people see (from 1). */
export interface StepKey { stage: number; sub: number; step: number; round: number }
export const keyId = (k: StepKey) => `${k.stage}.${k.sub}.${k.step}.${k.round}`;
export function parseKey(s: string): StepKey | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,4})$/.exec(s);
  if (!m) return null;
  const [stage, sub, step, round] = m.slice(1).map(Number) as [number, number, number, number];
  return sub < 1 || round < 1 ? null : { stage, sub, step, round };
}

export interface Payload {
  values?: Record<string, Value>;
  results?: Record<string, Stored>;
  reason?: string;
  text?: string;
  // A deviation note's reference (e.g. its Deviations number): it is then open until QA closes it.
  reference?: string;
  // The events of other steps the results were worked out from (values.ts, inputChanges).
  uses?: number[];
  // Where values (or the note's reference) came from: pulled through a link, or typed by hand (links.ts).
  source?: Record<string, Source>;
  timer?: string;
  [k: string]: unknown;
}
export interface StepEvent extends StepKey {
  id: number;
  kind: EventKind;
  payload: Payload;
  person: number | null;
  at: Date;
}

export type State = 'waiting' | 'open' | 'in_progress' | 'done_awaiting_check' | 'done' | 'checked' | 'not_applicable';

/**
 * The state from the step's own events. `needsCheck`: the master asks for a second-person check; without it a step
 * ends at "done". Without events the step is "waiting"; openSteps makes it "open" when its turn has come.
 * A correction after "done" takes the step back to in_progress and it needs signing again (needsResign).
 */
export function stepState(events: readonly StepEvent[], needsCheck: boolean): { state: State; needsResign: boolean } {
  let state: State = 'waiting';
  let needsResign = false;
  for (const e of events) {
    if (e.kind === 'started') state = 'in_progress';
    else if (e.kind === 'done') { state = needsCheck ? 'done_awaiting_check' : 'done'; needsResign = false; }
    else if (e.kind === 'checked') state = 'checked';
    else if (e.kind === 'sent_back') state = 'in_progress';
    else if (e.kind === 'corrected') { state = 'in_progress'; needsResign = true; }
    else if (e.kind === 'not_applicable') state = 'not_applicable';
  }
  return { state, needsResign };
}

export type Action = 'start' | 'record' | 'done' | 'check' | 'send-back' | 'correct' | 'not-applicable' | 'release-hold' | 'note';
export interface ActionRule {
  event: EventKind;
  from: readonly State[];
  permissions: readonly Permission[];
  // The signature meaning, for a signing action.
  meaning?: 'performed' | 'verified' | 'released';
  reason?: boolean;
  // TB-08: nobody who started, recorded, corrected or signed the step as performed may do this.
  notInvolved?: boolean;
}

const OPERATE: Permission[] = ['truebatch.batch.operate'];
const CHECK: Permission[] = ['truebatch.batch.check'];
const ALL: State[] = ['waiting', 'open', 'in_progress', 'done_awaiting_check', 'done', 'checked', 'not_applicable'];

/** Which action is allowed in which state, and by which permission. */
export const ACTIONS: Record<Action, ActionRule> = {
  start: { event: 'started', from: ['open'], permissions: OPERATE },
  // Values before the first "done"; afterwards a value changes only by correction with a reason.
  record: { event: 'value', from: ['in_progress'], permissions: OPERATE },
  done: { event: 'done', from: ['in_progress'], permissions: OPERATE, meaning: 'performed' },
  check: { event: 'checked', from: ['done_awaiting_check'], permissions: CHECK, meaning: 'verified', notInvolved: true },
  'send-back': { event: 'sent_back', from: ['done_awaiting_check'], permissions: CHECK, reason: true, notInvolved: true },
  correct: { event: 'corrected', from: ['in_progress', 'done_awaiting_check', 'done', 'checked'], permissions: OPERATE, reason: true },
  'not-applicable': { event: 'not_applicable', from: ['open', 'in_progress'], permissions: OPERATE, meaning: 'performed', reason: true },
  'release-hold': { event: 'qa_released_hold', from: ['done', 'checked'], permissions: ['truebatch.qa.release'], meaning: 'released' },
  // A deviation note; anyone working on the batch, in any state.
  note: { event: 'note', from: ALL, permissions: ['truebatch.batch.operate', 'truebatch.batch.check', 'truebatch.batch.supervise', 'truebatch.qa.release'] },
};

export interface Refused { status: 403 | 409; error: string; message: string }
export interface ActionContext {
  state: State;
  events: readonly StepEvent[];
  flow: 'none' | 'repeat-until' | 'optional-with-reason' | 'qa-hold';
  user: { id: number; permissions: readonly string[] };
}

const INVOLVING: EventKind[] = ['started', 'value', 'done', 'corrected', 'not_applicable'];
/** The people who did the step: none of them may check it (TB-08). */
export const involved = (events: readonly StepEvent[]) => new Set(events.filter((e) => INVOLVING.includes(e.kind)).map((e) => e.person));

/** Whether the person may do the action on the step now; null when allowed. */
export function refusal(action: Action, c: ActionContext): Refused | null {
  const rule = ACTIONS[action];
  if (!rule.permissions.some((p) => c.user.permissions.includes(p))) return { status: 403, error: 'forbidden', message: 'You do not have the permission for this action.' };
  const signed = c.events.some((e) => e.kind === 'done');
  const wrong = (message: string): Refused => ({ status: 409, error: 'wrong_state', message });
  if (!rule.from.includes(c.state)) return wrong(`Not possible while the step is ${c.state.replaceAll('_', ' ')}.`);
  if (action === 'record' && signed) return wrong('The step was signed: change a value by correction, with a reason.');
  if (action === 'correct' && !signed) return wrong('Nothing signed to correct yet: record the value.');
  if (action === 'not-applicable' && c.flow !== 'optional-with-reason') return wrong('Only an optional step can be marked not applicable.');
  if (action === 'release-hold' && (c.flow !== 'qa-hold' || c.events.some((e) => e.kind === 'qa_released_hold'))) return wrong('There is no QA hold to release on this step.');
  if (rule.notInvolved && involved(c.events).has(c.user.id)) return { status: 403, error: 'own_work', message: 'You cannot check a step you performed, recorded or corrected.' };
  return null;
}
