// TrueBatch Tablets Packing: the pack (product, bulk product, pack type and size, shelf life, destination, MRP,
// serialisation) and its packing materials, picked from master data (TB-P1).
import { useState } from 'react';
import type { MasterData, Product } from '../api-designer.js';
import { DESTINATIONS, PACK_MATERIAL_KINDS, PACK_TYPES, type MasterDoc, type Pack, type PackMaterial } from '../../../shared/master/schema.js';
import { newKey, ownProducts } from './model.js';
import { withMaterialSteps } from './skeletons.js';
import { unitName } from '../../../shared/engine/stock.js';
import { Decimal, Order, Picker } from './ui.js';

type Header = MasterDoc['header'];
export const NEW_PACK: Pack = { bulkItemId: '', bulkCode: '', bulkName: '', type: 'blister', unitsPerPack: 10, packsPerCarton: 1, shelfLifeMonths: 24,
  expiryRule: 'month before', destination: 'India domestic', serialisation: false, materials: [] };

function ProductPick({ label, itemId, code, name, products, onPick }: { label: string; itemId: string; code: string; name: string; products: Product[]; onPick: (p: Product) => void }) {
  const [picking, setPicking] = useState(!itemId);
  if (itemId && !picking) return <dl className="fields pulled"><div><dt>{label}</dt><dd>{code} · {name} <button type="button" className="link dark" onClick={() => setPicking(true)}>Change</button></dd></div></dl>;
  return <Picker label={label} items={products.map((p) => ({ id: p.itemId, code: p.code, name: p.name, note: [p.strength, p.dosageForm].filter(Boolean).join(' · '), off: p.active ? undefined : 'inactive' }))}
    onPick={(i) => { onPick(products.find((p) => p.itemId === i.id)!); setPicking(false); }} />;
}
const whole = (v: string) => (/^\d{1,5}$/.test(v) ? Number(v) : 0);

/** The header of a packing master: the pack product and the bulk it is packed from, the pack and what is printed on it.
 *  products: all of master data's; the pack is picked from the packs, the bulk from the bulk products. */
export function PackFields({ header, pack, products, onChange }: { header: Header; pack: Pack; products: Product[]; onChange: (h: Header, p: Pack) => void }) {
  const set = (x: Partial<Pack>) => onChange(header, { ...pack, ...x });
  const setH = (x: Partial<Header>) => onChange({ ...header, ...x }, pack);
  const opt = <K extends 'mrp' | 'gtin'>(k: K, v: string) => onChange(header, v ? { ...pack, [k]: v } : (({ [k]: _, ...p }) => p as Pack)(pack));
  return (
    <div className="header-fields">
      <span className="field-label">Pack product</span>
      <ProductPick label="Pack product" itemId={header.productItemId} code={header.productCode} name={header.productName} products={ownProducts(products, 'pack')}
        onPick={(p) => setH({ productItemId: p.itemId, productCode: p.code, productName: p.name })} />
      <span className="field-label">Bulk tablets packed (TrueBatch Tablets product)</span>
      <ProductPick label="Bulk product" itemId={pack.bulkItemId} code={pack.bulkCode} name={pack.bulkName} products={ownProducts(products, 'bulk')}
        onPick={(p) => set({ bulkItemId: p.itemId, bulkCode: p.code, bulkName: p.name })} />
      <div className="form-grid">
        <label>Pack type<select aria-label="Pack type" value={pack.type} onChange={(e) => set({ type: e.target.value as Pack['type'] })}>{PACK_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Tablets per pack<Decimal label="Tablets per pack" value={String(pack.unitsPerPack)} onChange={(v) => set({ unitsPerPack: whole(v) })} width={5} /></label>
        <label>Packs per carton<Decimal label="Packs per carton" value={String(pack.packsPerCarton)} onChange={(v) => set({ packsPerCarton: whole(v) })} width={5} /></label>
        <label>Standard packing batch (tablets)<Decimal label="Standard packing batch (tablets)" value={header.batchSize} onChange={(v) => setH({ batchSize: v })} width={9} /></label>
        <label>Tablet weight (mg, for counts by weight)<Decimal label="Tablet weight (mg)" value={header.coreWeightMg} onChange={(v) => setH({ coreWeightMg: v })} /></label>
        <label>Approved shelf life (months)<Decimal label="Approved shelf life (months)" value={String(pack.shelfLifeMonths)} onChange={(v) => set({ shelfLifeMonths: whole(v) })} width={4} /></label>
        <label>Expiry<select aria-label="Expiry rule" value={pack.expiryRule} onChange={(e) => set({ expiryRule: e.target.value as Pack['expiryRule'] })}>
          <option value="month before">month of manufacture + shelf life − 1</option><option value="same month">month of manufacture + shelf life</option></select></label>
        <label>Destination<select aria-label="Destination" value={pack.destination} onChange={(e) => set({ destination: e.target.value as Pack['destination'] })}>{DESTINATIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>MRP per pack (Rs.)<Decimal label="MRP per pack" placeholder="no MRP" value={pack.mrp} onChange={(v) => opt('mrp', v)} /></label>
        <label className="check"><input type="checkbox" checked={pack.serialisation} onChange={(e) => set({ serialisation: e.target.checked })} /> Check serialisation (the customer's serialisation system)</label>
        {pack.serialisation && <label>Pack GTIN (14 digits)<input aria-label="Pack GTIN" value={pack.gtin ?? ''} maxLength={14} onChange={(e) => opt('gtin', e.target.value.trim())} /></label>}
      </div>
    </div>
  );
}

/** The packing materials from master data, with what is printed and coded, and their issue and reconciliation steps. */
export function PackMaterials({ doc, md, onChange }: { doc: MasterDoc; md: MasterData; onChange: (d: MasterDoc) => void }) {
  const pack = doc.pack!;
  const [adding, setAdding] = useState(false);
  const put = (materials: PackMaterial[]) => onChange({ ...doc, pack: { ...pack, materials } });
  const set = (i: number, x: Partial<PackMaterial>) => put(pack.materials.map((m, j) => (j === i ? { ...m, ...x } : m)));
  const steps = (d: MasterDoc) => d.stages.reduce((n, st) => n + st.steps.length, 0);
  const stepsToAdd = steps(withMaterialSteps(doc)) > steps(doc);
  return (
    <div className="card">
      <div className="d-section-head"><h2>Packing materials</h2>
        {/* Only while a material has no issue or reconciliation step yet. */}
        {stepsToAdd && <button type="button" onClick={() => onChange(withMaterialSteps(doc))}>Add their issue and reconciliation steps</button>}</div>
      <table className="plain-table">
        <thead><tr><th>Material</th><th>Kind</th><th>Printed</th><th>Coded</th><th>Per pack</th><th /></tr></thead>
        <tbody>{pack.materials.map((m, i) => (
          <tr key={m.key}>
            <td><b>{m.code}</b> {m.name}</td>
            <td><select aria-label={`Kind of ${m.name}`} value={m.kind} onChange={(e) => set(i, { kind: e.target.value as PackMaterial['kind'] })}>{PACK_MATERIAL_KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
            <td><input type="checkbox" aria-label={`${m.name} is printed`} checked={m.printed} onChange={(e) => set(i, { printed: e.target.checked })} /></td>
            <td><input type="checkbox" aria-label={`${m.name} carries the batch coding`} checked={m.coded} onChange={(e) => set(i, { coded: e.target.checked })} /></td>
            <td><Decimal label={`${m.name} per pack`} value={m.perPack} onChange={(v) => set(i, { perPack: v })} width={5} />
              <select aria-label={`Unit of ${m.name}`} value={m.unit} onChange={(e) => set(i, { unit: e.target.value as PackMaterial['unit'] })}>{['units', 'm', 'g'].map((u) => <option key={u} value={u}>{unitName(u, md.materials.find((x) => x.itemId === m.materialItemId)?.unit)}</option>)}</select></td>
            <td><Order index={i} count={pack.materials.length} what={m.name} onMove={(by) => { const l = [...pack.materials]; [l[i], l[i + by]] = [l[i + by]!, l[i]!]; put(l); }}
              onRemove={() => put(pack.materials.filter((_, j) => j !== i))} /></td>
          </tr>))}
        </tbody>
      </table>
      {!pack.materials.length && <p className="muted small">No packing materials yet.</p>}
      {/* A new material's key is made from its code, short and stable (17 Nov 2026 run, F34); keys already in a master stay. */}
      {adding ? <Picker label="Packing material" items={md.materials.map((m) => ({ id: m.itemId, code: m.code, name: m.name, note: m.category ?? undefined, off: m.active ? undefined : 'inactive' }))}
        onPick={(i) => { put([...pack.materials, { key: newKey(i.code, pack.materials.map((m) => m.key)), materialItemId: i.id, code: i.code, name: i.name, kind: 'other', printed: false, coded: false, perPack: '1', unit: 'units' }]); setAdding(false); }} />
        : <button type="button" onClick={() => setAdding(true)}>+ Add a packing material</button>}
    </div>
  );
}
