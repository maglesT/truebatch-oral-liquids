/**
 * Only trained people sign (owner, 17 Nov 2026). A master step may name the training it needs: a skill Recruitment
 * publishes (report.training_v1), picked in the designer. When a person signs such a step (performed or checked), the
 * server reads their training in that skill from Recruitment now: qualified, the signature records it (pulled); not
 * qualified, expired or missing, the signature is refused. While the Recruitment link is off or down the signer ticks
 * "I am trained in …" and the signature is marked as training typed by hand, listed for QA (release review and PDF).
 */
import { plantDate } from '../plant-time.js';
import { keyId, type StepEvent } from './state.js';

/** A skill as Recruitment names it: its code (e.g. an SOP number) and its title. */
export interface Skill { code: string; title?: string }
/** The training recorded with a signature: read from Recruitment, or ticked by the signer while Recruitment was not reachable. */
export type Training =
  | { code: string; title?: string; from: 'recruitment'; trainedOn: string | null; validUntil: string | null; asOf: string | null }
  | { code: string; title?: string; from: 'hand'; state: 'absent' | 'down' };
/** One person's training in one skill, as Recruitment has it now (training_v1); `qualified` is already false when expired. */
export interface TrainingRead { code: string; title: string | null; qualified: boolean; trainedOn: string | null; validUntil: string | null; dataAsOf: string | null }

export const skillText = (s: Skill) => (s.title?.trim() ? `${s.code} ${s.title.trim()}` : s.code);
/** The master's step in plain words. */
export const neededText = (s: Skill, checker: boolean) => `Done by a person trained in ${skillText(s)}${checker ? '; checked by a person trained in it too' : ''} (Recruitment).`;
export const notTrainedText = (name: string, s: Skill) => `${name} has no valid training in ${skillText(s)} (Recruitment): ask QA, or another trained person signs.`;
export const tickText = (s: Skill) => `I am trained in ${skillText(s)}`;
export const TYPED_BY_HAND = 'training typed by hand (Recruitment not reachable)';
/** What the signature records, as the step, the review and the PDF show it. */
export const trainingText = (t: Training) => (t.from === 'hand' ? `${TYPED_BY_HAND}: ${skillText(t)}`
  : `trained: ${skillText(t)}${t.validUntil ? `, valid until ${plantDate(t.validUntil)}` : ''} (Recruitment)`);

export type TrainingAnswer = { ok: true; training: Training } | { ok: false; error: 'not_trained' | 'training_tick'; message: string };
/**
 * The sign check. `read`: the signer's training in the skill as Recruitment answers now (null: no row); absent or down
 * when it does not answer. `ticked`: the signer ticked "I am trained in …" (used only while Recruitment does not answer).
 */
export function trainingCheck(skill: Skill, name: string, read: { state: 'ok'; value: TrainingRead | null } | { state: 'absent' | 'down' }, ticked: boolean): TrainingAnswer {
  if (read.state !== 'ok') {
    if (!ticked) return { ok: false, error: 'training_tick', message: `Recruitment cannot be reached: tick “${tickText(skill)}” to sign, or another trained person signs.` };
    return { ok: true, training: { code: skill.code, ...(skill.title ? { title: skill.title } : {}), from: 'hand', state: read.state } };
  }
  const r = read.value;
  if (!r?.qualified) return { ok: false, error: 'not_trained', message: notTrainedText(name, { code: skill.code, title: r?.title ?? skill.title }) };
  const title = r.title ?? skill.title;
  return { ok: true, training: { code: skill.code, ...(title ? { title } : {}), from: 'recruitment', trainedOn: r.trainedOn, validUntil: r.validUntil, asOf: r.dataAsOf } };
}

/** The training a signing event recorded, if any. */
export const trainingOf = (e: Pick<StepEvent, 'payload'>): Training | undefined => {
  const t = e.payload.training as Training | undefined;
  return t && typeof t === 'object' && typeof t.code === 'string' ? t : undefined;
};
/** Every signature whose training was typed by hand (Recruitment off or down), for QA. */
export const trainingTyped = (events: readonly StepEvent[]) => events.flatMap((e) => {
  const t = trainingOf(e);
  return t?.from === 'hand' ? [{ step: keyId(e), event: e.id, kind: e.kind, code: t.code, title: t.title, state: t.state, person: e.person, at: e.at }] : [];
});
