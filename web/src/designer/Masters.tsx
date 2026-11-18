// Screen 1: the master records, one row per version: product, batch size, version, state. New master, copy (also
// to a new batch size), and a new version of an effective master. Opening a row opens the designer.
import { useEffect, useState } from 'react';
import { ApiError, can, plantTime, type Me } from '../api.js';
import { listMasters, loadMasterData, newVersion, STATE_CHIP, STATE_LABEL, type MasterData, type MasterRow } from '../api-designer.js';
import { Designer } from './Designer.js';
import { IssueDialog } from '../floor/IssueDialog.js';
import { NewMaster } from './Header.js';
import { product } from '../product.js';
import './designer.css';

export function Masters({ me }: { me: Me }) {
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [md, setMd] = useState<MasterData | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState<{ copyOf?: MasterRow } | null>(null);
  const [issuing, setIssuing] = useState<MasterRow | null>(null);
  const [q, setQ] = useState('');
  const author = can(me, 'master.author');
  const load = async () => setRows(await listMasters());
  useEffect(() => {
    void load();
    loadMasterData().then(setMd, (e: Error) => setError(e.message));
  }, []);

  if (open !== null) return <Designer me={me} versionId={open} onOpen={setOpen} onBack={() => { setOpen(null); void load(); }} />;

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (rows ?? []).filter((r) => words.every((w) => `${r.header.productCode} ${r.header.productName}`.toLowerCase().includes(w)));
  const pending = (masterId: number) => rows?.some((r) => r.masterId === masterId && ['draft', 'in_review', 'approved'].includes(r.state));
  const addVersion = async (r: MasterRow) => {
    try { setOpen((await newVersion(r.masterId)).id); } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
  };
  return (
    <>
      <div className="home-head">
        <div>
          <h1>{product.masters}</h1>
          <p className="greeting">One row per version. A draft is written here, checked by a second person and approved by QA.</p>
        </div>
        {author && <button className="primary" onClick={() => setCreating({})} disabled={!md}>New master</button>}
      </div>
      {error && <p className="notice">{error}</p>}
      <input className="search" placeholder="Search by product code or name" aria-label="Search masters" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows === null ? <div className="skel skel-block" /> : !rows.length ? (
        <div className="card placeholder"><p>No {product.masters.toLowerCase()} yet.{author && ' Start with New master.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="masters">
            <thead><tr><th>Product</th><th>Batch size</th><th>Version</th><th>State</th><th>Written by</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                  <td><b>{r.header.productCode}</b><span className="cell-sub">{r.header.productName}</span></td>
                  <td className="nowrap">{Number(r.header.batchSize).toLocaleString('en-IN')} tablets</td>
                  <td>{r.versionNo}</td>
                  <td><span className={STATE_CHIP[r.state]}>{STATE_LABEL[r.state]}</span></td>
                  <td>{r.createdByName}<span className="cell-sub">{plantTime(r.createdAt)}</span></td>
                  <td>
                    <span className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setOpen(r.id)}>Open</button>
                      {author && <button onClick={() => setCreating({ copyOf: r })} disabled={!md}>Copy</button>}
                      {author && r.state === 'effective' && !pending(r.masterId) && <button onClick={() => void addVersion(r)}>New version</button>}
                      {can(me, 'batch.issue') && r.state === 'effective' && <button className="primary" onClick={() => setIssuing(r)}>Issue a batch</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {issuing && <IssueDialog row={issuing} onCancel={() => setIssuing(null)} />}
      {creating && md && (
        <NewMaster md={md} masters={rows ?? []} copyOf={creating.copyOf} onCancel={() => setCreating(null)}
          onCreated={(id) => { setCreating(null); setOpen(id); }} />
      )}
    </>
  );
}
