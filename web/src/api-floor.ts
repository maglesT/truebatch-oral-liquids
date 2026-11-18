// The floor screens' view of the batch API (server/routes/batches.ts): types, small helpers and plain words.
import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import type { Block, BlockField } from '../../shared/blocks/format.js';
import type { MasterDoc, Step } from '../../shared/master/schema.js';
import type { Action, EventKind, Payload, State, StepKey } from '../../shared/engine/state.js';
import type { Stored, Value } from '../../shared/engine/values.js';
import { unitName, type Returned } from '../../shared/engine/stock.js';
import { PROVIDER_NAME, type Source } from '../../shared/engine/links.js';
import { stepTitle as sharedStepTitle, TERMINATED_STATE } from '../../shared/engine/batch.js';
import { plantClock, plantText } from '../../shared/plant-time.js';
import { statusWords } from '../../shared/engine/release.js';
import { product } from './product.js';

export type { Block, BlockField, MasterDoc, Step, Action, State, StepKey, Stored, Value, Source };

export interface FloorEvent extends StepKey { id: number; kind: EventKind; payload: Payload; person: number | null; personName: string | null; at: string }
export interface StepRow {
  key: StepKey; id: string; stageKey: string; stepKey: string; state: State; needsResign: boolean; blocked?: string; notYet?: string;
  values: Record<string, Value>; results: Record<string, Stored>; inputChanged: FloorEvent[]; events: FloorEvent[];
  contentHash: string; actions: Action[]; problems: string[];
  // Where values came from (a link, or by hand) and the label questions of what was entered by hand.
  source: Record<string, Source>; handFields: BlockField[];
}
export interface TimerRow { id: string; kind: 'hold' | 'periodic' | 'minimum' | 'duration'; key: StepKey; label: string; from: string; at: string; state: 'running' | 'due soon' | 'due' | 'late'; skipped?: { person: number | null; at: string } }
export interface StageRow { index: number; key: string; name: string; open: boolean; blocked?: string; closed: boolean }
export interface Deviation { note: number; step: string; reference: string; text: string; open: boolean; status?: string; closedAt?: string | null; filed?: boolean; typed?: boolean }
export interface BatchDetail {
  now: string;
  batch: { id: number; batchNo: string; issuedAt: string; status: string; open: string[]; late: string[]; deviations: Deviation[]; yieldOut: string[]; contentHash: string; actions: string[]; deviationsLink: string;
    terminated: { personName: string; at: string; payload: { reason?: string; returns?: Returned[] } } | null;
    // What the batch has used of each lot (signed steps), as published to MMS: terminating asks what went back to stores.
    issued: Returned[] };
  master: { id: number; versionNo: number; doc: MasterDoc };
  stages: StageRow[]; timers: TimerRow[]; steps: StepRow[];
}
export interface History { events: FloorEvent[]; replaced: { field: string; was: Value; now: Value; reason: string; person: number | null; at: string }[] }
export interface WorkBadge { kind: 'check' | 'resign' | 'due' | 'late' | 'approve'; step?: string; stage: string; title: string; at?: string; timer?: string }
export interface WorkItem {
  id: number; batchNo: string; productCode: string; productName: string; status: string; issuedAt: string; stagesClosed: number; stageCount: number;
  current: { step: string; stage: string; title: string; state: State } | null; badges: WorkBadge[];
}
export interface PickItem { itemId: string; code: string; name: string; active: boolean; type?: string | null; area?: string | null; room?: string | null }

/** Where a value came from, in plain words. */
export const sourceWords = (s: Source | undefined) => (!s ? '' : s.from === 'hand'
  ? `Typed by hand: ${PROVIDER_NAME[s.link]} ${s.state === 'down' ? 'link is down' : 'is not linked'}. A second person checks it.`
  : `From ${PROVIDER_NAME[s.from]}: ${plantText(s.shown)}`);

/** A pick list read through a link (pull, don't type): empty when the link is absent or down, and then the value is typed. */
export function useLinked<T>(url: string | null, list: string): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void api<Record<string, T[]>>('GET', url).then((r) => live && setItems(r[list] ?? []), () => {});
    return () => { live = false; };
  }, [url, list]);
  return items;
}

/**
 * The master-data ids of the machines and rooms the Logbook has, for their pick lists (shared/engine/picks.ts,
 * inLogbook); null while the Logbook link is absent or down, or not read yet (then every item is offered).
 */
export function useLogbookItems(on: boolean): string[] | null {
  const [items, setItems] = useState<string[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void api<{ link: string; items: string[] }>('GET', '/api/logbook/items').then((r) => live && setItems(r.link === 'ok' ? r.items : null), () => {});
    return () => { live = false; };
  }, [on]);
  return items;
}

// ---- routes: #/ (My work), #/batch/12, #/batch/12/step/0.1.0.1, #/batch/12/approve, #/release (To review), #/release/12 ----
export interface Route { batch?: number; step?: string; approve?: boolean; release?: number | 'list' }
export function parseRoute(hash: string): Route {
  const r = /^#\/release(?:\/(\d+))?$/.exec(hash);
  if (r) return { release: r[1] ? Number(r[1]) : 'list' };
  const m = /^#\/batch\/(\d+)(?:\/(?:step\/([\d.]+)|(approve)))?$/.exec(hash);
  return m ? { batch: Number(m[1]), ...(m[2] ? { step: m[2] } : {}), ...(m[3] ? { approve: true } : {}) } : {};
}
export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parseRoute(hash);
}
export const go = (to: string) => { window.location.hash = to; };
export const batchLink = (id: number) => `#/batch/${id}`;
export const stepLink = (id: number, step: string) => `#/batch/${id}/step/${step}`;
export const releaseLink = (id: number) => `#/release/${id}`;
export const pdfLink = (id: number) => `/api/batches/${id}/pdf`;

// ---- the block library, read once ----
let blocks: Promise<Block[]> | null = null;
export function useBlocks(): Block[] | null {
  const [b, setB] = useState<Block[] | null>(null);
  useEffect(() => {
    blocks ??= api<Block[]>('GET', '/api/blocks').catch((e) => { blocks = null; throw e; });
    void blocks.then(setB, () => {});
  }, []);
  return b;
}
export const stepOf = (doc: MasterDoc, k: StepKey) => doc.stages[k.stage]!.steps[k.step]!;
export const blockOf = (all: Block[], st: Step) => all.find((b) => b.id === st.block.id && b.version === st.block.version);
export const keyOf = (k: StepKey) => `${k.stage}.${k.sub}.${k.step}.${k.round}`;

/** A step as people name it, as the server does (shared/engine/batch.ts). */
export const stepTitle = (doc: MasterDoc, _all: Block[], st: Step) => sharedStepTitle(doc, st);
/** The unit a number field is recorded in: written in the block, or a setting of the master step ("$unit"). */
export function unitOf(f: BlockField, st: Step): string {
  if (!f.unit?.startsWith('$')) return f.unit ?? '';
  const s = st.settings[f.unit.slice(1)];
  return typeof s === 'string' ? s : '';
}

// ---- words ----
export const STATE_LABEL: Record<State, [string, string]> = {
  waiting: ['Waiting', ''],
  open: ['Ready to start', 'chip-info'],
  in_progress: ['In progress', 'chip-warn'],
  done_awaiting_check: ['Waiting for check', 'chip-warn'],
  done: ['Done', 'chip-ok'],
  checked: ['Checked', 'chip-ok'],
  not_applicable: ['Not applicable', ''],
};
/** A step's state as a chip; a terminated batch's unfinished step says so, never "Ready to start" (as the PDF). */
export function stateLabel(state: State, terminated: unknown): [string, string] {
  const t = terminated ? TERMINATED_STATE[state] : undefined;
  return t ? [t[0]!.toUpperCase() + t.slice(1), ''] : STATE_LABEL[state];
}
/** A batch status in words (a packing batch is "packing complete"); `capital` for a chip. */
export const statusText = (status: string, capital = false) => statusWords(status, product.packing, capital);
export const STATUS_CHIP: Record<string, string> = {
  'in production': 'chip-info', 'manufacturing complete': 'chip-warn', 'production approved': 'chip-ok', 'QC approved': 'chip-ok', released: 'chip-ok', rejected: 'chip-bad',
};

const isItem = (v: Value): v is { itemId: string; code: string; name: string; version: number } => typeof v === 'object' && !Array.isArray(v) && 'itemId' in v;
/** A recorded value in words; `stockUnit`: master data's unit of the step's material, its name shown for the same unit (nos for units). */
export function valueText(v: Value | undefined, stockUnit?: string | null): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => x.value).join(', ') + (v[0]?.unit ? ` ${unitName(v[0].unit, stockUnit)}` : '');
  if (isItem(v)) return `${v.code} · ${v.name}`;
  if (typeof v === 'object') return `${v.value}${v.unit ? ` ${unitName(v.unit, stockUnit)}` : ''}`;
  return plantText(v);
}
/** What an input holds for a recorded value. */
export function rawOf(v: Value | undefined): string | string[] {
  if (v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => x.value);
  if (isItem(v)) return v.itemId;
  return typeof v === 'object' ? v.value : v;
}

// Plant time as every screen shows it: "15 Nov, 10:21 IST" (the year only when not this year).
export const plainClock = (iso: string) => plantClock(iso);

/** Time left (or past) in words: "12 min", "1 h 05 min"; under 10 minutes with seconds. */
export function timeLeft(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} days ${h % 24} h`;
}

/** The server's clock, ticking every second (the offset is taken from the last batch read). */
export function useServerNow(serverNow: string | undefined): number {
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { if (serverNow) setOffset(Date.parse(serverNow) - Date.now()); }, [serverNow]);
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  return tick + offset;
}

/** A result's headline (shared/engine/plain.ts, as the PDF). */
export { headline, plainLine, withoutVerdict } from '../../shared/engine/plain.js';
export function tone(r: Stored | undefined): 'ok' | 'bad' | 'warn' | null {
  if (!r) return null;
  if (!r.ok) return 'warn';
  const checks = Object.entries(r).filter(([k, v]) => /check$/i.test(k) && v && typeof v === 'object') as [string, { pass: boolean; level: string }][];
  if (!checks.length) return null;
  if (checks.some(([, c]) => !c.pass)) return 'bad';
  return checks.some(([, c]) => c.level === 'alert') ? 'warn' : 'ok';
}

/** A server message in plain words: times in plant time, each sentence ended. */
export const words = (t: string) => plantText(t).replace(/([^.])$/, '$1.');

/** Plain words for a refused action. */
export function plainError(e: unknown): string {
  if (!(e instanceof ApiError)) return (e as Error).message;
  if (e.problems.length) return e.problems.map(words).join(' ');
  return {
    batch_closed: 'The batch record is closed to changes.',
    content_changed: 'Someone changed this record while you were looking at it. It has been reloaded: look at it again.',
    forbidden: 'You do not have the permission for this.',
    connection_off: e.message,
  }[e.code] ?? e.message;
}
export const changed = (e: unknown) => e instanceof ApiError && e.code === 'content_changed';
