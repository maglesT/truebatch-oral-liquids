// The selected step's settings: the instruction, what the operator records, the calculations and checks as
// sentences whose inputs are picked from lists (only compatible kinds offered), a live worked example, signatures,
// critical, the flow, and "More options" for the rare settings.
import { useEffect, useState } from 'react';
import { findBlock, type Block } from '../../../shared/blocks/index.js';
import { stepTitle } from '../../../shared/engine/batch.js';
import type { Stored, Value } from '../../../shared/engine/index.js';
import type { Kind } from '../../../shared/templates/index.js';
import { HEADER_VALUES, materialLines, type Limit, type MasterDoc, type SettingValue, type Step } from '../../../shared/master/schema.js';
import { usedFields, verdictless, workedExample } from './example.js';
import { earlierRefs, HEADER_LABEL, kindOfUnit, neededKind, unitLabel, unitsOf } from './model.js';
import { lower, sentence, slotsOf, type Part } from './sentences.js';
import { Decimal } from './ui.js';
import { api } from '../api.js';
import { skillText } from '../../../shared/engine/training.js';

type Settings = Step['settings'];
const FLOWS = [['none', 'Once'], ['repeat-until', 'Repeat until a check passes'], ['optional-with-reason', 'Optional (skipped with a reason)'], ['qa-hold', 'QA hold (QA releases before the next step)']] as const;

export function StepSettings({ doc, si, ti, onChange }: { doc: MasterDoc; si: number; ti: number; onChange: (t: Step) => void }) {
  const step = doc.stages[si]!.steps[ti]!;
  const block = findBlock(step.block);
  if (!block) return <p className="error">No block {step.block.id} version {step.block.version} in the library.</p>;
  // An optional step field: set, or left out when undefined.
  const opt = <K extends 'everyMinutesLater' | 'onlyIf' | 'orderAfter' | 'applyPerCharge'>(k: K, v: Step[K] | undefined) => {
    const next: Step = { ...step, [k]: v };
    if (v === undefined) delete next[k];
    onChange(next);
  };
  const setting = (name: string, v: SettingValue | undefined) => {
    const { [name]: _, ...rest } = step.settings;
    onChange({ ...step, settings: v === undefined ? rest : { ...rest, [name]: v } });
  };
  const slots = slotsOf(block);
  const loose = block.settings.filter((s) => !slots.has(s.name));
  // A setting used in two sentences is one input: the first sentence holds it, later ones name it.
  const seen = new Set<string>();
  const first = (p: Part) => typeof p !== 'object' || !('setting' in p) || (!seen.has(p.setting) && !!seen.add(p.setting));
  const slot = (name: string) => <Slot doc={doc} si={si} ti={ti} block={block} settings={step.settings} name={name} onChange={(v) => setting(name, v)} />;
  return (
    <div className="step-settings">
      <h2>{block.name}</h2>
      <label>Name of the step (as people read it)<input value={step.name ?? ''} placeholder={stepTitle(doc, { ...step, name: undefined })}
        onChange={(e) => { const { name: _, ...rest } = step; onChange(e.target.value ? { ...rest, name: e.target.value } : rest); }} /></label>
      <label>Instruction to the operator
        <textarea value={step.instruction ?? block.instruction} onChange={(e) => onChange({ ...step, instruction: e.target.value === block.instruction ? undefined : e.target.value })} />
      </label>
      {step.instruction !== undefined && <button type="button" className="link dark small" onClick={() => { const { instruction: _, ...rest } = step; onChange(rest as Step); }}>Use the block's text again</button>}

      <div className="d-section">
        <h3>The operator records</h3>
        <p className="tokens">{block.fields.map((f) => <span key={f.name} className="tok field">{f.label}{f.count ? ` (${f.count} readings)` : ''}{f.unit && !f.unit.startsWith('$') ? `, ${f.unit}` : ''}{f.optional ? ' · if given' : ''}</span>)}</p>
      </div>

      {loose.length > 0 && (
        <div className="d-section">
          <h3>Settings</h3>
          {loose.map((s) => <div key={s.name} className="loose"><span className="field-label">{s.label}{s.optional ? ' (optional)' : ''}</span>{slot(s.name)}</div>)}
        </div>
      )}

      {block.calcs.length > 0 && (
        <div className="d-section">
          <h3>Calculations and checks</h3>
          {block.calcs.map((c) => <p key={c.name} className="sentence">{sentence(block, c).map((p, i) => <PartView key={i} block={block} part={p} slot={slot} first={first(p)} />)}</p>)}
        </div>
      )}

      <Example key={`${si}/${step.key}`} doc={doc} si={si} ti={ti} block={block} />

      <div className="d-section">
        <h3>Signatures</h3>
        <p className="muted small">The operator who performs the step signs it.</p>
        <label className="check"><input type="checkbox" checked={step.checker} onChange={(e) => onChange({ ...step, checker: e.target.checked })} />A second person checks it (checker)</label>
        {block.gmp && <p className="muted small">A {block.gmp.replace('-', ' ')} step always needs a second-person check.</p>}
        <label className="check"><input type="checkbox" checked={step.critical} onChange={(e) => onChange({ ...step, critical: e.target.checked })} />Critical step</label>
        <TrainingNeeded value={step.training} onChange={(training) => { const { training: _, ...rest } = step; onChange(training ? { ...rest, training } : rest as Step); }} />
      </div>

      <div className="d-section">
        <h3>Flow</h3>
        <select aria-label="Flow" value={step.flow.kind} onChange={(e) => {
          const kind = e.target.value as Step['flow']['kind'];
          onChange({ ...step, flow: kind === 'repeat-until' ? { kind, maxRounds: 10 } : { kind } });
        }}>{FLOWS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        {step.flow.kind === 'repeat-until' && (
          <label>At most this many rounds (then a deviation note is needed)
            <input type="number" min={1} max={500} value={step.flow.maxRounds ?? ''} onChange={(e) => onChange({ ...step, flow: { ...step.flow, kind: 'repeat-until', maxRounds: e.target.value ? Number(e.target.value) : undefined } })} />
          </label>
        )}
        {step.flow.kind === 'repeat-until' && !block.stop && <p className="muted small">Pick the check that stops the rounds under More options.</p>}
      </div>

      <details className="more">
        <summary>More options</summary>
        <div className="form-grid">
          <label>Step key<input value={step.key} onChange={(e) => onChange({ ...step, key: e.target.value.toLowerCase() })} /></label>
          <label>Shortest time (minutes)<input type="number" min={1} value={step.minMinutes ?? ''} onChange={(e) => { const { minMinutes: _, ...rest } = step; onChange(e.target.value ? { ...rest, minMinutes: Number(e.target.value) } : rest as Step); }} /></label>
          <label>A round every (minutes)<input type="number" min={1} value={step.everyMinutes ?? ''} onChange={(e) => { const { everyMinutes: _, ...rest } = step; onChange(e.target.value ? { ...rest, everyMinutes: Number(e.target.value) } : rest as Step); }} /></label>
          {step.flow.kind === 'repeat-until' && (
            <label>Rounds stop when this check passes<select value={step.flow.stop ?? block.stop ?? ''} onChange={(e) => onChange({ ...step, flow: { ...step.flow, kind: 'repeat-until', stop: e.target.value === block.stop ? undefined : e.target.value || undefined } })}>
              <option value="">(choose)</option>{block.calcs.map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}</select></label>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={step.waitForCheck} onChange={(e) => onChange({ ...step, waitForCheck: e.target.checked })} />The next step waits for the check</label>
        <div className="form-grid">
          {step.everyMinutes && <>
            <label>After (minutes from the first round)<input type="number" min={1} value={step.everyMinutesLater?.afterMinutes ?? ''} onChange={(e) => opt('everyMinutesLater', e.target.value ? { afterMinutes: Number(e.target.value), everyMinutes: step.everyMinutesLater?.everyMinutes ?? step.everyMinutes! } : undefined)} /></label>
            {step.everyMinutesLater && <label>then a round every (minutes)<input type="number" min={1} value={step.everyMinutesLater.everyMinutes} onChange={(e) => opt('everyMinutesLater', { ...step.everyMinutesLater!, everyMinutes: Number(e.target.value) || 1 })} /></label>}
          </>}
          <label>Only when the core batch is at most (kg)<Decimal label="Only when the core batch is at most (kg)" placeholder="always" value={step.onlyIf?.limit.high}
            onChange={(v) => opt('onlyIf', v ? { header: 'coreBatch', limit: { high: v, unit: 'kg' } } : undefined)} /></label>
          <label>Order-critical: must come after<select value={step.orderAfter ?? ''} onChange={(e) => opt('orderAfter', e.target.value || undefined)}>
            <option value="">(not order-critical)</option>{doc.stages[si]!.steps.map((t, j) => t.key !== step.key && <option key={t.key} value={t.key}>{j + 1}. {stepTitle(doc, t)}</option>)}</select></label>
          {/^(coat|spray-coat)$/.test(block.id) && <>
            <label>Liquid to apply<input aria-label="Liquid to apply" placeholder="e.g. 971 g" value={step.applyPerCharge?.liquid ?? ''} onChange={(e) => opt('applyPerCharge', e.target.value ? { liquid: e.target.value, charge: step.applyPerCharge?.charge ?? '' } : undefined)} /></label>
            {step.applyPerCharge && <label>per charge of<input aria-label="per charge of" placeholder="e.g. 150 g" value={step.applyPerCharge.charge} onChange={(e) => opt('applyPerCharge', { ...step.applyPerCharge!, charge: e.target.value })} /></label>}
          </>}
        </div>
      </details>
    </div>
  );
}

type Skill = NonNullable<Step['training']>;
/**
 * Only trained people sign (owner, 17 Nov 2026): the skill the performer and the checker must hold, picked from the
 * skills Recruitment publishes; typed only while the Recruitment link is off or down. None: anyone may sign.
 */
function TrainingNeeded({ value, onChange }: { value?: Skill; onChange: (s: Skill | undefined) => void }) {
  const [read, setRead] = useState<{ link: string; skills: Skill[] } | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ link: string; skills: Skill[] }>('GET', '/api/recruitment/skills').then((r) => live && setRead(r), () => live && setRead({ link: 'down', skills: [] }));
    return () => { live = false; };
  }, []);
  if (!read) return null;
  if (read.link === 'ok') {
    // A skill the master names that Recruitment no longer lists stays offered, marked.
    const skills = value && !read.skills.some((x) => x.code === value.code) ? [...read.skills, value] : read.skills;
    return (
      <label>Training needed (from Recruitment)
        <select aria-label="Training needed" value={value?.code ?? ''} onChange={(e) => onChange(skills.find((x) => x.code === e.target.value))}>
          <option value="">(none: anyone with the permission signs)</option>
          {skills.map((x) => <option key={x.code} value={x.code}>{skillText(x)}{read.skills.includes(x) ? '' : ' (not in Recruitment now)'}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label>Training needed (Recruitment is {read.link === 'absent' ? 'not linked' : 'not reachable'}: type the skill code)
      <input aria-label="Training needed" placeholder="none, e.g. SOP-STR-004" value={value?.code ?? ''}
        onChange={(e) => onChange(e.target.value.trim() ? { code: e.target.value.trim() } : undefined)} />
    </label>
  );
}

function PartView({ block, part, slot, first }: { block: Block; part: Part; slot: (name: string) => JSX.Element; first: boolean }) {
  if (typeof part === 'string') return <>{part}</>;
  const label = (n: string) => lower([...block.fields, ...block.calcs, ...block.settings].find((x) => x.name === n)?.label ?? n);
  if ('setting' in part) return first ? <span className="slot">{slot(part.setting)}</span> : <span className="tok">the {label(part.setting)} (above)</span>;
  if ('field' in part) return <span className="tok field">the {label(part.field)}</span>;
  if ('calc' in part) return <span className="tok calc">the {label(part.calc)}</span>;
  return <span className="tok calc">the previous round's {label(part.prev)}</span>;
}

/** One setting as a pick list or input, by its kind. */
function Slot({ doc, si, ti, block, settings, name, onChange }: {
  doc: MasterDoc; si: number; ti: number; block: Block; settings: Settings; name: string; onChange: (v: SettingValue | undefined) => void;
}) {
  const s = block.settings.find((x) => x.name === name)!;
  const v = settings[name];
  const kind = neededKind(block, name, settings);
  const missing = v === undefined && !s.optional;
  const cls = missing ? 'missing' : '';
  if (s.kind === 'number') return <Decimal label={s.label} placeholder="set" value={typeof v === 'string' ? v : ''} onChange={(x) => onChange(x || undefined)} width={5} />;
  if (s.kind === 'text' && s.options) {
    return <select className={cls} aria-label={s.label} value={typeof v === 'string' ? v : '?'} onChange={(e) => onChange(e.target.value === '?' ? undefined : e.target.value)}>
      <option value="?">(choose)</option>{s.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  }
  if (s.kind === 'text') {
    // A text setting that is a field's unit is picked from the unit list.
    if (block.fields.some((f) => f.unit === `$${name}`)) {
      return <select className={cls} aria-label={s.label} value={typeof v === 'string' ? v : '?'} onChange={(e) => onChange(e.target.value === '?' ? undefined : e.target.value)}>
        <option value="?">(choose a unit)</option>{unitsOf().map((u) => <option key={u.symbol} value={u.symbol}>{unitLabel(u.symbol)}</option>)}</select>;
    }
    return <input className={cls} aria-label={s.label} value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value || undefined)} />;
  }
  if (s.kind === 'material') {
    return <select className={cls} aria-label={s.label} value={typeof v === 'object' && 'formula' in v ? v.formula : ''} onChange={(e) => onChange(e.target.value ? { formula: e.target.value } : undefined)}>
      <option value="">(choose a material)</option>{materialLines(doc).map((l) => <option key={l.key} value={l.key}>{l.code} {l.name}</option>)}</select>;
  }
  if (s.kind === 'limit') {
    const field = block.fields.find((f) => f.kind === 'number' && f.unit && !f.unit.startsWith('$') && kindOfUnit(f.unit) === kind);
    const unitSetting = block.fields.find((f) => f.unit?.startsWith('$'))?.unit?.slice(1);
    const k = kind ?? (unitSetting ? kindOfUnit(settings[unitSetting] as string) : undefined);
    const def = kind === 'fraction' ? '%' : field?.unit ?? (unitSetting && typeof settings[unitSetting] === 'string' ? settings[unitSetting] as string : unitsOf(k)[0]?.symbol ?? '');
    return <LimitEdit label={s.label} value={typeof v === 'object' && 'unit' in v ? v : undefined} kind={k} unit={def} onChange={onChange} missing={missing} />;
  }
  return <QuantitySource doc={doc} si={si} ti={ti} label={s.label} kind={kind} value={v} onChange={onChange} missing={missing} />;
}

function LimitEdit({ label, value, kind, unit, onChange, missing }: { label: string; value?: Limit; kind?: Kind; unit: string; onChange: (l: Limit | undefined) => void; missing: boolean }) {
  const l = value ?? { unit };
  const put = (x: Partial<Limit>) => {
    const n = { ...l, ...x } as Limit;
    const clean = Object.fromEntries(Object.entries(n).filter(([, y]) => y !== undefined && y !== '')) as Limit;
    onChange(clean.low || clean.high ? { ...clean, unit: n.unit } : undefined);
  };
  return (
    <span className={missing ? 'limit missing' : 'limit'}>
      within <Decimal label={`${label}: lowest`} placeholder="lowest" value={l.low} onChange={(low) => put({ low })} width={5} /> to{' '}
      <Decimal label={`${label}: highest`} placeholder="highest" value={l.high} onChange={(high) => put({ high })} width={5} />{' '}
      <select aria-label={`${label}: unit`} value={l.unit} onChange={(e) => put({ unit: e.target.value })}>
        {unitsOf(kind).map((u) => <option key={u.symbol} value={u.symbol}>{unitLabel(u.symbol)}</option>)}
      </select>
    </span>
  );
}

/** Where a quantity comes from: a typed value, a formula line, the header, or an earlier step (compatible kinds only). */
function QuantitySource({ doc, si, ti, label, kind, value, onChange, missing }: {
  doc: MasterDoc; si: number; ti: number; label: string; kind?: Kind; value?: SettingValue; onChange: (v: SettingValue | undefined) => void; missing: boolean;
}) {
  const fits = (k: Kind | undefined) => !kind || k === kind;
  const refs = earlierRefs(doc, si, ti).filter((r) => fits(r.kind));
  const code = value === undefined ? '' : typeof value === 'string' ? 'type' : 'formula' in value ? `${value.adjusted ? 'fa' : 'f'}:${value.formula}` : 'header' in value ? `h:${value.header}` : 'ref' in value ? `r:${value.ref}` : '';
  const pick = (c: string) => {
    const [k, ...rest] = c.split(':');
    const x = rest.join(':');
    onChange(k === 'type' ? `0 ${kind ? unitsOf(kind)[0]?.symbol ?? '' : 'kg'}`.trim() : k === 'f' || k === 'fa' ? { formula: x, ...(k === 'fa' ? { adjusted: true } : {}) }
      : k === 'h' ? { header: x as (typeof HEADER_VALUES)[number] } : k === 'r' ? { ref: x } : undefined);
  };
  const typed = typeof value === 'string' ? /^(\S*)\s*(.*)$/.exec(value) : null;
  return (
    <span className={missing ? 'quantity missing' : 'quantity'}>
      <select aria-label={label} value={code} onChange={(e) => pick(e.target.value)}>
        <option value="">({label.toLowerCase()}: choose)</option>
        <option value="type">a value I type</option>
        {fits('mass') && doc.formula.length > 0 && (
          <optgroup label="Formula: batch quantity">
            {doc.formula.flatMap((l) => [
              <option key={`f${l.key}`} value={`f:${l.key}`}>{l.name}</option>,
              ...(l.adjust ? [<option key={`fa${l.key}`} value={`fa:${l.key}`}>{l.name}, adjusted for the lot</option>] : []),
            ])}
          </optgroup>
        )}
        {HEADER_VALUES.some((h) => fits(HEADER_LABEL[h].kind)) && (
          <optgroup label="Header">
            {HEADER_VALUES.filter((h) => fits(HEADER_LABEL[h].kind) && (!h.startsWith('coated') || doc.header.coatedWeightMg)).map((h) => <option key={h} value={`h:${h}`}>{HEADER_LABEL[h].label}</option>)}
          </optgroup>
        )}
        {refs.length > 0 && <optgroup label="An earlier step">{refs.map((r) => <option key={r.ref} value={`r:${r.ref}`}>{r.label}</option>)}</optgroup>}
      </select>
      {typed && (
        <>
          {' '}<Decimal label={`${label}: value`} value={typed[1]} onChange={(x) => onChange(`${x} ${typed[2]}`.trim())} width={6} />{' '}
          <select aria-label={`${label}: unit`} value={typed[2]} onChange={(e) => onChange(`${typed[1]} ${e.target.value}`.trim())}>
            {unitsOf(kind).map((u) => <option key={u.symbol} value={u.symbol}>{unitLabel(u.symbol)}</option>)}
          </select>
        </>
      )}
    </span>
  );
}

const valueText = (v: Value | undefined) => (v === undefined ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => x.value).join(', ') : 'value' in v ? v.value : v.code);

/** A live worked example: example values (editable, never saved) through the engine. */
function Example({ doc, si, ti, block }: { doc: MasterDoc; si: number; ti: number; block: Block }) {
  const [typed, setTyped] = useState<Record<string, Value>>({});
  const [ex, setEx] = useState<ReturnType<typeof workedExample> | null>(null);
  useEffect(() => { try { setEx(workedExample(doc, si, ti, typed)); } catch { setEx(null); } }, [doc, si, ti, typed]);
  if (!ex || !block.calcs.length) return null;
  const fields = usedFields(block);
  const shownSettings = block.settings.filter((s) => ex.results[s.name]);
  const line = (label: string, r: Stored | undefined) => (
    <li key={label} className={!r ? 'waits' : !r.ok ? 'refused' : r.check ? r.check.level : ''}>
      <b>{label}</b>{' '}{!r ? <span className="muted">waits for its inputs</span> : r.ok ? <>{r.check ? verdictless(r.shown) : r.shown}{r.check && <span className={`chip ${r.check.pass ? (r.check.level === 'alert' ? 'chip-warn' : 'chip-ok') : 'chip-bad'}`}>{r.check.pass ? (r.check.level === 'alert' ? 'alert' : 'pass') : 'fail'}</span>}</> : <span className="error">{r.message}</span>}
    </li>
  );
  return (
    <div className="d-section example">
      <h3>Worked example <span className="muted small">(example values; nothing is saved)</span></h3>
      <div className="ex-values">
        {fields.map((f) => {
          const v = ex.values[f.name];
          const unit = Array.isArray(v) ? v[0]?.unit : typeof v === 'object' && v && 'unit' in v ? v.unit : '';
          return (
            <label key={f.name}>{f.label}{unit ? ` (${unit})` : ''}
              <input aria-label={`Example ${f.label}`} value={valueText(v)} onChange={(e) => {
                const t = e.target.value;
                setTyped((x) => ({ ...x, [f.name]: f.kind !== 'number' ? t : f.count ? t.split(',').map((y) => ({ value: y.trim(), unit: unit ?? '' })) : { value: t.trim(), unit: unit ?? '' } }));
              }} />
            </label>
          );
        })}
      </div>
      <ul className="ex-results">
        {shownSettings.map((s) => line(s.label, ex.results[s.name]))}
        {block.calcs.map((c) => line(c.label, ex.results[c.name]))}
      </ul>
      {Object.keys(typed).length > 0 && <button type="button" className="link dark small" onClick={() => setTyped({})}>Back to the example values</button>}
    </div>
  );
}
