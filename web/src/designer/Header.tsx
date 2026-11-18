// Screen 2: the header (product from master data, batch size, theoretical weights) and the new-master dialog with
// what the master starts from: empty, a process skeleton, or a copy of another master (scaled to the batch size).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api.js';
import { createMaster, getVersion, STATE_LABEL, type MasterData, type MasterRow } from '../api-designer.js';
import { masterSchema, type MasterDoc } from '../../../shared/master/schema.js';
import { batchWeight } from './example.js';
import { dispensingRoomChoices, grouped, ownProducts, scaleDoc } from './model.js';
import { packingStages, SKELETON_LIST, skeletonStages } from './skeletons.js';
import { NEW_PACK, PackFields } from './Pack.js';
import { product } from '../product.js';
import { ChipSet, Decimal, Picker } from './ui.js';

type Header = MasterDoc['header'];

export function HeaderFields({ header, onChange, md }: { header: Header; onChange: (h: Header) => void; md: MasterData }) {
  const product = md.products.find((p) => p.itemId === header.productItemId);
  const rooms = dispensingRoomChoices(md);
  const [picking, setPicking] = useState(!header.productItemId);
  const set = (k: keyof Header, v: string) => onChange({ ...header, [k]: v });
  const core = batchWeight({ header } as MasterDoc, /^\d+(\.\d+)?$/.test(header.coreWeightMg) && /^[1-9]\d*$/.test(header.batchSize) ? header.coreWeightMg : undefined);
  return (
    <div className="header-fields">
      <div>
        <span className="field-label">Product</span>
        {header.productItemId && !picking ? (
          <dl className="fields pulled">
            <div><dt>Code</dt><dd>{header.productCode}</dd></div>
            <div><dt>Name</dt><dd>{header.productName}</dd></div>
            <div><dt>Strength</dt><dd>{product?.strength ?? '—'}</dd></div>
            <div><dt>Dosage form</dt><dd>{product?.dosageForm ?? '—'}</dd></div>
            <div><dt /><dd><button type="button" className="link dark" onClick={() => setPicking(true)}>Change product</button></dd></div>
          </dl>
        ) : (
          <Picker label="Product" items={ownProducts(md.products, 'bulk').map((p) => ({ id: p.itemId, code: p.code, name: p.name, note: [p.strength, p.dosageForm].filter(Boolean).join(' · '), off: p.active ? undefined : 'inactive' }))}
            onPick={(i) => { onChange({ ...header, productItemId: i.id, productCode: i.code, productName: i.name }); setPicking(false); }} />
        )}
      </div>
      <div className="form-grid">
        <label>Batch size (tablets)<Decimal label="Batch size (tablets)" value={header.batchSize} onChange={(v) => set('batchSize', v)} width={9} /></label>
        <label>Theoretical core weight (mg per tablet)<Decimal label="Theoretical core weight (mg per tablet)" value={header.coreWeightMg} onChange={(v) => set('coreWeightMg', v)} /></label>
        <label>Theoretical coated weight (mg per tablet)
          <Decimal label="Theoretical coated weight (mg per tablet)" placeholder="uncoated" value={header.coatedWeightMg}
            onChange={(v) => onChange(v ? { ...header, coatedWeightMg: v } : (({ coatedWeightMg: _, ...h }) => h)(header))} />
        </label>
        <label>Die bore area (mm², tooling record)<Decimal label="Die bore area" placeholder="not given" value={header.dieAreaMm2}
          onChange={(v) => onChange(v ? { ...header, dieAreaMm2: v } : (({ dieAreaMm2: _, ...h }) => h)(header))} /></label>
        <div className="calc-note">{core?.ok ? <>Theoretical core batch weight: <b>{grouped(core.shown)}</b></> : <span className="muted">The core batch weight shows once the batch size and core weight are set.</span>}</div>
      </div>
      {/* TB-11: a balance is offered in these rooms or in a room the stage allows. */}
      <ChipSet label="Dispensing rooms (where the materials are weighed)" values={header.dispensingRooms ?? []} options={rooms.options} groups={rooms.groups} text={rooms.text}
        onChange={(dispensingRooms) => onChange({ ...header, dispensingRooms })} empty="None chosen yet: choose the rooms of master data where the materials are weighed" />
      <OtherStrengths header={header} onChange={onChange} />
    </div>
  );
}

/** Other strengths compressed from the same blend: each checked for its API per tablet against its label claim. */
function OtherStrengths({ header, onChange }: { header: Header; onChange: (h: Header) => void }) {
  const list = header.otherStrengths ?? [];
  const put = (next: typeof list) => onChange(next.length ? { ...header, otherStrengths: next } : (({ otherStrengths: _, ...h }) => h)(header));
  const set = (n: number, k: 'name' | 'labelClaim' | 'coreWeightMg', v: string) => put(list.map((x, i) => (i === n ? { ...x, [k]: v } : x)));
  return (
    <fieldset className="checklist">
      <legend>Other strengths from the same blend</legend>
      {list.map((x, n) => (
        <div className="form-grid" key={n}>
          <label>Strength<input aria-label={`Strength ${n + 1}`} value={x.name} onChange={(e) => set(n, 'name', e.target.value)} /></label>
          <label>Label claim<input aria-label={`Label claim ${n + 1}`} placeholder="e.g. 50 mg" value={x.labelClaim} onChange={(e) => set(n, 'labelClaim', e.target.value)} /></label>
          <label>Core weight (mg)<Decimal label={`Core weight ${n + 1}`} value={x.coreWeightMg} onChange={(v) => set(n, 'coreWeightMg', v)} /></label>
          <button type="button" className="link" onClick={() => put(list.filter((_, i) => i !== n))}>Remove</button>
        </div>
      ))}
      <button type="button" className="link" onClick={() => put([...list, { name: '', labelClaim: '', coreWeightMg: '' }])}>Add a strength</button>
    </fieldset>
  );
}

type Start = { kind: 'empty' } | { kind: 'skeleton'; id: string } | { kind: 'copy'; versionId: number };

/** New master (or a copy of one): the header, and what it starts from. */
export function NewMaster({ md, masters, copyOf, onCreated, onCancel }: {
  md: MasterData; masters: MasterRow[]; copyOf?: MasterRow; onCreated: (id: number) => void; onCancel: () => void;
}) {
  // A new tablet master starts with no dispensing rooms: the author picks them (the rooms with a weighing balance are
  // listed first); every room of an area called Dispensing could be a segregated block's booth. A copy: those it names.
  const [header, setHeader] = useState<Header>({
    ...(copyOf?.header ?? { productItemId: '', productCode: '', productName: '', batchSize: '', coreWeightMg: '' }) });
  const skeletons = product.packing ? [{ id: 'packing', name: 'Packing record', text: 'Issue to the line, packing with the checks alongside the line, reconciliation and line clearance after, for this pack.' }] : SKELETON_LIST;
  const [start, setStart] = useState<Start>(copyOf ? { kind: 'copy', versionId: copyOf.id } : { kind: 'skeleton', id: skeletons[0]!.id });
  // A packing master: the pack (TB-P1), copied with the master it is copied from.
  const [pack, setPack] = useState(product.packing ? NEW_PACK : undefined);
  const [source, setSource] = useState<MasterDoc | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start.kind !== 'copy') return setSource(null);
    void getVersion(start.versionId).then((v) => {
      setSource(v.doc);
      if (v.doc.pack) setPack(v.doc.pack);
      setHeader((h) => ({ ...h, coreWeightMg: h.coreWeightMg || v.doc.header.coreWeightMg, batchSize: h.batchSize || v.doc.header.batchSize,
        ...(v.doc.header.coatedWeightMg && !h.coatedWeightMg ? { coatedWeightMg: v.doc.header.coatedWeightMg } : {}) }));
    });
  }, [start.kind === 'copy' ? start.versionId : 0]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let doc: MasterDoc = { header, formula: [], stages: [], ...(pack ? { pack } : {}) };
    if (start.kind === 'skeleton') doc.stages = pack ? packingStages(pack) : skeletonStages(start.id, header);
    if (start.kind === 'copy' && source) doc = { ...scaleDoc(source, header.batchSize), header, ...(pack ? { pack } : {}) };
    const parsed = masterSchema.safeParse(doc);
    if (!header.productItemId) return setError('Pick the product.');
    if (pack && !pack.bulkItemId) return setError('Pick the bulk product.');
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.at(-1) === 'batchSize' ? 'Batch size' : i.path.at(-1) === 'coreWeightMg' ? 'Core weight' : i.path.join('.')}: ${i.message}`).join('; '));
    setBusy(true);
    try {
      onCreated((await createMaster(parsed.data)).id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  const scaled = start.kind === 'copy' && source && header.batchSize !== source.header.batchSize;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={copyOf ? 'Copy a master' : 'New master'}>
      <form className="card dialog wide" onSubmit={submit}>
        <h2>{copyOf ? `Copy ${copyOf.header.productCode} version ${copyOf.versionNo}` : 'New master'}</h2>
        {pack ? <PackFields header={header} pack={pack} products={md.products} onChange={(h, p) => { setHeader(h); setPack(p); }} />
          : <HeaderFields header={header} onChange={setHeader} md={md} />}
        <fieldset className="checklist">
          <legend>Start from</legend>
          {skeletons.map((s) => (
            <label key={s.id} className="check route"><input type="radio" name="start" checked={start.kind === 'skeleton' && start.id === s.id} onChange={() => setStart({ kind: 'skeleton', id: s.id })} />
              <span>Process skeleton: {s.name}<small>{s.text}</small></span></label>
          ))}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'copy'} onChange={() => masters[0] && setStart({ kind: 'copy', versionId: copyOf?.id ?? masters[0].id })} disabled={!masters.length} />
            <span>A copy of another master<small>Formula and process are copied; typed batch quantities scale to the new batch size.</small></span></label>
          {start.kind === 'copy' && (
            <select aria-label="Master to copy" value={start.versionId} onChange={(e) => { setStart({ kind: 'copy', versionId: Number(e.target.value) }); }}>
              {masters.map((m) => <option key={m.id} value={m.id}>{m.header.productCode} {m.header.productName} · {grouped(m.header.batchSize)} tablets · version {m.versionNo} ({STATE_LABEL[m.state]})</option>)}
            </select>
          )}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'empty'} onChange={() => setStart({ kind: 'empty' })} />
            <span>Empty<small>No formula and no stages yet.</small></span></label>
        </fieldset>
        {scaled && <p className="notice small">Copy to a new batch size: {grouped(source!.header.batchSize)} → {grouped(header.batchSize)} tablets. Quantities per tablet stay; typed batch quantities in the steps scale.</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Create draft</button>
        </div>
      </form>
    </div>
  );
}
