// Screen 7: review and approval. The version in plain sentences, stage by stage, or its changes from the previous
// version; comments; and the workflow (TB-02): the author sends it for review, a second person checks it or returns
// it, QA approves it with a change control number, then makes it effective (the previous effective one retires).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, can, plantTime, type Me } from '../api.js';
import { addComment, getReview, loadMasterData, reviewAction, STATE_LABEL, type MasterEvent, type ReviewAction, type ReviewData, type Version } from '../api-designer.js';
import { SignDialog } from '../components/SignDialog.js';
import { useLinked } from '../api-floor.js';
import type { MasterDoc } from '../../../shared/master/schema.js';
import { describeMaster, diffMasters, type DiffSection, type Units } from './describe.js';
import { placeLabel } from './model.js';

const EVENT_TEXT: Record<MasterEvent['kind'], string> = { submitted: 'Sent for review', passed: 'Checked (passed)', returned: 'Returned to the author', approved: 'Approved by QA', effective: 'Made effective', retired: 'Retired' };
const SIGNED: Partial<Record<ReviewAction, { meaning: string; what: string }>> = {
  submit: { meaning: 'prepared', what: 'You sign that you prepared this version and send it to a second person to check.' },
  pass: { meaning: 'checked', what: 'You sign that you checked this version, independently of its author, and found it correct.' },
  approve: { meaning: 'approved', what: 'You approve this version for use in production (QA).' },
};
const BUTTON: Record<ReviewAction, string> = { submit: 'Send for review', pass: 'Pass the check', return: 'Return to the author', approve: 'Approve', 'make-effective': 'Make effective' };

export function Review({ me, version, doc, blocked, onChanged, onGo }: {
  me: Me; version: Version; doc: MasterDoc; blocked: boolean; onChanged: () => Promise<void>; onOpen: (id: number) => void; onGo: (path: string) => void;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [view, setView] = useState<'plain' | 'changes'>('plain');
  const [doing, setDoing] = useState<ReviewAction | null>(null);
  const [cc, setCc] = useState('');
  const [ccDone, setCcDone] = useState(false);
  // QA-approved change controls in QMS, to pick from (empty without the link).
  const changes = useLinked<{ number: string; title: string | null; names: 'yes' | 'none' }>(doing === 'approve' ? `/api/change-controls?version=${version.id}` : null, 'changes');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const load = async () => setData(await getReview(version.id));
  useEffect(() => { void load(); }, [version.id, version.state]);
  // Master data's units of the materials, named as master data names them (nos for units); without it, as in the master.
  const [units, setUnits] = useState<Units>();
  useEffect(() => { void loadMasterData().then((md) => setUnits(new Map(md.materials.flatMap((m) => (m.unit?.trim() ? [[m.itemId, m.unit.trim()]] : [])))), () => {}); }, []);
  if (!data) return <div className="skel skel-block" />;

  const close = () => { setDoing(null); setCc(''); setCcDone(false); setReason(''); setError(''); };
  const done = async () => { close(); await onChanged(); await load(); };
  const run = async (action: ReviewAction, body: object) => {
    try { await reviewAction(version.id, action, body); await done(); }
    catch (e) { setError(e instanceof ApiError ? (e.problems[0] ?? e.message) : String(e)); }
  };
  const shown: ReviewAction[] = (['submit', 'pass', 'return', 'approve', 'make-effective'] as const).filter((a) =>
    data.actions.includes(a) || (a === 'submit' && version.state === 'draft' && can(me, 'master.author'))
    // QA who typed the change control by hand sees why another person makes the version effective.
    || (a === 'make-effective' && version.state === 'approved' && can(me, 'master.approve')));
  const sections: DiffSection[] = view === 'changes' && data.previous ? diffMasters(data.previous.doc, doc, units)
    : describeMaster(doc, units).map((s) => ({ ...s, change: 'same', lines: s.lines.map((l) => ({ ...l, change: 'same' })) }));
  const changed = data.previous ? diffMasters(data.previous.doc, doc).filter((s) => s.change !== 'same').length : 0;

  return (
    <div className="review">
      <div className="card review-bar">
        <div>
          <h2>Version {version.versionNo}: {STATE_LABEL[version.state]}</h2>
          <ol className="timeline">
            {data.events.map((e) => (
              <li key={e.id} className={e.kind}>
                <b>{EVENT_TEXT[e.kind]}</b> · {e.personName} · {plantTime(e.at)}
                {e.payload.changeControl && <> · change control <b>{e.payload.changeControl}</b></>}
                {e.payload.reason && <div className="muted">Reason: {e.payload.reason}</div>}
              </li>
            ))}
            {!data.events.length && <li className="muted">Not sent for review yet.</li>}
          </ol>
        </div>
        <div className="review-actions">
          {shown.map((a) => {
            const why = a === 'submit' && blocked ? 'Fix the ⛔ problems and answer the ⚠️ calculation checks of the master check first.' : data.refusals[a];
            return (
              <div key={a}>
                <button className={a === 'return' ? '' : 'primary'} disabled={!!why} onClick={() => { setError(''); setDoing(a); }}>{BUTTON[a]}</button>
                {why && <p className="muted small">{why}</p>}
              </div>
            );
          })}
          {!shown.length && <p className="muted small">Nothing for you to do on this version.</p>}
        </div>
      </div>

      <div className="subtabs">
        <button className={view === 'plain' ? 'on' : ''} onClick={() => setView('plain')}>Plain view</button>
        {data.previous && <button className={view === 'changes' ? 'on' : ''} onClick={() => setView('changes')}>Changes from version {data.previous.versionNo} ({changed} part{changed === 1 ? '' : 's'})</button>}
      </div>
      <div className="card plain-view">
        {sections.filter((s) => view === 'plain' || s.change !== 'same').map((s) => (
          <section key={s.key} className={`pv-section ${s.change}`}>
            <h3>{s.title}{s.change !== 'same' && <span className={`chg ${s.change}`}>{s.change}</span>}</h3>
            {s.lines.length ? s.lines.filter((l) => view === 'plain' || l.change !== 'same').map((l) => (
              <p key={l.key} className={`pv-line ${l.change}`}>
                {l.change !== 'same' && <span className={`chg ${l.change}`}>{l.change}</span>}{l.text}
                {l.was && <span className="was">Was: {l.was}</span>}
              </p>
            )) : <p className="muted">None.</p>}
          </section>
        ))}
        {view === 'changes' && changed === 0 && <p className="muted">No changes from version {data.previous?.versionNo}.</p>}
      </div>

      <Comments me={me} doc={doc} data={data} versionId={version.id} onAdded={load} onGo={onGo} />

      {doing && SIGNED[doing] && (doing !== 'approve' || ccDone) && (
        <SignDialog meaning={SIGNED[doing].meaning} what={SIGNED[doing].what} onCancel={close}
          onSign={async ({ proof }) => {
            const fresh = await getReview(version.id);
            await reviewAction(version.id, doing, { proof, contentHash: fresh.contentHash, ...(doing === 'approve' ? { changeControl: cc } : {}) });
            await done();
          }}>
          <div className="signbox">
            <p><b>{doc.header.productCode} {doc.header.productName}</b>, version {version.versionNo}, {doc.header.batchSize} tablets</p>
            {doing === 'approve' && <p>Change control number: <b>{cc}</b></p>}
          </div>
        </SignDialog>
      )}
      {doing === 'approve' && !ccDone && (
        <Dialog title="Approve: change control" onCancel={close} onSubmit={() => (cc.trim() ? setCcDone(true) : setError('Type the change control number.'))} submit="Continue to sign" error={error}>
          <label>Change control number<input autoFocus value={cc} onChange={(e) => setCc(e.target.value)} list="cc-picks" placeholder={changes.length ? 'Pick the change control from QMS' : 'e.g. CC-2026-014'} /></label>
          {changes.length > 0 && <datalist id="cc-picks">{changes.map((c) => <option key={c.number} value={c.number}>{c.title}</option>)}</datalist>}
          {changes.find((c) => c.number === cc.trim())?.names === 'none' && <p className="notice warn">QMS names no product for {cc.trim()}: check that it covers {doc.header.productCode} {doc.header.productName} before you sign.</p>}
          <p className="muted small">The QA-approved change control under which this version is introduced.{!changes.some((c) => c.number === cc.trim())
            && ' Without the QMS link it is typed, and another person makes the version effective.'}</p>
        </Dialog>
      )}
      {doing === 'return' && (
        <Dialog title="Return to the author" onCancel={close} onSubmit={() => (reason.trim() ? void run('return', { reason }) : setError('Say why.'))} submit="Return" error={error}>
          <label>Reason<textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </Dialog>
      )}
      {doing === 'make-effective' && (
        <Dialog title="Make effective" onCancel={close} onSubmit={() => void run('make-effective', {})} submit="Make effective" error={error}>
          <p>Version {version.versionNo} becomes the effective version: batches are issued from it. The version effective now, if any, is retired.</p>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({ title, children, onCancel, onSubmit, submit, error }: { title: string; children: React.ReactNode; onCancel: () => void; onSubmit: () => void; submit: string; error: string }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <form className="card dialog" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
        <h2>{title}</h2>
        {children}
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" type="submit">{submit}</button></div>
      </form>
    </div>
  );
}

function Comments({ me, doc, data, versionId, onAdded, onGo }: { me: Me; doc: MasterDoc; data: ReviewData; versionId: number; onAdded: () => Promise<void>; onGo: (path: string) => void }) {
  const [text, setText] = useState('');
  const [path, setPath] = useState('');
  const may = ['master.author', 'master.check', 'master.approve'].some((p) => can(me, p));
  const about = [['header', 'Header'], ...doc.formula.map((l, i) => [`formula[${i}]`, `Formula › ${l.name}`]),
    ...doc.stages.flatMap((s, i) => [[`stages[${i}]`, s.name], ...s.steps.map((_, j) => [`stages[${i}].steps[${j}]`, placeLabel(doc, `stages[${i}].steps[${j}]`)])])];
  return (
    <div className="card comments">
      <h2>Comments</h2>
      {data.comments.map((c) => (
        <div key={c.id} className="comment">
          <div className="muted small">{c.personName} · {plantTime(c.at)}{c.path && <> · about <button type="button" className="link dark small" onClick={() => onGo(c.path!)}>{placeLabel(doc, c.path)}</button></>}</div>
          <p>{c.text}</p>
        </div>
      ))}
      {!data.comments.length && <p className="muted">No comments.</p>}
      {may && (
        <form className="comment-form" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await addComment(versionId, text.trim(), path || undefined); setText(''); setPath(''); await onAdded(); }}>
          <label>Comment<textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="row">
            <select aria-label="Comment about" value={path} onChange={(e) => setPath(e.target.value)}>
              <option value="">About the whole version</option>{about.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
            </select>
            <button type="submit" disabled={!text.trim()}>Add comment</button>
          </div>
        </form>
      )}
    </div>
  );
}
