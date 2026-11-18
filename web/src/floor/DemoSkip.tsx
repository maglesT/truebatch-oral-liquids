import { useState } from 'react';
import { api, can, type Me } from '../api.js';
import { plainClock, plainError, type BatchDetail, type StepRow } from '../api-floor.js';
import { skipKey, skippable } from '../../../shared/engine/batch.js';

// Demo installations only (server/demo.ts): "Skip wait (demo)" for each wait running on this step, or, on the batch
// overview, in the whole batch. Absent elsewhere, and for people without the demo permission.
export function DemoSkip({ me, d, row, reload }: { me: Me; d: BatchDetail; row?: StepRow; reload: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me.demo || !can(me, 'demo.skip')) return null;
  const mine = (k: StepRow['key']) => !row || (k.stage === row.key.stage && k.sub === row.key.sub && k.step === row.key.step && k.round === row.key.round);
  const waits = d.timers.filter((t) => skippable(t) && mine(skipKey(t)));
  if (!waits.length) return null;
  const skip = async (timer: string) => {
    setBusy(true);
    try { await api('POST', `/api/batches/${d.batch.id}/demo-skip`, { timer }); setError(''); } catch (e) { setError(plainError(e)); }
    await reload();
    setBusy(false);
  };
  return (
    <div className="alerts" aria-label="Demo">
      {error && <p className="notice bad" role="alert">{error}</p>}
      {waits.map((t) => (
        <div key={t.id} className="fl-alert warn"><span className="tag">DEMO</span><span>{t.label}<small>due {plainClock(t.at)}</small></span>
          <button className="big" disabled={busy} onClick={() => void skip(t.id)}>Skip wait (demo)</button></div>
      ))}
    </div>
  );
}
