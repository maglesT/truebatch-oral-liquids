import { useEffect, useState } from 'react';
import { api, can, type Me } from '../api.js';
import { batchLink, go, plainClock, plainError, releaseLink, statusText } from '../api-floor.js';
import { Terminate } from './Terminate.js';
import '../floor/floor.css';
import './release.css';

interface ReviewItem {
  id: number; batchNo: string; productCode: string; productName: string; status: string; waiting: 'QC' | 'QA' | 'production';
  since: string; by: string; openDeviations: number; actions: string[];
}

// "To review": QC sees the production-approved batches, QA the QC-approved ones waiting for release (TB-21), and the
// batches still in production, which QA may terminate.
export function ToReview({ me }: { me: Me }) {
  const [rows, setRows] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = (background: boolean) => api<ReviewItem[]>('GET', '/api/batches/to-review', undefined, background)
      .then((r) => { if (live) { setRows(r); setError(''); } }, (e) => live && setError(plainError(e)));
    void load(false);
    const t = setInterval(() => void load(true), 30_000);
    return () => { live = false; clearInterval(t); };
  }, [tick]);

  const groups = ([['QC', 'Waiting for QC approval', 'production approved; QC signs with the QC report number', can(me, 'qc.approve')],
    ['QA', 'Waiting for QA release', 'QC approved; QA reviews the record and its audit trail, then releases or rejects', can(me, 'qa.release')],
    ['production', 'In production', 'QA may terminate a batch that cannot be finished: it is rejected, its record kept', can(me, 'qa.release')]] as const)
    .filter(([, , , mine]) => mine);
  return (
    <div className="fl">
      <h1>To review</h1>
      <p className="greeting">Batches waiting for your decision. Times are plant time (IST).</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {rows === null && !error ? (
        <div className="dash-panel" aria-label="Loading"><div className="skel skel-line w30" />{[0, 1].map((i) => <div key={i} className="skel skel-row" />)}</div>
      ) : rows && groups.map(([who, title, sub]) => {
        const mine = rows.filter((r) => r.waiting === who);
        return (
          <section key={who} className="dash-panel" aria-label={title}>
            <div className="panel-head"><h2>{title}</h2><span className="pill">{mine.length}</span><span className="muted">{sub}</span></div>
            {mine.length === 0 ? <p className="all-good"><span aria-hidden="true">✓</span> Nothing waiting.</p> : (
              <div className="pending-list">
                {mine.map((b) => b.waiting === 'production' ? (
                  <div key={b.id} className="pending-row">
                    <span className="age-dot" aria-hidden="true" />
                    <span className="pending-what">
                      <strong><a href={batchLink(b.id)}>{b.batchNo} · {b.productName}</a></strong>
                      <small>{b.productCode} · {statusText(b.status)}, issued {plainClock(b.since)}</small>
                    </span>
                    {b.actions.includes('terminate') && <Terminate id={b.id} batchNo={b.batchNo} onDone={() => setTick((n) => n + 1)} />}
                  </div>
                ) : (
                  <button key={b.id} className={b.openDeviations ? 'pending-row late' : 'pending-row'} onClick={() => go(releaseLink(b.id))}>
                    <span className={b.openDeviations ? 'age-dot late' : 'age-dot'} aria-hidden="true" />
                    <span className="pending-what">
                      <strong>{b.batchNo} · {b.productName}</strong>
                      <small>{b.productCode} · {statusText(b.status)} by {b.by}, {plainClock(b.since)}</small>
                      <span className="pending-badges">
                        {b.openDeviations > 0 && <span className="chip chip-bad">{b.openDeviations} open deviation{b.openDeviations === 1 ? '' : 's'}</span>}
                        {b.actions.some((a) => a !== 'terminate') && <span className="chip chip-ok">Ready for your signature</span>}
                      </span>
                    </span>
                    <span className="pending-go">Review →</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
