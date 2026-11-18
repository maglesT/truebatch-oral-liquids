// The master designer: one version open, in tabs (header, formula, process, calculation preview, review), with the
// master check always beside it. A draft saves itself as it is edited; other states are read only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, can, type Me } from '../api.js';
import { getVersion, listMasters, loadMasterData, saveVersion, STATE_CHIP, STATE_LABEL, type MasterData, type MasterRow, type Version } from '../api-designer.js';
import { blocking, masterChecks } from '../../../shared/master/checks.js';
import { placeChecks } from '../../../shared/master/places.js';
import { masterSchema, type MasterDoc } from '../../../shared/master/schema.js';
import { CheckPanel, type OnAnswer } from './CheckPanel.js';
import { FormulaTable } from './Formula.js';
import { HeaderFields } from './Header.js';
import { answerDoc, placeOf, type Place } from './model.js';
import { Preview } from './Preview.js';
import { Process } from './Process.js';
import { Review } from './Review.js';
import { PackFields, PackMaterials } from './Pack.js';
import { product } from '../product.js';

export type Tab = 'header' | 'formula' | 'process' | 'preview' | 'review';
// A packing master: the pack and its packing materials instead of the header and formula, and no calculation preview.
const TABS: [Tab, string][] = product.packing ? [['header', 'Pack'], ['formula', 'Packing materials'], ['process', 'Process'], ['review', 'Review and approval']]
  : [['header', 'Header'], ['formula', 'Formula'], ['process', 'Process'], ['preview', 'Calculation preview'], ['review', 'Review and approval']];
type Save = { kind: 'saved' | 'saving' | 'pending' } | { kind: 'invalid' | 'error'; message: string };

const FIELD: Record<string, string> = { mgPerTablet: 'mg per tablet', batchSize: 'batch size', coreWeightMg: 'core weight', coatedWeightMg: 'coated weight', name: 'name', key: 'key', holdHours: 'hold time', count: 'number of sub-batches' };
function issueText(doc: MasterDoc, path: (string | number)[], message: string): string {
  const [a, i, b, j] = path;
  const where = a === 'formula' && typeof i === 'number' ? `Formula line ${i + 1} (${doc.formula[i]?.name || 'no material'})`
    : a === 'stages' && typeof i === 'number' ? `${doc.stages[i]?.name || `Stage ${i + 1}`}${b === 'steps' && typeof j === 'number' ? `, step ${j + 1}` : ''}` : 'Header';
  const last = String([...path].reverse().find((p) => typeof p === 'string') ?? '');
  return `${where}: ${FIELD[last] ?? last} — ${message}`;
}

export function Designer({ me, versionId, onBack, onOpen }: { me: Me; versionId: number; onBack: () => void; onOpen: (id: number) => void }) {
  const [v, setV] = useState<Version | null>(null);
  const [doc, setDoc] = useState<MasterDoc | null>(null);
  const [md, setMd] = useState<MasterData | null>(null);
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [tab, setTab] = useState<Tab>('header');
  const [place, setPlace] = useState<Place>({ tab: 'process', stage: 0 });
  const [save, setSave] = useState<Save>({ kind: 'saved' });
  const [error, setError] = useState('');
  const timer = useRef<number>();
  const latest = useRef<MasterDoc | null>(null);

  const load = async () => {
    const x = await getVersion(versionId);
    setV(x); setDoc(x.doc); latest.current = x.doc;
    if (x.state !== 'draft') setTab((t) => (t === 'header' ? 'review' : t));
  };
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
    loadMasterData().then(setMd, (e: Error) => setError(e.message));
    void listMasters().then(setRows);
  }, [versionId]);

  const editable = v?.state === 'draft' && can(me, 'master.author');
  const persist = async (d: MasterDoc) => {
    const p = masterSchema.safeParse(d);
    if (!p.success) return setSave({ kind: 'invalid', message: issueText(d, p.error.issues[0]!.path, p.error.issues[0]!.message) });
    setSave({ kind: 'saving' });
    try { await saveVersion(versionId, p.data); setSave(latest.current === d ? { kind: 'saved' } : { kind: 'pending' }); }
    catch (e) { setSave({ kind: 'error', message: e instanceof ApiError ? e.message || e.code : String(e) }); }
  };
  const change = (next: MasterDoc) => {
    setDoc(next); latest.current = next;
    if (!editable) return;
    setSave({ kind: 'pending' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(next), 500);
  };
  const flush = async () => { if (timer.current && save.kind === 'pending' && latest.current) { window.clearTimeout(timer.current); await persist(latest.current); } };

  const parsed = useMemo(() => (doc ? masterSchema.safeParse(doc) : null), [doc]);
  // The master's own checks, and (once master data is read) whether the floor finds a machine for each step (TB-11).
  const problems = useMemo(() => (parsed?.success ? [...masterChecks(parsed.data), ...(md ? placeChecks(parsed.data, md) : [])] : null), [parsed, md]);
  const go = (path: string) => { const p = placeOf(path); setPlace(p); setTab(p.tab); };

  if (error) return <><button className="link dark" onClick={onBack}>← {product.masters}</button><p className="notice">{error}</p></>;
  if (!v || !doc || !md) return <div className="skel skel-block tall" />;
  const others = rows.filter((r) => r.id !== v.id);
  const blocked = problems === null || problems.some(blocking);
  const onAnswer: OnAnswer | undefined = editable ? (p, choice, reason) => change(answerDoc(doc, p, choice, reason)) : undefined;
  return (
    <div className="designer-page">
      <div className="d-top">
        <button className="link dark" onClick={async () => { await flush(); onBack(); }}>← {product.masters}</button>
        <div className="d-title">
          <h1>{doc.header.productCode} · {doc.header.productName}</h1>
          <span className="muted">Version {v.versionNo} · {Number(doc.header.batchSize || 0).toLocaleString('en-IN')} tablets</span>
          <span className={STATE_CHIP[v.state]}>{STATE_LABEL[v.state]}</span>
          {!editable && <span className="muted small">Read only{v.state === 'draft' ? '' : `: this version is ${STATE_LABEL[v.state].toLowerCase()}`}</span>}
        </div>
        <nav className="subtabs" aria-label="Designer">
          {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={async () => { if (k === 'review') await flush(); setTab(k); }}>{label}</button>)}
          {/* Beside the tabs, not under a long product name. */}
          {editable && <span className={`save save-${save.kind}`} role="status">
            {save.kind === 'saved' ? 'All changes saved' : save.kind === 'saving' ? 'Saving…' : save.kind === 'pending' ? 'Changes not saved yet' : `Not saved: ${'message' in save ? save.message : ''}`}
          </span>}
        </nav>
      </div>
      <div className="designer">
        <div className="d-main">
          <fieldset className="plain" disabled={!editable}>
            {tab === 'header' && <div className="card">{doc.pack ? <PackFields header={doc.header} pack={doc.pack} products={md.products} onChange={(header, pack) => change({ ...doc, header, pack })} />
              : <HeaderFields header={doc.header} md={md} onChange={(header) => change({ ...doc, header })} />}</div>}
            {tab === 'formula' && doc.pack && <PackMaterials doc={doc} md={md} onChange={change} />}
            {tab === 'formula' && !doc.pack && <FormulaTable doc={doc} onChange={change} md={md} masters={others} selected={place.line} onSelect={(line) => setPlace({ tab: 'formula', line })} problems={problems ?? []} onAnswer={onAnswer} />}
            {tab === 'process' && <Process doc={doc} onChange={change} md={md} place={place} onPlace={setPlace} editable={!!editable} />}
          </fieldset>
          {tab === 'preview' && <Preview doc={doc} />}
          {tab === 'review' && <Review me={me} version={v} doc={doc} blocked={blocked} onChanged={load} onOpen={onOpen} onGo={go} />}
        </div>
        <CheckPanel doc={doc} state={v.state} problems={problems} invalid={parsed && !parsed.success ? issueText(doc, parsed.error.issues[0]!.path, parsed.error.issues[0]!.message) : undefined} onGo={go} onAnswer={onAnswer} />
      </div>
    </div>
  );
}
