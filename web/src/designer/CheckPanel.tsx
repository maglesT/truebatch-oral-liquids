// Screen 5: the master check, always beside the designer. Each problem from shared/master/checks.ts links to its item.
// A calculation warning that needs an answer shows its answer controls (a choice and a reason) under it.
import { useState } from 'react';
import { blocking, type Problem } from '../../../shared/master/checks.js';
import type { MasterDoc, MasterState } from '../../../shared/master/schema.js';
import { placeLabel } from './model.js';

export type OnAnswer = (p: Problem, choice: string, reason: string) => void;

// An approved, effective or retired version is past review: a check added after its approval is not "to fix before
// review" but what a new version will need (an info line).
export function CheckPanel({ doc, state, problems, invalid, onGo, onAnswer }: { doc: MasterDoc; state?: MasterState; problems: Problem[] | null; invalid?: string; onGo: (path: string) => void; onAnswer?: OnAnswer }) {
  const past = state === 'approved' || state === 'effective' || state === 'retired';
  const later = past ? problems?.filter(blocking).length ?? 0 : 0;
  const errors = past ? 0 : problems?.filter((p) => p.level === 'error').length ?? 0;
  const open = past ? 0 : problems?.filter((p) => p.level === 'warning' && blocking(p)).length ?? 0;
  const warnings = problems?.filter((p) => p.level === 'warning' && !blocking(p)).length ?? 0;
  return (
    <aside className="check-panel" aria-label="Master check">
      <div className="cp-head">
        <h2>Master check</h2>
        {problems && (errors || open || warnings || later ? <span className={errors || open ? 'count bad' : 'count'}>{errors + open + warnings + later}</span> : null)}
      </div>
      {invalid ? <p className="cp-invalid">The master is checked once every entry is complete. {invalid}</p>
        : problems && !problems.length ? <p className="all-good small">✓ No problems. The master can be sent for review.</p>
        : problems && (
          <>
            {later ? <p className="muted small" role="note">ℹ️ Approved before {later === 1 ? 'this check' : 'these checks'} existed; a new version will need: {[...new Set(problems.filter(blocking).map((p) => placeLabel(doc, p.path)))].join(', ')} (ℹ️ below).{warnings ? ` · ${warnings} ⚠️ to look at` : ''}</p>
              : <p className="muted small">{errors ? `${errors} ⛔ to fix before review` : 'No ⛔'}{open ? ` · ${open} ⚠️ to answer before review` : ''}{warnings ? ` · ${warnings} ⚠️ to look at` : ''}</p>}
            <ul className="cp-list">
              {problems.map((p, i) => (
                <li key={i} className={past && blocking(p) ? 'info' : p.level}>
                  <button type="button" onClick={() => onGo(p.path)}>
                    <span className="cp-icon" aria-label={past && blocking(p) ? 'For a new version' : p.level === 'error' ? 'Error' : p.level === 'info' ? 'Information' : 'Warning'}>{past && blocking(p) || p.level === 'info' ? 'ℹ️' : p.level === 'error' ? '⛔' : '⚠️'}</span>
                    <span><span className="cp-where">{placeLabel(doc, p.path)}</span>{p.message}</span>
                  </button>
                  {p.question && <AnswerBox key={p.question.key} p={p} onAnswer={onAnswer} />}
                </li>
              ))}
            </ul>
          </>
        )}
    </aside>
  );
}

/** The answer to a calculation warning: shown when given; a choice and a reason to give it (authors of a draft only). */
export function AnswerBox({ p, onAnswer }: { p: Problem; onAnswer?: OnAnswer }) {
  const q = p.question!;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(q.answer?.choice ?? (q.options.length === 1 ? q.options[0]! : ''));
  const [reason, setReason] = useState(q.answer?.reason ?? '');
  if (q.answer && !editing) {
    return (
      <p className="cp-answer small">answered: <b>{q.answer.choice}</b>{q.answer.reason && <> · {q.answer.reason}</>}
        {onAnswer && <button type="button" className="link dark small" onClick={() => setEditing(true)}>Change</button>}</p>
    );
  }
  if (!onAnswer) return <p className="cp-answer small muted">Not answered yet.</p>;
  const ready = q.options.includes(choice) && (!q.needsReason || reason.trim() !== '');
  return (
    <form className="cp-answer" onSubmit={(e) => { e.preventDefault(); if (ready) { onAnswer(p, choice, reason); setEditing(false); } }}>
      <select aria-label="Answer" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {q.options.length > 1 && <option value="">Choose…</option>}
        {q.options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={q.needsReason ? 'Reason (required)' : 'Reason (optional)'} />
      <button type="submit" disabled={!ready}>Save answer</button>
    </form>
  );
}
