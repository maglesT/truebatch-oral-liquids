import { useState } from 'react';
import { api, can, type Me } from '../api.js';
import { plainClock, plainError, type ExceptionRow } from '../api-floor.js';
import { exceptionText } from '../../../shared/engine/release.js';
import { ReasonDialog } from '../floor/ReasonDialog.js';
import { SignDialog } from './SignDialog.js';
import '../release/release.css';

// Owner decision 20 Nov 2026: a deviation note written without a number is an exception of the batch record. A person
// holding the permission (granted per employee) closes it here, with a reason and an e-signature, or sends it to
// Deviations, which files it. The decision is shown afterwards to everyone.
export function Exceptions({ me, batchId, batchNo, exceptions, contentHash, deviationsLink, ended, stepName, onDone }: {
  me: Me; batchId: number; batchNo: string; exceptions: ExceptionRow[]; contentHash: string; deviationsLink: string; ended: boolean;
  stepName: (step: string) => string; onDone: (notice: string) => Promise<void>;
}) {
  const [closing, setClosing] = useState<ExceptionRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const may = can(me, 'exception.decide') && !ended;
  const send = async (x: ExceptionRow) => {
    setError('');
    try { await api('POST', `/api/batches/${batchId}/send-exception`, { note: x.note }); await onDone('The note is sent to Deviations, which files it.'); } catch (e) { setError(plainError(e)); }
  };
  if (!exceptions.length) return <p className="muted rv-none">No deviation note without a number.</p>;
  return (
    <>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <ul className="rv-list" aria-label="Exceptions">
        {exceptions.map((x) => (
          <li key={x.note} className={x.decision === 'closed' ? 'ok' : 'bad'}>
            <b>{x.where ?? stepName(x.step)}</b><span>{x.text}</span>
            <small>{exceptionText(x, plainClock)}</small>
            {may && x.decision === 'open' && <span className="ex-actions">
              <button onClick={() => { setReason(''); setClosing(x); }}>Close here…</button>
              {deviationsLink !== 'absent' && <button onClick={() => void send(x)}>Send to Deviations</button>}
            </span>}
          </li>
        ))}
      </ul>
      {closing && !reason && (
        <ReasonDialog title="Close the exception here" label="Reason for closing it here" hint={closing.text} submit="Next: sign"
          onCancel={() => setClosing(null)} onSubmit={async (r) => setReason(r)} />
      )}
      {closing && reason && (
        <SignDialog meaning="exception_closed" what={`Batch ${batchNo}: the deviation note is closed here, in the batch record, and not sent to Deviations.`}
          onCancel={() => setClosing(null)}
          onSign={async ({ proof }) => {
            await api('POST', `/api/batches/${batchId}/close-exception`, { proof, contentHash, note: closing.note, reason });
            setClosing(null);
            await onDone('The exception is closed here.');
          }}>
          <div className="summary-box"><p>Note: “{closing.text}”</p><p>Reason: {reason}</p></div>
        </SignDialog>
      )}
    </>
  );
}
