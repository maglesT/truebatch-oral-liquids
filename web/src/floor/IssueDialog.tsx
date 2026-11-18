import { useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { SignDialog } from '../components/SignDialog.js';
import { getVersion, type MasterRow, type Version } from '../api-designer.js';
import { batchLink, go, plainError, useLogbookItems, type PickItem } from '../api-floor.js';
import { FieldInput } from './Fields.js';
import { findBlock } from '../../../shared/blocks/index.js';
import { handFields, type Source } from '../../../shared/engine/links.js';
import { emptyNote, inLogbook, machineRefusal } from '../../../shared/engine/picks.js';

// TB-03: issue a batch from the effective master version, signed "issued". A packing master's first step is recorded
// at issue: the line, the released bulk batch (picked from TrueBatch Tablets; typed from its labels without the link)
// and the tablets issued (what is left of its good tablets, pulled with it when TrueBatch Tablets gives them: all of it,
// or less typed for a part issue). A value the server finds typed by hand (a link absent or down) asks its label questions.
export function IssueDialog({ row, onCancel }: { row: MasterRow; onCancel: () => void }) {
  const [v, setV] = useState<Version | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [signing, setSigning] = useState(false);
  const [lines, setLines] = useState<PickItem[]>([]);
  const [machines, setMachines] = useState<PickItem[]>([]);
  const [rooms, setRooms] = useState<PickItem[]>([]);
  const [bulk, setBulk] = useState<{ link: string; batches: { batchNo: string; mfgDate: string | null; goodQuantity?: string | null; issued?: string; left?: string }[] } | null>(null);
  useEffect(() => { getVersion(row.id).then(setV, (e) => setProblems([plainError(e)])); }, [row.id]);
  const doc = v?.doc;
  const block = doc?.stages[0]?.steps[0] ? findBlock(doc.stages[0].steps[0].block) : undefined;
  const atIssue = (block?.atIssue ?? []).map((n) => block!.fields.find((f) => f.name === n)!);
  useEffect(() => {
    if (!doc || !atIssue.length) return;
    if (doc.pack) void api<typeof bulk>('GET', `/api/bulk-batches?product=${encodeURIComponent(doc.pack.bulkCode)}`).then(setBulk, () => setBulk({ link: 'down', batches: [] }));
    void Promise.all([api<PickItem[]>('GET', '/api/master/equipment'), api<PickItem[]>('GET', '/api/master/rooms')])
      .then(([all, rooms]) => { setMachines(all); setRooms(rooms); setLines(all.filter((m) => m.active && atIssue.some((f) => f.kind === 'machine' && !machineRefusal(doc.stages[0]!, f, m, rooms)))); }, () => {});
  }, [doc]);

  // While the Logbook is linked, only the lines it has (shared/engine/picks.ts).
  const logbook = useLogbookItems(atIssue.some((f) => f.kind === 'machine'));
  const offer = inLogbook(lines, logbook);
  if (!doc) return null;
  // The label questions of a value the server found typed by hand ("… is not recorded").
  const asked = handFields(block?.fields ?? [], Object.fromEntries((block?.fields ?? []).map((f) => [f.name, { from: 'hand', link: 'mms', state: 'absent' } as Source])))
    .filter((f) => problems.some((p) => p.startsWith(`${f.label} is not recorded`)));
  // The date of manufacture comes with the bulk batch while TrueBatch Tablets answers, and so do the tablets issued
  // when it gives them (pull, don't type): what is left of its good tablets, offered; less may be typed (a part issue).
  const picked = bulk?.link === 'ok' ? bulk.batches.find((x) => x.batchNo === String(values.bulk ?? '').trim()) : undefined;
  const offered = picked?.goodQuantity ? picked.left ?? picked.goodQuantity : undefined;
  const fields = [...atIssue.filter((f) => f.name !== 'mfgDate' || (bulk && bulk.link !== 'ok')), ...asked];
  const sent = Object.fromEntries(Object.entries(values).filter(([k]) => fields.some((f) => f.name === k)));
  // Another bulk batch: the tablets typed for the previous one go.
  const set = (name: string) => (raw: unknown) => setValues((x) => (name === 'bulk' ? { ...Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'tablets')), bulk: raw } : { ...x, [name]: raw }));
  const issue = async ({ proof }: { proof: string }) => {
    try {
      const b = await api<{ id: number }>('POST', '/api/batches', { masterVersionId: row.id, proof, ...(fields.length ? { values: sent } : {}) });
      go(batchLink(b.id));
    } catch (e) {
      if (!(e instanceof ApiError && e.problems.length)) throw e;
      setSigning(false);
      setProblems(e.problems);
    }
  };
  return (<>
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Issue a batch">
      <form className="card dialog fl" onSubmit={(e) => { e.preventDefault(); setSigning(true); }}>
        <h2>Issue a batch</h2>
        <p>{doc.header.productCode} · {doc.header.productName}, version {row.versionNo}: {Number(doc.header.batchSize).toLocaleString('en-IN')} tablets{doc.pack ? `, packed from ${doc.pack.bulkCode}` : ''}. The batch number is given by the server.</p>
        {fields.map((f) => (
          <FieldInput key={f.name === 'tablets' ? `tablets-${picked?.batchNo ?? ''}` : f.name} f={f} unit={f.unit ?? ''} saved={f.name === 'tablets' && offered ? { value: offered, unit: f.unit ?? 'tablets' } : undefined} picks={f.kind === 'machine' ? offer.offered : []} note={[f.kind === 'machine' && machines.length && !lines.length ? emptyNote(doc.stages[0]!, f, machines, rooms) : null, f.kind === 'machine' ? offer.note : null]} onChange={set(f.name)}
            options={f.kind === 'bulk' ? (bulk?.batches ?? []).map((x) => x.batchNo) : []} />
        ))}
        {picked?.goodQuantity && <p className="notice">Left to issue of {picked.batchNo}: {Number(offered).toLocaleString('en-IN')} tablets ({Number(picked.goodQuantity).toLocaleString('en-IN')} good tablets in TrueBatch Tablets{Number(picked.issued ?? 0) > 0 ? `, ${Number(picked.issued).toLocaleString('en-IN')} already issued to other packing batches` : ''}). Issue all of it, or type less for a part issue.</p>}
        {doc.pack && bulk && bulk.link !== 'ok' && <p className="notice warn">TrueBatch Tablets is not linked or not answering: type the bulk batch from its container labels; a second person checks it.</p>}
        {problems.length > 0 && <div className="notice bad" role="alert">{problems.map((p, i) => <p key={i}>{p}</p>)}</div>}
        <div className="actions">
          <button type="button" className="big" onClick={onCancel}>Cancel</button>
          <button className="big primary" type="submit">Next: sign</button>
        </div>
      </form>
    </div>
    {signing && <SignDialog meaning="issued" what={`A new batch of ${doc.header.productCode} ${doc.header.productName} from master version ${row.versionNo}.`} onCancel={() => setSigning(false)} onSign={issue} />}
  </>);
}
