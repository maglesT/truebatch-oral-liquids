import { useEffect, useState } from 'react';
import { api, type Me } from '../api.js';
import { batchLink, go, plainError, STATE_LABEL, statusText, stepLink, timeLeft, useServerNow, type WorkBadge, type WorkItem } from '../api-floor.js';
import './floor.css';

// "My work": the batches in production the person may act on, the checks waiting for them (never their own work,
// TB-08), the next periodic check, timers that ran over and steps to sign again. Refreshed every 30 s.
export function MyWork({ me }: { me: Me }) {
  const [rows, setRows] = useState<WorkItem[] | null>(null);
  const [error, setError] = useState('');
  const [serverNow, setServerNow] = useState<string>();
  // The batches the person worked on that left production: the finished record stays one tap away.
  const [finished, setFinished] = useState<{ id: number; batchNo: string; productName: string; status: string }[]>([]);
  useEffect(() => { void api<typeof finished>('GET', '/api/batches/finished', undefined, true).then(setFinished, () => {}); }, []);
  const now = useServerNow(serverNow);

  useEffect(() => {
    let live = true;
    const load = (background: boolean) => Promise.all([api<WorkItem[]>('GET', '/api/batches', undefined, background), api<{ serverTime: string }>('GET', '/api/health', undefined, true)])
      .then(([r, h]) => { if (live) { setRows(r); setServerNow(h.serverTime); setError(''); } }, (e) => live && setError(plainError(e)));
    void load(false);
    const t = setInterval(() => void load(true), 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const checks = (rows ?? []).flatMap((b) => b.badges.filter((x) => x.kind === 'check').map((x) => ({ b, x })));
  const count = (k: WorkBadge['kind']) => (rows ?? []).reduce((n, b) => n + b.badges.filter((x) => x.kind === k).length, 0);

  return (
    <div className="fl">
      <h1>My work</h1>
      <p className="greeting">Signed in as {me.fullName}. Times are plant time (IST).</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {rows === null && !error ? (
        <div aria-label="Loading my work">
          <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><div className="skel skel-line w60" /><div className="skel skel-line w40" /></div>)}</div>
          <div className="dash-panel"><div className="skel skel-line w30" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>
        </div>
      ) : rows && (
        <>
          <div className="kpis">
            <div className={`kpi ${checks.length ? 'warn' : 'ok'}`}><b>{checks.length}</b><span>Waiting for your check</span></div>
            <div className={`kpi ${count('late') ? 'bad' : 'ok'}`}><b>{count('late')}</b><span>Timers exceeded</span></div>
            <div className={`kpi ${count('resign') ? 'warn' : 'ok'}`}><b>{count('resign')}</b><span>To sign again (input changed)</span></div>
            <div className="kpi info"><b>{rows.length}</b><span>Batches for you</span></div>
          </div>
          {checks.length > 0 && (
            <section className="dash-panel" aria-label="Waiting for your check">
              <div className="panel-head"><h2>Waiting for your check</h2><span className="pill warn">{checks.length}</span>
                <span className="muted">steps done by someone else; you were not involved</span></div>
              <div className="pending-list">
                {checks.map(({ b, x }) => (
                  <button key={`${b.id}-${x.step}`} className="pending-row check" onClick={() => go(stepLink(b.id, x.step!))}>
                    <span className="age-dot check" aria-hidden="true" />
                    <span className="pending-what"><strong>{x.title}</strong><small>{b.batchNo} · {b.productName} · {x.stage}</small></span>
                    <span className="pending-go">Check →</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="dash-panel" aria-label="Batches in progress">
            <div className="panel-head"><h2>Batches in progress</h2><span className="pill">{rows.length}</span></div>
            {rows.length === 0 ? <p className="all-good"><span aria-hidden="true">✓</span> Nothing waiting for you.</p> : (
              <div className="pending-list">
                {rows.map((b) => {
                  const late = b.badges.some((x) => x.kind === 'late');
                  return (
                    <button key={b.id} className={late ? 'pending-row late' : 'pending-row'} onClick={() => go(batchLink(b.id))}>
                      <span className={late ? 'age-dot late' : 'age-dot'} aria-hidden="true" />
                      <span className="pending-what">
                        <strong>{b.batchNo} · {b.productName}</strong>
                        <small>{b.current ? `${b.current.stage} · ${b.current.title} · ${STATE_LABEL[b.current.state][0]}` : statusText(b.status, true)} · stage {Math.min(b.stagesClosed + 1, b.stageCount)} of {b.stageCount}</small>
                        {b.badges.length > 0 && <span className="pending-badges">{b.badges.map((x, i) => <Badge key={i} x={x} now={now} />)}</span>}
                      </span>
                      <span className="pending-go">Open →</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          {finished.length > 0 && (
            <section className="dash-panel" aria-label="Finished on the floor">
              <div className="panel-head"><h2>Finished on the floor</h2><span className="muted">batches you worked on, now with production, QC or QA</span></div>
              <div className="pending-list">
                {finished.map((b) => (
                  <button key={b.id} className="pending-row" onClick={() => go(batchLink(b.id))}>
                    <span className="age-dot" aria-hidden="true" />
                    <span className="pending-what"><strong>{b.batchNo} · {b.productName}</strong><small>{statusText(b.status, true)}</small></span>
                    <span className="pending-go">Open →</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Badge({ x, now }: { x: WorkBadge; now: number }) {
  const left = x.at ? Date.parse(x.at) - now : 0;
  switch (x.kind) {
    case 'check': return <span className="chip chip-warn">Waiting for your check</span>;
    case 'resign': return <span className="chip chip-warn">Needs re-sign (input changed)</span>;
    case 'approve': return <span className="chip chip-info">Ready for production approval</span>;
    case 'due': return <span className={`chip ${left < 5 * 60_000 ? 'chip-warn' : 'chip-info'}`}>{left > 0 ? `${x.title} due in ${timeLeft(left)}` : `${x.title} due now`}</span>;
    case 'late': return <span className="chip chip-bad">{x.timer === 'hold' ? 'Hold time exceeded' : `${x.title} overdue`}</span>;
  }
}
