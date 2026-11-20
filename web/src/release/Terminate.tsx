import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { plainError, statusText, type BatchDetail } from '../api-floor.js';
import { ReasonDialog } from '../floor/ReasonDialog.js';
import { terminatedText } from '../../../shared/engine/release.js';

// QA terminates a batch that cannot be finished (owner, 16 Nov 2026): a reason, and for each lot the batch used how
// much went back to stores unused (the rest counts as used; material_use_v1 gives the returned part back to MMS), then
// a signature meaning "rejected". The record is kept; no more actions; its machines and rooms are freed
// (equipment_use_v1). On the batch screen and the QA "To review" list; the batch is read when the window opens, and the
// signature covers it as read then. Its windows open over the whole page (a portal), not inside the row or card that
// holds the button: a row on the To review list moves on hover, which would hold a fixed window inside its card.
export function Terminate({ id, batchNo, onDone }: { id: number; batchNo: string; onDone: () => Promise<void> | void }) {
  const [step, setStep] = useState<'reason' | 'sign' | null>(null);
  const [reason, setReason] = useState('');
  const [d, setD] = useState<BatchDetail | null>(null);
  const [back, setBack] = useState<string[]>([]);
  const [error, setError] = useState('');
  const close = () => { setStep(null); setD(null); };
  const open = async () => {
    setError('');
    try {
      const b = await api<BatchDetail>('GET', `/api/batches/${id}`);
      setD(b); setBack(b.batch.issued.map(() => '')); setStep('reason');
    } catch (e) { setError(plainError(e)); }
  };
  const lots = d?.batch.issued ?? [];
  const returns = lots.map((l, i) => ({ lot: l.lot, value: back[i]!.trim(), unit: l.unit }));
  return (<>
    <button type="button" className="big soft-bad" onClick={() => void open()}>Terminate batch</button>
    {error && <p className="notice bad" role="alert">{error}</p>}
    {step && d && createPortal(<>{step === 'reason' && (
      <ReasonDialog title={`Terminate batch ${batchNo}`} label="Reason for terminating" submit="Continue to sign" onCancel={close} wide
        hint="The batch stops here and is rejected. Its record is kept; no step can be recorded any more, and its machines and rooms are freed."
        onSubmit={async (why) => {
          const missing = lots.filter((_, i) => !/^\d+(\.\d+)?$/.test(back[i]!.trim()));
          if (missing.length) throw new Error(`Say how much of lot ${missing.map((l) => l.lot).join(', ')} went back to stores unused: 0 if none.`);
          setReason(why); setStep('sign');
        }}>
        {lots.length > 0 && (
          <fieldset className="returns" aria-label="Back to stores">
            <legend>Back to stores unused</legend>
            <p className="muted small">For each lot this batch used: how much went back to stores unused. The rest counts as used (destroyed or in the batch).</p>
            {lots.map((l, i) => (
              <label key={`${l.lot}-${l.unit}`}><span>Lot {l.lot}{l.material && ` · ${l.material}`} <small className="muted">(used {l.value} {l.unit})</small></span>
                <span className="num">
                  <input inputMode="decimal" autoComplete="off" aria-label={`Lot ${l.lot} back to stores`} value={back[i]} onChange={(e) => setBack(back.map((x, j) => (j === i ? e.target.value : x)))} />
                  <span className="unit">{l.unit}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </ReasonDialog>
    )}
    {step === 'sign' && (
      <SignDialog meaning="rejected" wide what={`Terminate batch ${batchNo} · ${d.master.doc.header.productName} (status now: ${statusText(d.batch.status)})`} onCancel={close}
        onSign={async ({ proof }) => { await api('POST', `/api/batches/${id}/terminate`, { proof, contentHash: d.batch.contentHash, reason, ...(lots.length ? { returns } : {}) }); close(); await onDone(); }}>
        <div className="summary-box">
          <p>Reason: <b>{reason}</b></p>
          {lots.length > 0 && <p>Back to stores unused: {returns.map((r, i) => <span key={i}>{i ? ', ' : ''}lot {r.lot} <b>{r.value} {r.unit}</b></span>)}; the rest counts as used.</p>}
        </div>
      </SignDialog>
    )}</>, document.body)}
  </>);
}

export { terminatedText };
