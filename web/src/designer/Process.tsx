// Screen 4: the process. Left: the stages in order. Middle: the steps of the selected stage, added from the block
// library. Right: the selected stage's or step's settings.
import { useState, type FormEvent } from 'react';
import type { MasterData } from '../api-designer.js';
import { findBlock } from '../../../shared/blocks/index.js';
import { stepTitle } from '../../../shared/engine/batch.js';
import type { MasterDoc, Stage, Step } from '../../../shared/master/schema.js';
import { move, newStage, searchBlocks, stageRoomChoices, stepFrom, type Place } from './model.js';
import { StepSettings } from './StepSettings.js';
import { ChipSet, Order } from './ui.js';

// What a step's flow means, in the step list.
const FLOW_NOTE: Record<Step['flow']['kind'], string> = { none: '', 'repeat-until': 'repeated until its check passes', 'optional-with-reason': 'optional', 'qa-hold': 'QA hold' };
const KIND_LABEL: Record<Stage['kind'], string> = { normal: 'Stage', preparation: 'Preparation', 'sub-batch': 'Sub-batches' };
// Rows that select an item are not buttons, so a read-only (disabled) form can still be browsed.
const pickable = (onPick: () => void) => ({ role: 'button', tabIndex: 0, onClick: onPick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } });

export function Process({ doc, onChange, md, place, onPlace, editable }: {
  doc: MasterDoc; onChange: (d: MasterDoc) => void; md: MasterData; place: Place; onPlace: (p: Place) => void; editable: boolean;
}) {
  const [library, setLibrary] = useState(false);
  const [q, setQ] = useState('');
  const si = Math.min(place.stage ?? 0, Math.max(doc.stages.length - 1, 0));
  const stage = doc.stages[si];
  const ti = place.step !== undefined && stage && place.step < stage.steps.length ? place.step : undefined;
  const setStages = (stages: Stage[]) => onChange({ ...doc, stages });
  const putStage = (s: Stage) => setStages(doc.stages.map((x, i) => (i === si ? s : x)));
  const setSteps = (steps: Step[]) => stage && putStage({ ...stage, steps });
  const select = (stageIndex: number, step?: number) => onPlace({ tab: 'process', stage: stageIndex, step });
  const addStage = () => { setStages([...doc.stages, newStage(`Stage ${doc.stages.length + 1}`, doc.stages.map((s) => s.key))]); select(doc.stages.length); };
  const addStep = (blockId: string) => {
    if (!stage) return;
    const b = findBlock({ id: blockId, version: Math.max(...searchBlocks('').filter((x) => x.id === blockId).map((x) => x.version)) })!;
    const at = ti === undefined ? stage.steps.length : ti + 1;
    const steps = [...stage.steps];
    steps.splice(at, 0, stepFrom(b, stage.steps.map((t) => t.key)));
    setSteps(steps); select(si, at); setLibrary(false); setQ('');
  };
  const roles = [...new Set(doc.stages.map((s) => s.role).filter(Boolean)
    .concat(['Production operator', 'Granulation operator', 'Compression operator', 'Coating operator', 'Packing operator', 'Packing supervisor', 'Warehouse officer']))];
  const machineTypes = [...new Set(md.equipment.filter((e) => e.active && e.type).map((e) => e.type!))].sort();
  // A stage with steps is removed after the app's own question (never the browser's confirm box).
  const [removing, setRemoving] = useState<number | null>(null);
  const removeStage = (i: number) => { setStages(doc.stages.filter((_, j) => j !== i)); select(Math.max(0, i - 1)); setRemoving(null); };

  return (
    <div className="process">
      <div className="card col stages-col">
        <div className="d-section-head"><h2>Stages</h2></div>
        <ol className="olist">
          {doc.stages.map((s, i) => (
            <li key={s.key} className={i === si ? 'on' : ''}>
              <span className="ol-main" {...pickable(() => select(i))} aria-current={i === si}><b>{i + 1}. {s.name}</b><small>{KIND_LABEL[s.kind]}{s.kind === 'sub-batch' && s.count ? ` × ${s.count}` : ''} · {s.steps.length} step{s.steps.length === 1 ? '' : 's'} · {s.roomTypes.length ? s.roomTypes.join(', ') : 'no rooms chosen'}</small></span>
              {editable && <Order index={i} count={doc.stages.length} what={s.name} onMove={(by) => { setStages(move(doc.stages, i, by)); select(i + by); }}
                onRemove={() => (s.steps.length ? setRemoving(i) : removeStage(i))} />}
            </li>
          ))}
        </ol>
        {!doc.stages.length && <p className="muted small">No stages yet.</p>}
        <button type="button" onClick={addStage}>+ Add a stage</button>
      </div>

      <div className="card col steps-col">
        {stage ? (
          <>
            <div className="d-section-head"><h2>Steps of {stage.name}</h2></div>
            <div className={ti === undefined ? 'stage-pick on' : 'stage-pick'} {...pickable(() => select(si))}>Stage settings</div>
            <ol className="olist">
              {stage.steps.map((t, j) => {
                const b = findBlock(t.block);
                return (
                  <li key={t.key} className={j === ti ? 'on' : ''}>
                    <span className="ol-main" {...pickable(() => select(si, j))} aria-current={j === ti}><b>{j + 1}. {b ? stepTitle(doc, t) : t.block.id}</b><small>{[t.checker && 'checked', t.critical && 'critical', FLOW_NOTE[t.flow.kind]].filter(Boolean).join(' · ')}</small></span>
                    {editable && <Order index={j} count={stage.steps.length} what={stepTitle(doc, t)} onMove={(by) => { setSteps(move(stage.steps, j, by)); select(si, j + by); }}
                      onRemove={() => { setSteps(stage.steps.filter((_, k) => k !== j)); select(si); }} />}
                  </li>
                );
              })}
            </ol>
            {library ? (
              <div className="library">
                <input className="search" autoFocus aria-label="Search the block library" placeholder="Search: weigh, mix, dry, yield…" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="pick-list">
                  {searchBlocks(q).map((b) => (
                    <button type="button" key={b.id} className="pick block-pick" onClick={() => addStep(b.id)}>
                      <b>{b.name}</b><span className="muted small">{b.instruction}</span>
                    </button>
                  ))}
                  {!searchBlocks(q).length && <p className="muted small">No block found.</p>}
                </div>
                <div className="actions"><button type="button" onClick={() => setLibrary(false)}>Close</button></div>
              </div>
            ) : <button type="button" onClick={() => setLibrary(true)}>+ Add a step</button>}
          </>
        ) : <p className="muted">Add a stage first.</p>}
      </div>

      {removing !== null && doc.stages[removing] && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Remove a stage">
          <form className="card dialog" onSubmit={(e: FormEvent) => { e.preventDefault(); removeStage(removing); }}>
            <h2>Remove {doc.stages[removing]!.name}?</h2>
            <p>The stage and its {doc.stages[removing]!.steps.length} steps are removed from this draft.</p>
            <div className="actions"><button type="button" onClick={() => setRemoving(null)}>Cancel</button><button className="primary" type="submit">Remove the stage</button></div>
          </form>
        </div>
      )}
      <div className="card col settings-col">
        {stage && ti !== undefined ? (
          <StepSettings key={`${si}/${stage.steps[ti]!.key}`} doc={doc} si={si} ti={ti} onChange={(t) => setSteps(stage.steps.map((x, k) => (k === ti ? t : x)))} />
        ) : stage ? (
          <StageForm doc={doc} si={si} stage={stage} onChange={putStage} roles={roles} machineTypes={machineTypes} md={md} />
        ) : null}
      </div>
    </div>
  );
}

function StageForm({ doc, si, stage, onChange, roles, machineTypes, md }: {
  doc: MasterDoc; si: number; stage: Stage; onChange: (s: Stage) => void; roles: string[]; machineTypes: string[]; md: MasterData;
}) {
  // Rooms are allowed by their area, or one by one by their code; the rooms where the stage's machines stand first.
  const rooms = stageRoomChoices(stage, md);
  const earlier = doc.stages.slice(0, si).filter((s) => s.produces);
  return (
    <div className="stage-form">
      <h2>Stage settings</h2>
      <label>Name<input value={stage.name} onChange={(e) => onChange({ ...stage, name: e.target.value })} /></label>
      <div className="form-grid">
        <label>Kind<select value={stage.kind} onChange={(e) => { const kind = e.target.value as Stage['kind']; const { count: _, ...rest } = stage; onChange(kind === 'sub-batch' ? { ...rest, kind, count: stage.count ?? 2 } : { ...rest, kind }); }}>
          <option value="normal">Normal stage</option><option value="preparation">Preparation (e.g. binder solution)</option><option value="sub-batch">Sub-batches (done several times)</option></select></label>
        {stage.kind === 'sub-batch' && <label>Number of sub-batches<input type="number" min={2} max={50} value={stage.count ?? 2} onChange={(e) => onChange({ ...stage, count: Number(e.target.value) })} /></label>}
        <label>Responsible role<input list="roles" value={stage.role} onChange={(e) => onChange({ ...stage, role: e.target.value })} /></label>
        <datalist id="roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
      </div>
      {/* TB-11: the machines and rooms the floor is offered stand in these rooms (balances also in a dispensing area). */}
      <ChipSet label="Rooms this stage may run in (an area, or a room)" values={stage.roomTypes} options={rooms.options} groups={rooms.groups} text={rooms.text} onChange={(roomTypes) => onChange({ ...stage, roomTypes })}
        empty="None chosen yet: choose the rooms (needed when the stage works machines or names a room)" />
      <ChipSet label="Allowed machine types" values={stage.machineTypes} options={machineTypes} onChange={(machineTypes) => onChange({ ...stage, machineTypes })} empty="Any machine type" />
      <fieldset className="checklist">
        <legend>Intermediate produced</legend>
        <label className="check"><input type="checkbox" checked={!!stage.produces} onChange={(e) => { const { produces: _, ...rest } = stage; onChange(e.target.checked ? { ...rest, produces: { name: '', holdHours: 24 } } : rest); }} />This stage produces an intermediate</label>
        {stage.produces && (
          <div className="form-grid">
            <label>Intermediate<input aria-label="Intermediate name" value={stage.produces.name} placeholder="e.g. dried granules" onChange={(e) => onChange({ ...stage, produces: { ...stage.produces!, name: e.target.value } })} /></label>
            <label>Hold time (hours)<input type="number" min={1} step="any" value={stage.produces.holdHours ?? ''}
              onChange={(e) => { const { holdHours: _, ...p } = stage.produces!; const h = Number(e.target.value); onChange({ ...stage, produces: e.target.value && h > 0 ? { ...p, holdHours: h } : p }); }} /></label>
          </div>
        )}
      </fieldset>
      {earlier.length > 0 && (
        <fieldset className="checklist">
          <legend>Uses the intermediate of</legend>
          {earlier.map((s) => (
            <label key={s.key} className="check"><input type="checkbox" checked={stage.uses.includes(s.key)}
              onChange={(e) => onChange({ ...stage, uses: e.target.checked ? [...stage.uses, s.key] : stage.uses.filter((k) => k !== s.key) })} />{s.name} ({s.produces!.name})</label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
