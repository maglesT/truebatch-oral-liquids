import { useState, type FormEvent, type ReactNode } from 'react';
import { plainError } from '../api-floor.js';

// A reason (send back, correct, not applicable) or a deviation note, with an optional reference for a note.
export function ReasonDialog({ title, label, hint, reference, options = [], submit, children, wide, onSubmit, onCancel }: {
  title: string; label: string; hint?: string; reference?: boolean; submit: string; children?: ReactNode; wide?: boolean;
  // The deviations the Deviations system has for this batch, to pick from.
  options?: { number: string; title: string | null }[];
  onSubmit: (reason: string, reference: string) => Promise<void>; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError(`${label}: please write it.`);
    setBusy(true);
    setError('');
    try { await onSubmit(reason.trim(), ref.trim()); } catch (err) { setError(plainError(err)); setBusy(false); }
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <form className={`card dialog fl${wide ? ' wide' : ''}`} onSubmit={send}>
        <h2>{title}</h2>
        {hint && <p className="muted">{hint}</p>}
        {children}
        <label>{label}<textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus={!children} /></label>
        {reference && <label>Deviation number (if one was raised)<input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} list="deviation-picks"
          placeholder={options.length ? 'Pick the deviation of this batch' : 'e.g. DEV-26-014'} /></label>}
        {reference && options.length > 0 && <datalist id="deviation-picks">{options.map((o) => <option key={o.number} value={o.number}>{o.title}</option>)}</datalist>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="big" onClick={onCancel}>Cancel</button>
          <button className="big primary" type="submit" disabled={busy}>{submit}</button>
        </div>
      </form>
    </div>
  );
}
