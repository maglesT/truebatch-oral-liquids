// Screen 6: the calculation preview. Type example lot values (assay, water, LOD, content) and see the dispensing
// quantities, the compensated fillers and the theoretical yields, all from the templates library. Nothing is saved.
import { Fragment, useMemo, useState } from 'react';
import { findBlock } from '../../../shared/blocks/index.js';
import { evaluate } from '../../../shared/engine/index.js';
import { masterSchema, type MasterDoc } from '../../../shared/master/schema.js';
import { batchWeight, dispensing, type LotValues } from './example.js';
import { settingText } from './sentences.js';
import { grouped, qtyText } from './model.js';
import { Decimal } from './ui.js';

const FIELDS: { k: keyof LotValues; label: string; when: (a: NonNullable<MasterDoc['formula'][number]['adjust']>) => boolean }[] = [
  { k: 'assay', label: 'Assay %', when: (a) => !!a.potency },
  { k: 'water', label: 'Water %', when: (a) => ['anhydrous', 'anhydrous and solvent-free'].includes(a.potency?.basis ?? '') },
  { k: 'lod', label: 'LOD %', when: (a) => a.potency?.basis === 'dried' },
  { k: 'content', label: 'Content %', when: (a) => !!a.content },
];

export function Preview({ doc: raw }: { doc: MasterDoc }) {
  const parsed = useMemo(() => masterSchema.safeParse(raw), [raw]);
  const [lots, setLots] = useState<Record<string, LotValues>>(() => Object.fromEntries(raw.formula.filter((l) => l.adjust?.potency || l.adjust?.content)
    .map((l) => [l.key, { assay: '99.0', water: '0.5', lod: '0.5', content: '98.0' }])));
  if (!parsed.success) return <div className="card"><p className="muted">The preview shows once every entry of the master is complete (see the master check).</p></div>;
  const doc = parsed.data;
  const rows = dispensing(doc, lots);
  const adjusted = doc.formula.filter((l) => l.adjust && (l.adjust.potency || l.adjust.content));
  const core = batchWeight(doc, doc.header.coreWeightMg);
  const coated = batchWeight(doc, doc.header.coatedWeightMg);
  const yields = doc.stages.flatMap((s, si) => s.steps.flatMap((t, ti) => {
    if (findBlock(t.block)?.gmp !== 'yield') return [];
    const v = t.settings.theoretical;
    const r = v && typeof v === 'object' && !('ref' in v) ? evaluate(doc, [], { stage: si, sub: 1, step: ti, round: 1 }, {}).theoretical : undefined;
    return [{ stage: s.name, text: r ? (r.ok ? grouped(r.shown) : r.message) : v === undefined ? 'not set' : `${settingText(doc, v)}${typeof v === 'object' && 'ref' in v ? ' (known during the batch)' : ''}`, ok: !r || r.ok }];
  }));
  return (
    <>
      <div className="card">
        <div className="d-section-head"><h2>Example lot values</h2><span className="muted small">Type the certificate values of example lots. Nothing is saved.</span></div>
        {adjusted.length ? (
          <div className="lot-grid">
            {adjusted.map((l) => (
              <div key={l.key} className="lot">
                <b>{l.name}</b>
                {FIELDS.filter((f) => f.when(l.adjust!)).map((f) => (
                  <label key={f.k}>{f.label}<Decimal label={`${l.name} ${f.label}`} value={lots[l.key]?.[f.k]} onChange={(v) => setLots((x) => ({ ...x, [l.key]: { ...x[l.key], [f.k]: v } }))} width={6} /></label>
                ))}
              </div>
            ))}
          </div>
        ) : <p className="muted">No material is adjusted for its lot: the dispensing quantities are the batch quantities.</p>}
      </div>
      <div className="card">
        <h2>Dispensing quantities for {Number(doc.header.batchSize).toLocaleString('en-IN')} tablets</h2>
        <div className="table-wrap">
          <table className="plain-table">
            <thead><tr><th>Material</th><th>Batch quantity</th><th>To dispense</th><th>Worked out</th></tr></thead>
            <tbody>
              {rows.map(({ line, standard, adjusted: a }) => (
                <tr key={line.key} className={a && !a.ok ? 'bad-row' : ''}>
                  <td><b>{line.code}</b><span className="cell-sub">{line.name}{line.adjust?.compensates?.length ? ' · compensating filler' : ''}</span></td>
                  <td className="num nowrap">{qtyText(standard)}</td>
                  <td className="num nowrap"><b>{qtyText(a ?? standard)}</b></td>
                  <td className="small">{a ? (a.ok ? a.shown : <span className="error">{a.message}</span>) : <span className="muted">not adjusted</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Theoretical quantities and yields</h2>
        <dl className="details">
          <dt>Core batch weight</dt><dd>{core?.ok ? grouped(core.shown) : '—'}</dd>
          {coated && <><dt>Coated batch weight</dt><dd>{coated.ok ? grouped(coated.shown) : coated.message}</dd></>}
          {yields.map((y, i) => <Fragment key={i}><dt>Yield of {y.stage}: theoretical</dt><dd className={y.ok ? '' : 'error'}>{y.text}</dd></Fragment>)}
        </dl>
      </div>
    </>
  );
}
