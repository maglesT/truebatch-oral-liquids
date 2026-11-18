// Screen 3: the formula. One row per material picked from master data (the product's materials first), mg per
// tablet, role, place and the batch quantity worked out; the adjustment panel for the selected line; live totals.
import { useState } from 'react';
import type { MasterData, MasterRow } from '../api-designer.js';
import type { Problem } from '../../../shared/master/checks.js';
import { lineQuantity } from '../../../shared/engine/index.js';
import { Dec, t2Total } from '../../../shared/templates/index.js';
import type { FormulaLine, MasterDoc } from '../../../shared/master/schema.js';
import { AnswerBox, type OnAnswer } from './CheckPanel.js';
import { grouped, move, newKey, qtyText } from './model.js';
import { Decimal, Order, Picker } from './ui.js';

type Adjust = NonNullable<FormulaLine['adjust']>;
const HERE = { stage: 0, sub: 1, step: 0, round: 1 };
const PLACES = [['intragranular', 'Intragranular'], ['extragranular', 'Extragranular'], ['binder', 'Binder solution'], ['coating:1', 'Coating layer 1'], ['coating:2', 'Coating layer 2'], ['coating:3', 'Coating layer 3']] as const;
const total = (lines: FormulaLine[]) => { const r = t2Total({ values: lines.map((l) => `${l.mgPerTablet || '0'} mg`), unit: 'mg' }); return r.ok ? r.value : null; };

export function FormulaTable({ doc, onChange, md, masters, selected, onSelect, problems, onAnswer }: {
  doc: MasterDoc; onChange: (d: MasterDoc) => void; md: MasterData; masters: MasterRow[]; selected?: number; onSelect: (i?: number) => void; problems: Problem[]; onAnswer?: OnAnswer;
}) {
  const [adding, setAdding] = useState(false);
  const lines = doc.formula;
  const set = (formula: FormulaLine[]) => onChange({ ...doc, formula });
  const put = (i: number, l: FormulaLine) => set(lines.map((x, j) => (j === i ? l : x)));
  const linked = [...new Set(masters.filter((m) => m.header.productItemId === doc.header.productItemId).flatMap((m) => m.materialIds))];
  const valid = (mg: string) => /^\d+(\.\d+)?$/.test(mg);
  const core = lines.filter((l) => l.place !== 'coating' && l.role !== 'solvent');
  const coat = lines.filter((l) => l.place === 'coating');
  const coreTotal = core.every((l) => valid(l.mgPerTablet)) ? total(core) : null;
  const coatTotal = coat.every((l) => valid(l.mgPerTablet)) ? total(coat) : null;
  const gain = doc.header.coatedWeightMg && valid(doc.header.coatedWeightMg) && valid(doc.header.coreWeightMg) ? new Dec(doc.header.coatedWeightMg).minus(doc.header.coreWeightMg) : null;
  const sel = selected === undefined ? undefined : lines[selected];

  return (
    <>
      <div className="card">
        <div className="d-section-head"><h2>Formula</h2><span className="muted small">Quantities per tablet; the batch quantity is worked out for {grouped(doc.header.batchSize)} tablets.</span></div>
        <div className="table-wrap">
          <table className="plain-table formula-table">
            <thead><tr><th>Material</th><th>mg per tablet</th><th>Role</th><th>Place</th><th>Batch quantity</th><th>Adjustment</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const bad = problems.some((p) => p.path.startsWith(`formula[${i}]`) && p.level === 'error');
                return (
                  <tr key={l.key} className={selected === i ? 'sel' : bad ? 'bad-row' : ''} onClick={() => onSelect(i)}>
                    <td><b>{l.code}</b><span className="cell-sub">{l.name}</span></td>
                    <td><Decimal label={`mg per tablet of ${l.name}`} value={l.mgPerTablet} onChange={(v) => put(i, { ...l, mgPerTablet: v })} /></td>
                    <td><select aria-label={`Role of ${l.name}`} value={l.role} onChange={(e) => put(i, { ...l, role: e.target.value as FormulaLine['role'] })}>
                      <option value="api">API</option><option value="excipient">Excipient</option><option value="solvent">Removed in processing (solvent, processing aid)</option></select></td>
                    <td><select aria-label={`Place of ${l.name}`} value={l.place === 'coating' ? `coating:${l.layer ?? 1}` : l.place}
                      onChange={(e) => { const [place, layer] = e.target.value.split(':'); const { layer: _, ...rest } = l; put(i, { ...rest, place: place as FormulaLine['place'], ...(layer ? { layer: Number(layer) } : {}) }); }}>
                      {PLACES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                    <td className="nowrap num">{valid(l.mgPerTablet) && /^[1-9]\d*$/.test(doc.header.batchSize) ? qtyText(lineQuantity(doc, [], HERE, l, false, {})) : '—'}</td>
                    <td><button type="button" className="link dark" onClick={(e) => { e.stopPropagation(); onSelect(i); }}>{adjustSummary(l.adjust)}</button></td>
                    <td><Order index={i} count={lines.length} what={l.name} onMove={(by) => set(move(lines, i, by))} onRemove={() => { set(lines.filter((_, j) => j !== i)); onSelect(undefined); }} /></td>
                  </tr>
                );
              })}
              {!lines.length && <tr><td colSpan={7} className="muted">No materials yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="totals">
          <Total label="Core materials" value={coreTotal} target={valid(doc.header.coreWeightMg) ? new Dec(doc.header.coreWeightMg) : null} what="the theoretical core weight" />
          {(coat.length > 0 || doc.header.coatedWeightMg) && <Total label="Coating" value={coatTotal} target={gain} what="the weight gain (coated − core weight)" />}
        </div>
        {adding ? (
          <div className="add-box">
            <Picker label="Material" first={linked} firstLabel={`Materials of ${doc.header.productCode} in other masters`}
              items={md.materials.map((m) => ({ id: m.itemId, code: m.code, name: m.name, note: m.category ?? undefined, off: !m.active ? 'inactive' : lines.some((l) => l.materialItemId === m.itemId) ? 'in the formula' : undefined }))}
              onPick={(m) => {
                const line: FormulaLine = { key: newKey(m.code, lines.map((l) => l.key)), materialItemId: m.id, code: m.code, name: m.name, mgPerTablet: '', role: 'excipient', place: 'intragranular' };
                set([...lines, line]); onSelect(lines.length); setAdding(false);
              }} />
            <div className="actions"><button type="button" onClick={() => setAdding(false)}>Close</button></div>
          </div>
        ) : <div className="row"><button type="button" onClick={() => setAdding(true)}>+ Add a material</button></div>}
      </div>
      {sel && selected !== undefined && <AdjustPanel doc={doc} line={sel} onChange={(l) => put(selected, l)} problems={problems.filter((p) => p.path.startsWith(`formula[${selected}]`))} onAnswer={onAnswer} />}
    </>
  );
}

function Total({ label, value, target, what }: { label: string; value: Dec | null; target: Dec | null; what: string }) {
  const ok = value !== null && target !== null && value.eq(target);
  return (
    <div className={`total ${value === null || target === null ? '' : ok ? 'ok' : 'bad'}`}>
      <span>{label}</span>
      <b>{value === null ? '—' : `${value.toFixed(1)} mg`}</b>
      <span className="small">{target === null ? `set ${what} in the header` : ok ? `✓ equals ${what}` : `⛔ ${what} is ${target.toFixed(1)} mg`}</span>
    </div>
  );
}

function adjustSummary(a: Adjust | undefined): string {
  if (!a) return 'None';
  const parts = [a.salt && 'salt factor', a.potency && `assay (${a.potency.basis})`, a.content && 'content', a.overage && `overage ${a.overage.percent} %`, a.compensates?.length && 'compensating filler'].filter(Boolean);
  return parts.length ? parts.join(', ') : 'None';
}

/** The API "Adjustment" panel: the settings of the dispensing templates (T11, T9 or T18, T16, T10), in this order. */
function AdjustPanel({ doc, line, onChange, problems, onAnswer }: { doc: MasterDoc; line: FormulaLine; onChange: (l: FormulaLine) => void; problems: Problem[]; onAnswer?: OnAnswer }) {
  const a: Adjust = line.adjust ?? {};
  const put = (next: Adjust) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Adjust;
    const { adjust: _, ...rest } = line;
    onChange(Object.keys(clean).length ? { ...rest, adjust: clean } : rest);
  };
  const mode = a.potency ? 'potency' : a.content ? 'content' : 'none';
  const field = (k: 'labelClaim' | 'batchQuantity', v: string) => { const next: FormulaLine = { ...line, [k]: v.trim() }; if (!v.trim()) delete next[k]; onChange(next); };
  const others = doc.formula.filter((l) => l.key !== line.key && l.adjust && !l.adjust.compensates?.length);
  const form = (which: 'from' | 'to', label: string) => {
    const f = a.salt?.[which] ?? { name: '', mw: '' };
    const setF = (x: Partial<typeof f>) => put({ ...a, salt: { from: a.salt?.from ?? { name: '', mw: '' }, to: a.salt?.to ?? { name: '', mw: '' }, [which]: { ...f, ...x } } });
    return (
      <div className="form-grid">
        <label>{label}<input aria-label={`${label} name`} value={f.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. base" /></label>
        <label>Molecular weight<Decimal label={`${label} molecular weight`} value={f.mw} onChange={(mw) => setF({ mw })} /></label>
        <label>Drug molecules per formula unit<input type="number" min={1} max={4} aria-label={`${label} molecules per formula unit`} value={f.moleculesPerUnit ?? 1} onChange={(e) => setF({ moleculesPerUnit: Number(e.target.value) > 1 ? Number(e.target.value) : undefined })} /></label>
        {which === 'from' && <label>Ion charge (for mEq)<input type="number" min={1} max={4} aria-label={`${label} ion charge`} value={f.charge ?? ''} onChange={(e) => setF({ charge: Number(e.target.value) || undefined })} /></label>}
        {which === 'to' && <label className="check"><input type="checkbox" checked={!!f.hydrateOrSolvate} onChange={(e) => setF({ hydrateOrSolvate: e.target.checked || undefined })} />Its molecular weight includes crystal water or solvent</label>}
      </div>
    );
  };
  return (
    <div className="card adjust">
      <div className="d-section-head"><h2>Adjustment of {line.name} at dispensing</h2><span className="muted small">Worked out with the lot's certificate values; the templates refuse settings that would count water twice.</span></div>
      {line.role === 'api' || a.potency || a.content || a.salt ? (
        <>
          <fieldset className="checklist">
            <legend>Salt form</legend>
            <label className="check"><input type="checkbox" checked={!!a.salt} onChange={(e) => put({ ...a, salt: e.target.checked ? { from: { name: 'base', mw: '' }, to: { name: '', mw: '' } } : undefined })} />
              The formula gives the quantity of another form (base, salt, element)</label>
            {a.salt && <>{form('from', 'Form in the formula')}{form('to', 'Form dispensed')}
              <label>Salt factor as written in the formula (optional, checked against the molecular weights)<Decimal label="Salt factor as written" placeholder="none" value={a.salt.factor}
                onChange={(factor) => put({ ...a, salt: { ...a.salt!, factor: factor || undefined } })} /></label></>}
          </fieldset>
          <fieldset className="checklist">
            <legend>Adjust for the lot</legend>
            <div className="seg small-seg" role="radiogroup" aria-label="Adjust for the lot">
              {(['none', 'potency', 'content'] as const).map((m) => (
                <button type="button" key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''}
                  onClick={() => put({ ...a, potency: m === 'potency' ? a.potency ?? { basis: 'as is', standardIs: 'anhydrous' } : undefined, content: m === 'content' ? a.content ?? { formulaQuantityIs: 'dry' } : undefined })}>
                  {m === 'none' ? 'No' : m === 'potency' ? 'Assay' : 'Content'}</button>
              ))}
            </div>
            {a.potency && (
              <div className="form-grid">
                <label>Assay basis<select value={a.potency.basis} onChange={(e) => put({ ...a, potency: { ...a.potency!, basis: e.target.value as 'as is' } })}>
                  {['as is', 'anhydrous', 'dried', 'ignited', 'anhydrous and solvent-free'].map((b) => <option key={b}>{b}</option>)}</select></label>
                <label>The formula quantity is the<select value={a.potency.standardIs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, standardIs: (e.target.value || undefined) as 'anhydrous' } })}>
                  <option value="">(not stated)</option><option value="anhydrous">anhydrous weight</option><option value="hydrate or solvate">hydrate or solvate weight</option></select></label>
                <label>Potency stated<select value={a.potency.potencyAs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, potencyAs: (e.target.value || undefined) as 'parent' } })}>
                  <option value="">as the substance</option><option value="parent">as parent (µg parent per mg)</option><option value="element">as element (% Ca, Zn, Fe)</option></select></label>
                <label>An assay above 100 %<select value={a.potency.assayAbove100 ?? 'use'} onChange={(e) => put({ ...a, potency: { ...a.potency!, assayAbove100: e.target.value === 'use' ? undefined : 'treat as 100' } })}>
                  <option value="use">is used as found</option><option value="treat as 100">is taken as 100 %</option></select></label>
                <label>The assay is expressed as<select value={a.potency.assayExpressedAs ?? ''} onChange={(e) => put({ ...a, potency: { ...a.potency!, assayExpressedAs: (e.target.value || undefined) as 'hydrate' } })}>
                  <option value="">(not stated)</option><option value="anhydrous substance">the anhydrous substance</option><option value="hydrate">the hydrate</option></select></label>
              </div>
            )}
            {a.content && (
              <div className="form-grid">
                <label>The formula quantity is<select value={a.content.formulaQuantityIs} onChange={(e) => put({ ...a, content: { ...a.content!, formulaQuantityIs: e.target.value as 'dry' } })}>
                  <option value="dry">of the pure (dry) material</option><option value="wet">of the material as supplied</option></select></label>
                <label>Nominal content (%)<Decimal label="Nominal content" value={a.content.nominalContent} onChange={(v) => put({ ...a, content: { ...a.content!, nominalContent: v || undefined } })} /></label>
                <label>The content comes from<select value={a.content.contentSource ?? 'certificate'} onChange={(e) => put({ ...a, content: { ...a.content!, contentSource: e.target.value === 'certificate' ? undefined : 'in-process result' } })}>
                  <option value="certificate">the lot's certificate</option><option value="in-process result">an in-process result (granule or blend assay)</option></select></label>
                {a.content.contentSource === 'in-process result' && <label>The in-process result is<select value={a.content.resultType ?? ''} onChange={(e) => put({ ...a, content: { ...a.content!, resultType: (e.target.value || undefined) as 'content' } })}>
                  <option value="">(not stated)</option><option value="content">the content (% w/w)</option><option value="percent of theoretical">% of theoretical (nominal content above)</option></select></label>}
              </div>
            )}
          </fieldset>
        </>
      ) : null}
      {/* An overage on any line, e.g. a coating powder's spray loss (T16). */}
      <fieldset className="checklist">
        <legend>Overage</legend>
        <div className="form-grid">
          <label>Overage (%)<Decimal label="Overage percent" placeholder="none" value={a.overage?.percent} onChange={(v) => put({ ...a, overage: v ? { ...a.overage, percent: v } : undefined })} /></label>
          {a.overage && <label>Highest overage allowed (%)<Decimal label="Highest overage allowed" value={a.overage.maxPercent} onChange={(v) => put({ ...a, overage: { ...a.overage!, maxPercent: v || undefined } })} /></label>}
        </div>
      </fieldset>
      {line.role !== 'api' && (
        <fieldset className="checklist">
          <legend>Compensating filler</legend>
          {others.length ? others.map((o) => (
            <label key={o.key} className="check"><input type="checkbox" checked={a.compensates?.includes(o.key) ?? false}
              onChange={(e) => put({ ...a, compensates: e.target.checked ? [...(a.compensates ?? []), o.key] : a.compensates?.filter((k) => k !== o.key) })} />
              {line.name} makes up for the adjusted quantity of {o.name}</label>
          )) : <p className="muted small">No adjusted material to compensate.</p>}
        </fieldset>
      )}
      <fieldset className="checklist">
        <legend>As written in the source (checked, never used)</legend>
        <div className="form-grid">
          {line.role === 'api' && <label>Label claim per tablet<input aria-label="Label claim per tablet" placeholder="e.g. 20 mg or 10 mEq" value={line.labelClaim ?? ''} onChange={(e) => field('labelClaim', e.target.value)} /></label>}
          <label>Batch quantity<input aria-label="Batch quantity as written" placeholder="e.g. 120.000 kg" value={line.batchQuantity ?? ''} onChange={(e) => field('batchQuantity', e.target.value)} /></label>
        </div>
      </fieldset>
      {problems.map((p, i) => <div key={i} className={p.level === 'error' ? 'error' : 'notice'}>{p.level === 'error' ? '⛔' : '⚠️'} {p.message}{p.question && <AnswerBox key={p.question.key} p={p} onAnswer={onAnswer} />}</div>)}
    </div>
  );
}
