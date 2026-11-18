import { useCallback, useEffect, useState } from 'react';
import { api, type Me } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { product } from '../product.js';
import {
  batchLink, changed, go, headline, pdfLink, plainClock, plainError, stateLabel, STATUS_CHIP, statusText, stepLink, stepOf, stepTitle, timeLeft, tone, useBlocks, words, useServerNow,
  type BatchDetail, type Block, type StepRow,
} from '../api-floor.js';
import { StepScreen } from './StepScreen.js';
import { DemoSkip } from './DemoSkip.js';
import { Terminate, terminatedText } from '../release/Terminate.js';
import { deviationText } from '../../../shared/engine/release.js';
import './floor.css';

// One batch on the floor: its header, the stages as a progress bar and the alerts, then the overview, one step, or
// production approval. Read again on every move between them (what others did shows at once) and after every action;
// a background poll every 20 s is the fallback.
export function BatchScreen({ me, id, step, approve }: { me: Me; id: number; step?: string; approve?: boolean }) {
  const [d, setD] = useState<BatchDetail | null>(null);
  const [error, setError] = useState('');
  const blocks = useBlocks();
  const reload = useCallback(async (background = false) => {
    try { setD(await api<BatchDetail>('GET', `/api/batches/${id}`, undefined, background)); setError(''); } catch (e) { setError(plainError(e)); }
  }, [id]);
  useEffect(() => setD(null), [id]);
  useEffect(() => { void reload(); }, [reload, step, approve]);
  useEffect(() => {
    const t = setInterval(() => void reload(true), 20_000);
    return () => clearInterval(t);
  }, [reload]);
  const now = useServerNow(d?.now);

  if (error && !d) return <div className="fl"><button className="back" onClick={() => go('#/')}>← My work</button><p className="notice bad" role="alert">{error}</p></div>;
  if (!d || !blocks) {
    return (
      <div className="fl" aria-label="Loading the batch">
        <div className="dash-panel"><div className="skel skel-line w40" /><div className="skel skel-line w60" /><div className="skel skel-block" /></div>
        <div className="dash-panel"><div className="skel skel-line w30" />{[0, 1, 2].map((i) => <div key={i} className="skel skel-row" />)}</div>
      </div>
    );
  }
  const row = step ? d.steps.find((s) => s.id === step) : undefined;
  return (
    <div className="fl">
      <button className="back" onClick={() => go(step || approve ? batchLink(id) : '#/')}>← {step || approve ? `Batch ${d.batch.batchNo}` : 'My work'}</button>
      {error && <p className="notice bad" role="alert">{error}</p>}
      {step ? (row ? <StepScreen me={me} d={d} blocks={blocks} row={row} now={now} reload={reload} /> : <p className="notice">This step is not open in the batch yet.</p>)
        : approve ? <Approval d={d} blocks={blocks} reload={reload} />
        : <><Overview d={d} blocks={blocks} now={now} reload={() => reload()} /><DemoSkip me={me} d={d} reload={() => reload()} /></>}
    </div>
  );
}

export function BatchHeader({ d }: { d: BatchDetail }) {
  const h = d.master.doc.header;
  // A packing batch: the bulk tablets issued to it (recorded at issue), not the master's standard packing batch.
  const issued = d.master.doc.pack ? d.steps.find((s) => s.id === '0.1.0.1')?.values.tablets : undefined;
  const tablets = issued && typeof issued === 'object' && 'value' in issued ? issued.value : undefined;
  return (
    <section className="dash-panel bh" aria-label="Batch">
      <div>
        <span className="bno">{d.batch.batchNo}</span>
        <h1>{h.productName}</h1>
        <div className="meta">
          <span>Product <b>{h.productCode}</b></span>
          {tablets ? <span>Bulk tablets issued <b>{Number(tablets).toLocaleString('en-IN')} tablets</b></span>
            : <span>Batch size <b>{Number(h.batchSize).toLocaleString('en-IN')} tablets</b></span>}
          <span>Master version <b>{d.master.versionNo}</b></span>
          <span>Issued <b>{plainClock(d.batch.issuedAt)}</b></span>
        </div>
      </div>
      <span className="bh-side">
        <span className={`chip ${STATUS_CHIP[d.batch.status] ?? ''}`}>{statusText(d.batch.status, true)}</span>
        <a className="button" href={pdfLink(d.batch.id)} download>{product.packing ? 'Packing record' : 'Batch record'} (PDF)</a>
      </span>
    </section>
  );
}

const finished = (s: StepRow) => ['done', 'checked', 'not_applicable'].includes(s.state);

function Overview({ d, blocks, now, reload }: { d: BatchDetail; blocks: Block[]; now: number; reload: () => Promise<void> }) {
  const at = d.stages.find((s) => s.open && !s.closed) ?? d.stages.find((s) => !s.closed);
  // A batch terminated, released or rejected runs no more: no stage is "now"; one left unclosed says Terminated.
  const ended = !!d.batch.terminated || ['released', 'rejected'].includes(d.batch.status);
  const current = ended ? undefined : at;
  const [shown, setShown] = useState(at?.index ?? 0);
  const doc = d.master.doc;
  const title = (s: StepRow) => stepTitle(doc, blocks, stepOf(doc, s.key));
  const stage = doc.stages[shown]!;
  const steps = d.steps.filter((s) => s.key.stage === shown);
  return (
    <>
      <BatchHeader d={d} />
      {d.batch.terminated && <p className="notice bad" role="note"><b>{terminatedText(d.batch.terminated, plainClock)}</b></p>}
      <nav className="stagebar" aria-label="Stages">
        {d.stages.map((s) => (
          <button key={s.key} className={`${s.closed ? 'closed' : s === current ? 'current' : ''}${s.index === shown ? ' on' : ''}`} onClick={() => setShown(s.index)} aria-pressed={s.index === shown}>
            <small>{s.closed ? '✓ Closed' : ended ? 'Terminated' : s === current ? 'Now' : s.open ? 'Open' : 'Waiting'}</small><span>{s.name}</span>
          </button>
        ))}
      </nav>
      <Alerts d={d} blocks={blocks} now={now} />
      <section className="dash-panel" aria-label={`Stage ${stage.name}`}>
        <div className="panel-head"><h2>{stage.name}</h2><span className="muted">{stage.kind === 'sub-batch' ? `${stage.count} sub-batches · ` : ''}{steps.filter(finished).length} of {steps.length} steps finished</span></div>
        {!d.batch.terminated && d.stages[shown]!.blocked && <p className="notice">{d.stages[shown]!.blocked}</p>}
        <div className="steplist">
          {steps.map((s) => {
            const st = stepOf(doc, s.key);
            const rounds = st.flow.kind === 'repeat-until';
            return (
              <button key={s.id} className={`step-row st-${s.state}`} onClick={() => go(stepLink(d.batch.id, s.id))}>
                <span className="n">{s.key.step + 1}</span>
                <span>{title(s)}{(rounds || stage.kind === 'sub-batch') && <small>{stage.kind === 'sub-batch' ? `Sub-batch ${s.key.sub}` : ''}{rounds ? ` Round ${s.key.round}` : ''}</small>}
                  {s.blocked && !d.batch.terminated && <small>{s.blocked}</small>}
                  {d.batch.deviations.filter((x) => x.step === s.id).map((x) => <small key={x.note} className={x.open ? 'dev-open' : undefined}>Deviation {deviationText(x)}</small>)}</span>
                <span className={`chip ${s.needsResign ? 'chip-warn' : stateLabel(s.state, d.batch.terminated)[1]}`}>{s.needsResign ? 'Sign again' : stateLabel(s.state, d.batch.terminated)[0]}</span>
                <span className="go" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      </section>
      {!d.batch.terminated && <section className="dash-panel" aria-label="Production approval">
        <div className="panel-head"><h2>Production approval</h2><span className="muted">when every stage is closed</span></div>
        <button className="big" onClick={() => go(`${batchLink(d.batch.id)}/approve`)}>{d.batch.status === 'manufacturing complete' ? 'Review and approve the record' : 'See what is still open'}</button>
      </section>}
      {d.batch.actions.includes('terminate') && (
        <section className="dash-panel" aria-label="Terminate the batch">
          <div className="panel-head"><h2>Terminate the batch (QA)</h2><span className="muted">when the batch cannot be finished: it is rejected, its record kept</span></div>
          <Terminate id={d.batch.id} batchNo={d.batch.batchNo} onDone={reload} />
        </section>
      )}
    </>
  );
}

/** Timers, waiting checks, steps whose input changed, open deviation notes: each one opens its step. */
export function Alerts({ d, blocks, now, only }: { d: BatchDetail; blocks: Block[]; now: number; only?: string }) {
  const doc = d.master.doc;
  const title = (key: StepRow['key']) => stepTitle(doc, blocks, stepOf(doc, key));
  const id = (k: StepRow['key']) => `${k.stage}.${k.sub}.${k.step}.${k.round}`;
  const items: { tone: string; tag: string; text: string; sub?: string; step?: string; at?: number }[] = [];
  // On the step screen the step shows its next periodic check itself.
  for (const t of d.timers.filter((x) => !only || x.kind !== 'periodic')) {
    const left = Date.parse(t.at) - now;
    // A minimum time or a mixing time is never late; a wait skipped in a demo installation is due from the skip (server/demo.ts).
    const least = t.kind === 'minimum' || t.kind === 'duration';
    const late = t.state === 'late' || (!least && !t.skipped && left < 0);
    // The periodic timer belongs to the next round; it is shown on the round that started it.
    const prev = t.kind === 'periodic' ? id({ ...t.key, round: t.key.round - 1 }) : id(t.key);
    items.push({ tone: late ? 'bad' : t.state === 'due soon' || t.state === 'due' ? 'warn' : 'info', tag: t.kind === 'hold' ? (late ? 'Hold time exceeded' : 'Hold time') : t.kind === 'periodic' ? (late ? 'Check overdue' : 'Next check') : 'Minimum time',
      text: t.label, sub: t.skipped ? `DEMO: wait skipped, ${plainClock(t.skipped.at)}` : late ? `Ran out ${plainClock(t.at)}: a deviation note is needed` : least ? `Can be ${t.kind === 'duration' ? 'ended' : 'finished'} from ${plainClock(t.at)}` : `Due ${plainClock(t.at)}`,
      step: t.kind === 'hold' ? undefined : prev, at: late || t.skipped || (least && left <= 0) ? undefined : left });
  }
  // The step screen explains these itself; a terminated batch has no check or signature still to come.
  for (const s of only || d.batch.terminated ? [] : d.steps) {
    if (s.state === 'done_awaiting_check') items.push({ tone: 'warn', tag: 'Waiting for check', text: title(s.key), sub: 'A second person checks this step on their own device', step: s.id });
    if (s.inputChanged.length) items.push({ tone: 'warn', tag: 'Input changed', text: title(s.key), sub: 'A value this step used was corrected: sign it again', step: s.id });
  }
  for (const v of d.batch.deviations.filter((x) => x.open)) items.push({ tone: 'bad', tag: 'Open deviation', text: `${deviationText(v)}: ${v.text}`, step: v.step });
  const shown = only ? items.filter((x) => x.step === only) : items;
  if (!shown.length) return only ? null : <p className="all-good"><span aria-hidden="true">✓</span> No alerts on this batch.</p>;
  return (
    <div className="alerts" aria-label="Alerts">
      {shown.map((x, i) => {
        const body = (<><span className="tag">{x.tag}</span><span>{x.text}{x.sub && <small>{x.sub}</small>}</span>{x.at !== undefined ? <span className="countdown">in {timeLeft(x.at)}</span> : <span />}</>);
        return only || !x.step
          ? <div key={i} className={`fl-alert ${x.tone}`}>{body}</div>
          : <button key={i} className={`fl-alert ${x.tone}`} onClick={() => go(stepLink(d.batch.id, x.step!))}>{body}</button>;
      })}
    </div>
  );
}

// TB-20: production signs only a complete record. The list of what is still open comes from the server; step ids are
// shown as the step's name.
function Approval({ d, blocks, reload }: { d: BatchDetail; blocks: Block[]; reload: (b?: boolean) => Promise<void> }) {
  const [signing, setSigning] = useState(false);
  const [notice, setNotice] = useState('');
  const doc = d.master.doc;
  // The stage yield (from the stage-yield step), as signed.
  const stageYield = (i: number) => d.steps.filter((x) => x.key.stage === i && x.results.yield?.ok).map((x) => {
    const r = x.results.yield!;
    return ` · yield ${headline(r)}${tone(r) === 'bad' ? ' (out of limits)' : tone(r) === 'ok' ? ' (within limits)' : ''}${doc.stages[i]!.kind === 'sub-batch' ? ` in sub-batch ${x.key.sub}` : ''}`;
  }).join('');
  const can = d.batch.actions.includes('production-approve');
  const problems = [...d.batch.open, ...d.batch.late].map(words);
  // Demo installations only: the waits ended at once, said to production as QA's review says them.
  const skips = d.steps.flatMap((s) => s.events.filter((e) => e.kind === 'demo_wait_skipped').map((e) => ({ s, e })));
  const sign = async ({ proof }: { proof: string }) => {
    try {
      await api('POST', `/api/batches/${d.batch.id}/production-approve`, { proof, contentHash: d.batch.contentHash });
      setSigning(false);
      setNotice('Production approval signed. The record is now closed to changes.');
      await reload();
    } catch (e) {
      if (!changed(e)) throw e;
      setSigning(false);
      setNotice('The record changed while you were signing (someone recorded or checked a step). It has been reloaded: review it and sign again.');
      await reload();
    }
  };
  return (
    <>
      <BatchHeader d={d} />
      <section className="dash-panel" aria-label="Production approval">
        <div className="panel-head"><h2>Production approval</h2><span className="muted">the record must be complete before production signs</span></div>
        {notice && <p className="notice info" role="status">{notice}</p>}
        <h3>Completeness</h3>
        <ul className="checklist-plain">
          {d.stages.map((s) => <li key={s.key} className={s.closed ? 'ok' : 'no'}><i>{s.closed ? '✓' : '✕'}</i><span>Stage {s.name} {s.closed ? 'closed' : 'not closed'}{stageYield(s.index)}</span></li>)}
          <li className={d.batch.late.length ? 'no' : 'ok'}><i>{d.batch.late.length ? '✕' : '✓'}</i><span>{d.batch.late.length ? 'A timer ran over without a deviation note' : 'Every timer that ran over has a deviation note'}</span></li>
          {skips.length > 0 && <li className="no"><i>!</i><span>DEMO: {skips.length} wait{skips.length === 1 ? '' : 's'} skipped (QA sees them in the review)
            {skips.map(({ s, e }) => <small key={e.id} className="muted" style={{ display: 'block' }}>{doc.stages[s.key.stage]!.name} › {stepTitle(doc, blocks, stepOf(doc, s.key))}: {String(e.payload.label ?? '')}, by {e.personName}, {plainClock(e.at)}</small>)}</span></li>}
        </ul>
        {d.batch.deviations.length > 0 && (<>
          <h3>Deviation notes</h3>
          <ul className="checklist-plain">{d.batch.deviations.map((x) => <li key={x.note} className={x.open ? 'no' : 'ok'}><i>{x.open ? '!' : '✓'}</i><span><b>{deviationText(x)}</b> {x.text}{x.open && !x.status ? ' (QA closes it before release)' : ''}</span></li>)}</ul>
        </>)}
        {d.batch.status === 'in production' && problems.length > 0 && (
          <div className="notice" role="note"><p><b>Not ready for production approval yet:</b></p><ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
        )}
        {d.batch.status === 'manufacturing complete' && !can && <p className="notice">{problems.length ? problems.join(' ') : 'Production approval needs the production supervisor permission.'}</p>}
        {!['in production', 'manufacturing complete'].includes(d.batch.status) && <p className="all-good"><span aria-hidden="true">✓</span> The record is {statusText(d.batch.status)}.</p>}
        {can && <div className="action-bar"><p className="why">Every stage is closed. Your signature means: the record is complete and correct.</p>
          <button className="big primary" onClick={() => setSigning(true)}>Sign: production approved</button></div>}
      </section>
      {signing && (
        <SignDialog meaning="production_approved" what={`Batch ${d.batch.batchNo} · ${doc.header.productName}: the ${product.packing ? 'packing' : 'batch'} record is complete.`} onCancel={() => setSigning(false)} onSign={sign}>
          <div className="summary-box"><p>{d.stages.length} stages closed · {d.steps.length} steps · {d.batch.deviations.length} deviation notes ({d.batch.deviations.filter((x) => x.open).length} open)</p></div>
        </SignDialog>
      )}
    </>
  );
}
