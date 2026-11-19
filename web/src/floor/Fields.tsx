import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { plainError, rawOf, valueText, type BlockField, type PickItem, type Value } from '../api-floor.js';

type Raw = string | string[];
// A QC result picked from LIMS (shared/engine/lims.ts): the result's id, sent in place of a typed number.
type Pick = { lims: string };
/** A result of this batch's approved CoA in LIMS, as offered for a QC result field. */
export interface QcPick { resultId: string; coaNumber: string | null; testName: string | null; reported: string | null; unit: string | null; shown: string;
  individual?: string[] | null; figure?: string | null }
/**
 * Round 42: an in-process QC field (qc 'in_process') while LIMS answers: this step's lab request, the results that fit
 * the field (shared/engine/lims.ts inProcessFit) and, in words, why the others do not.
 */
export interface InProcessPicks { request: string; offered: QcPick[]; refused: string[] }
const FIGURE_WORD: Record<string, string> = { mean: 'mean', AV: 'AV' };

/**
 * One field as the block describes it. Live (onSave): a typed value is saved when the person leaves the field, a tap
 * on yes/no, a choice or a machine saves at once (TL-04). In a dialog (onChange) it only reports the value.
 */
export function FieldInput({ f, unit, saved, picks = [], note, options = [], results, inProcess, disabled, out, onSave, onChange }: {
  f: BlockField; unit: string; saved?: Value; picks?: PickItem[]; disabled?: boolean;
  // An in-process QC field (f.qc 'in_process') while LIMS answers (typing is refused then); undefined while LIMS is
  // absent or down, when it is typed from the QC report (a list: its readings, as before).
  inProcess?: InProcessPicks;
  // A QC result (f.qc) while LIMS answers: the results of this batch's approved CoAs to pick from (typing is refused
  // then); undefined while LIMS is absent or down, when it is typed from the QC report.
  results?: QcPick[];
  // A machine or room: why some of master data are not offered (shared/engine/picks.ts: untypedNote, inLogbook), each
  // reason its own line.
  note?: readonly (string | null)[] | string | null;
  // A lot: the lots a link offers, to pick from (typing stays possible when the link is absent or down).
  options?: string[];
  // Readings out of their band (from the results), shown red.
  out?: Set<number>;
  onSave?: (raw: Raw | Pick) => Promise<void>; onChange?: (raw: Raw | Pick) => void;
}) {
  const initial = rawOf(saved);
  const [raw, setRaw] = useState<Raw>(f.count && !Array.isArray(initial) ? Array<string>(f.count).fill('') : initial);
  const [status, setStatus] = useState<'' | 'saving' | 'saved'>('');
  const [error, setError] = useState('');
  const savedKey = JSON.stringify(initial);
  // A refusal is brought fully into view, above the sticky action bar (scroll-margin in floor.css).
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  useEffect(() => { setRaw(f.count && !Array.isArray(initial) ? Array<string>(f.count).fill('') : initial); }, [savedKey]);

  const set = (v: Raw) => { setRaw(v); setError(''); onChange?.(v); };
  const save = async (v: Raw | Pick) => {
    if (!onSave || JSON.stringify(v) === savedKey) return;
    setStatus('saving');
    try { await onSave(v); setStatus('saved'); } catch (e) { setStatus(''); setError(plainError(e)); }
  };
  const blurSave = () => typeof raw === 'string' && raw.trim() && void save(raw.trim());
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); };
  const tap = (v: string) => { set(v); void save(v); };
  const pick = (id: string) => { setRaw(id); setError(''); onChange?.({ lims: id }); void save({ lims: id }); };
  const id = `f-${f.name}`;
  const notes = (Array.isArray(note) ? note : [note]).filter((n): n is string => !!n);

  let input: ReactNode;
  if (f.qc === 'in_process' && inProcess) {
    input = <>
      {saved !== undefined && <div className="recorded"><span>{valueText(saved)}</span></div>}
      {inProcess.offered.length === 0
        ? <p className="muted">Waiting for LIMS: request {inProcess.request} (sample not yet approved).</p>
        : (
          <div className="picks" role="group" aria-label={f.label}>
            {inProcess.offered.map((r) => (
              <button key={r.resultId} type="button" className={raw === r.resultId ? 'on' : ''} aria-pressed={raw === r.resultId} disabled={disabled} onClick={() => pick(r.resultId)} title={r.shown}>
                <b>{r.individual ? `${r.individual.length} values${r.reported ? ` · ${FIGURE_WORD[r.figure ?? ''] ?? 'reported'} ${r.reported}` : ''}` : r.reported} {r.unit}</b>
                <small>{r.testName ?? 'Result'} · report {r.coaNumber}</small>
              </button>
            ))}
          </div>
        )}
      {inProcess.refused.map((n) => <p key={n} className="muted small">{n}</p>)}
    </>;
  } else if (f.kind === 'number' && f.count) {
    const list = raw as string[];
    const filled = list.filter((x) => x.trim()).length;
    const submit = (e: FormEvent) => { e.preventDefault(); void save(list.map((x) => x.trim())); };
    input = (
      <form className="readings-wrap" onSubmit={submit}>
        <div className="readings">
          {list.map((x, i) => (
            <label key={i}>{i + 1}
              <input inputMode="decimal" aria-label={`${f.label} ${i + 1}`} value={x} disabled={disabled} className={out?.has(i) ? 'out' : undefined}
                onChange={(e) => set(list.map((y, j) => (j === i ? e.target.value : y)))} />
            </label>
          ))}
        </div>
        {onSave && (
          <div className="readings-foot">
            <button className="big" type="submit" disabled={disabled || filled < list.length || JSON.stringify(list) === savedKey}>Save the {list.length} readings</button>
            <span className="muted">{filled} of {list.length} typed{unit ? ` (${unit})` : ''}</span>
          </div>
        )}
      </form>
    );
  } else if (f.qc === true && results) {
    input = results.length === 0
      ? <p className="muted">LIMS has no approved CoA of this batch with a result in {unit || 'this unit'} yet: it is picked here once QC has approved it in LIMS.</p>
      : (
        <div className="picks" role="group" aria-label={f.label}>
          {results.map((r) => (
            <button key={r.resultId} type="button" className={raw === r.resultId ? 'on' : ''} aria-pressed={raw === r.resultId} disabled={disabled} onClick={() => pick(r.resultId)} title={r.shown}>
              <b>{r.reported} {r.unit}</b><small>{r.testName ?? 'Result'} · CoA {r.coaNumber}</small>
            </button>
          ))}
        </div>
      );
  } else if (f.kind === 'number') {
    input = (
      <div className="num">
        <input id={id} inputMode="decimal" autoComplete="off" value={raw as string} disabled={disabled} onChange={(e) => set(e.target.value)} onBlur={blurSave} onKeyDown={enter} />
        {unit && <span className="unit">{unit}</span>}
      </div>
    );
  } else if (f.kind === 'yes-no' || f.kind === 'choice') {
    input = (
      <div className="toggle" role="group" aria-label={f.label}>
        {(f.kind === 'yes-no' ? ['yes', 'no'] : f.options ?? []).map((o) => (
          <button key={o} type="button" className={raw === o ? 'on' : ''} aria-pressed={raw === o} disabled={disabled} onClick={() => tap(o)}>{o === 'yes' ? 'Yes' : o === 'no' ? 'No' : o}</button>
        ))}
      </div>
    );
  } else if (f.kind === 'machine' || f.kind === 'room') {
    input = <>
      {picks.length === 0 ? !notes.length && <p className="muted">No {f.kind === 'room' ? 'room this stage allows' : `${f.label.toLowerCase()} of the types and rooms this stage allows`} is active in master data.</p> : (
        <div className="picks" role="group" aria-label={f.label}>
          {picks.map((p) => (
            <button key={p.itemId} type="button" className={raw === p.itemId ? 'on' : ''} aria-pressed={raw === p.itemId} disabled={disabled} onClick={() => tap(p.itemId)}>
              <b>{p.code}</b><small>{p.name}</small>
            </button>
          ))}
        </div>
      )}
      {notes.map((n) => <p key={n} className="muted small">{n}</p>)}
    </>;
  } else if (f.kind === 'timer') {
    input = onSave
      ? <div className="recorded">{saved !== undefined && <span>{valueText(saved)}</span>}<button type="button" className="big" disabled={disabled} onClick={() => void save('now')}>{saved === undefined ? 'Record the time now' : 'Record again'}</button></div>
      : <p className="muted">The server records the time when you save.</p>;
  } else {
    input = <>
      <input id={id} className="text" type={f.date ? 'date' : 'text'} autoComplete="off" value={raw as string} disabled={disabled} maxLength={f.kind === 'lot' ? 60 : 2000} list={options.length ? `${id}-list` : undefined}
        placeholder={f.kind === 'lot' ? (options.length ? 'Pick the lot from MMS' : 'Type the lot number from the label') : options.length ? 'Pick the CoA from LIMS' : undefined} onChange={(e) => set(e.target.value)} onBlur={blurSave} onKeyDown={enter} />
      {options.length > 0 && <datalist id={`${id}-list`}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
    </>;
  }
  return (
    <div className="fl-field">
      <label className="lbl" htmlFor={f.count || (f.qc === true && results) || (f.qc === 'in_process' && inProcess) || ['yes-no', 'choice', 'machine', 'room', 'timer'].includes(f.kind) ? undefined : id}>
        <span>{f.label}{f.optional && <small> (if it applies)</small>}</span>
        {status === 'saving' && <span className="saving">Saving…</span>}
        {status === 'saved' && <span className="saved">✓ Saved</span>}
      </label>
      {input}
      {error && <p ref={errorRef} className="field-error" role="alert">{error}</p>}
    </div>
  );
}
