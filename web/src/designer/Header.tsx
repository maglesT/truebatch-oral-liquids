// Screen 2: the header (product from master data, the liquid batch, the label claim) and the new-master dialog with
// what the master starts from: empty, a process skeleton, or a copy of another master (scaled to the batch size).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api.js';
import { createMaster, getVersion, STATE_LABEL, type MasterData, type MasterRow } from '../api-designer.js';
import { CLAIM_PER, masterSchema, PRODUCT_TYPES, type MasterDoc } from '../../../shared/master/schema.js';
import { headerValue } from '../../../shared/engine/values.js';
import { dispensingRoomChoices, grouped, ownProducts, productNote, scaleDoc } from './model.js';
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
  // An optional value: empty removes it.
  type Opt = 'densityGPerMl' | 'densityAtC' | 'doseVolumeMl' | 'dropsPerMl' | 'fillWeightG' | 'reconstitutedMl' | 'claimAs' | 'type' | 'claimPer' | 'doses' | 'rxOtc';
  const opt = (k: Opt, v: string) => onChange(v ? { ...header, [k]: v } : (({ [k]: _, ...h }) => h as Header)(header));
  const doc = { header, formula: [], stages: [] } as MasterDoc;
  const powder = header.type === 'dry syrup';
  const shown = DECIMAL.test(header.batchSize) ? headerValue(doc, powder ? 'containers' : header.batchUnit === 'kg' ? 'batchVolume' : 'batchMass') : undefined;
  const choose = (k: Opt, label: string, options: readonly string[], words: (o: string) => string = (o) => o) => (
    <label>{label}
      <select aria-label={label} value={(header[k] as string | undefined) ?? ''} onChange={(e) => opt(k, e.target.value)}>
        <option value="">(choose)</option>{options.map((o) => <option key={o} value={o}>{words(o)}</option>)}
      </select></label>);
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
          <Picker label="Product" items={ownProducts(md.products, 'bulk').map((p) => ({ id: p.itemId, code: p.code, name: p.name, note: productNote(p), off: p.active ? undefined : 'inactive' }))}
            onPick={(i) => { onChange({ ...header, productItemId: i.id, productCode: i.code, productName: i.name }); setPicking(false); }} />
        )}
      </div>
      <div className="form-grid">
        {choose('type', 'Product type', PRODUCT_TYPES, (t) => TYPE_WORDS[t] ?? t)}
        <label>Batch size<Decimal label="Batch size" value={header.batchSize} onChange={(v) => set('batchSize', v)} width={9} /></label>
        <label>Made in
          <select aria-label="Batch unit" value={header.batchUnit} onChange={(e) => set('batchUnit', e.target.value)}>
            <option value="L">litres (formula per mL)</option><option value="kg">{powder ? 'kg (formula per g of powder)' : 'kg (formula per mL, by the density)'}</option>
          </select>
        </label>
        {!powder && <label>Density (g/mL)<Decimal label="Density" placeholder="needed" value={header.densityGPerMl} onChange={(v) => opt('densityGPerMl', v)} /></label>}
        {!powder && <label>Density measured at (°C)<Decimal label="Density measured at" placeholder="e.g. 25" value={header.densityAtC} onChange={(v) => opt('densityAtC', v)} /></label>}
        {choose('claimPer', 'Label claim is per', CLAIM_PER, (c) => CLAIM_WORDS[c] ?? c)}
        {header.claimPer === 'dose volume' && <label>Dose volume (mL)<Decimal label="Dose volume" placeholder="e.g. 5" value={header.doseVolumeMl} onChange={(v) => opt('doseVolumeMl', v)} /></label>}
        {header.claimPer === 'drop' && <label>Drops per mL<Decimal label="Drops per mL" value={header.dropsPerMl} onChange={(v) => opt('dropsPerMl', v)} /></label>}
        <label>Label claim is of (base, salt, ion or element)<input aria-label="Label claim is of" placeholder="e.g. paracetamol" value={header.claimAs ?? ''} onChange={(e) => opt('claimAs', e.target.value)} /></label>
        {powder && <label>Fill weight (g of powder per container)<Decimal label="Fill weight" value={header.fillWeightG} onChange={(v) => opt('fillWeightG', v)} /></label>}
        {powder && header.claimPer !== 'g of powder' && <label>Volume after reconstitution (mL)<Decimal label="Volume after reconstitution" value={header.reconstitutedMl} onChange={(v) => opt('reconstitutedMl', v)} /></label>}
        {choose('doses', 'Doses per container', ['single-dose', 'multi-dose'])}
        {choose('rxOtc', 'Prescription', ['Rx', 'OTC'])}
        <div className="calc-note">{shown === undefined ? <span className="muted">The batch {powder ? 'containers' : 'volume and mass'} show once the batch size and density are set.</span>
          : typeof shown === 'string' ? <>{powder ? 'Containers expected' : header.batchUnit === 'kg' ? 'Batch volume' : 'Batch mass'}: <b>{powder ? shown.replace(/^(\d+) units$/, (_, n: string) => `${Number(n).toLocaleString('en-IN')} containers`) : grouped(shown)}</b></> : <span className="muted">{String((shown as { message?: unknown }).message ?? "")}</span>}</div>
      </div>
      {/* TL-11: a balance is offered in these rooms or in a room the stage allows. */}
      <ChipSet label="Dispensing rooms (where the materials are weighed)" values={header.dispensingRooms ?? []} options={rooms.options} groups={rooms.groups} text={rooms.text}
        onChange={(dispensingRooms) => onChange({ ...header, dispensingRooms })} empty="None chosen yet: choose the rooms of master data where the materials are weighed" />
    </div>
  );
}

const DECIMAL = /^\d+(\.\d+)?$/;
const TYPE_WORDS: Record<string, string> = { solution: 'Syrup, oral solution or elixir', drops: 'Oral drops', suspension: 'Oral suspension', emulsion: 'Oral emulsion', 'dry syrup': 'Dry syrup (powder for oral suspension or solution)' };
const CLAIM_WORDS: Record<string, string> = { mL: '1 mL', 'dose volume': 'a dose volume (e.g. 5 mL)', drop: 'a drop', container: 'the container', 'g of powder': '1 g of powder (scoop or weighed)', none: 'none (a diluent or vehicle batch)' };

type Start = { kind: 'empty' } | { kind: 'skeleton'; id: string } | { kind: 'copy'; versionId: number };

/** New master (or a copy of one): the header, and what it starts from. */
export function NewMaster({ md, masters, copyOf, onCreated, onCancel }: {
  md: MasterData; masters: MasterRow[]; copyOf?: MasterRow; onCreated: (id: number) => void; onCancel: () => void;
}) {
  // A new master starts with no dispensing rooms: the author picks them (the rooms with a weighing balance are
  // listed first); every room of an area called Dispensing could be a segregated block's booth. A copy: those it names.
  const [header, setHeader] = useState<Header>({
    ...(copyOf?.header ?? { productItemId: '', productCode: '', productName: '', batchSize: '', batchUnit: product.packing ? 'packs' : 'L' }) });
  const skeletons = product.packing ? [{ id: 'packing', name: 'Filling and packing record', text: 'Issue to the line; container wash, filling with its rounds, capping, coding and cartons; reconciliation of the bulk and line clearance after, for this pack and bulk type.' }] : SKELETON_LIST;
  const [start, setStart] = useState<Start>(copyOf ? { kind: 'copy', versionId: copyOf.id } : { kind: 'skeleton', id: skeletons[0]!.id });
  // A packing master: the pack (TL-P1), copied with the master it is copied from.
  const [pack, setPack] = useState(product.packing ? NEW_PACK : undefined);
  const [source, setSource] = useState<MasterDoc | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (start.kind !== 'copy') return setSource(null);
    void getVersion(start.versionId).then((v) => {
      setSource(v.doc);
      if (v.doc.pack) setPack(v.doc.pack);
      setHeader((h) => ({ ...v.doc.header, ...h, batchSize: h.batchSize || v.doc.header.batchSize, batchUnit: v.doc.header.batchUnit }));
    });
  }, [start.kind === 'copy' ? start.versionId : 0]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let doc: MasterDoc = { header, formula: [], stages: [], ...(pack ? { pack } : {}) };
    if (start.kind === 'skeleton') doc.stages = pack ? packingStages(pack, header.type) : skeletonStages(start.id, header);
    if (start.kind === 'copy' && source) doc = { ...scaleDoc(source, header.batchSize), header, ...(pack ? { pack } : {}) };
    const parsed = masterSchema.safeParse(doc);
    if (!header.productItemId) return setError('Pick the product.');
    if (pack && !pack.bulkItemId) return setError('Pick the bulk product.');
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.at(-1) === 'batchSize' ? 'Batch size' : i.path.join('.')}: ${i.message}`).join('; '));
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
              {masters.map((m) => <option key={m.id} value={m.id}>{m.header.productCode} {m.header.productName} · {grouped(m.header.batchSize)} {m.header.batchUnit} · version {m.versionNo} ({STATE_LABEL[m.state]})</option>)}
            </select>
          )}
          <label className="check route"><input type="radio" name="start" checked={start.kind === 'empty'} onChange={() => setStart({ kind: 'empty' })} />
            <span>Empty<small>No formula and no stages yet.</small></span></label>
        </fieldset>
        {scaled && <p className="notice small">Copy to a new batch size: {grouped(source!.header.batchSize)} → {grouped(header.batchSize)} {header.batchUnit}. Quantities per mL (or per g) stay; typed batch quantities in the steps scale.</p>}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit" disabled={busy}>Create draft</button>
        </div>
      </form>
    </div>
  );
}
