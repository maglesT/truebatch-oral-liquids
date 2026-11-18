// TB-22: the batch record as a PDF, the way the Logbook makes its copies. Everything comes from the master version and
// the events, worked out by the engine as on screen; nothing is typed again. Changed values are marked: the original
// is struck through and kept with the reason, the person and the time.
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';
import { findBlock, type Block } from '../shared/blocks/index.js';
import { materialLines, type Step } from '../shared/master/schema.js';
import { batchView, deviations, deviationNumber, deviationText, fieldLabel, handFields, lateItems, lineQuantity, notYetText, cutShort, terminatedText, TERMINATED_STATE, openSteps, PROVIDER_NAME, deviationStatusWords, stepTitle, unitName, headline, limitOf, withoutVerdict, statusWords, CERTIFICATE, perPackText, trainingOf, trainingText, trainingTyped, skillText, bulkCheckedText, bulkNotCheckedText, bulkOpenText, type BulkDeviations, type DeviationStatus, type EventKind, type Source, type Stored, type StepView, type Value } from '../shared/engine/index.js';
import type { LoadedBatch } from './routes/batches.js';
import { pageFrame, plant, runs } from './pdf.js';
import { plantText } from '../shared/plant-time.js';

// A signature of the batch; `step` is the step instance of a step signature.
export interface Signature { objectType: string; objectId: number; printedName: string; meaning: string; signedAt: Date; step: string | null }
// deviationsRead: the deviations as the Deviations system has them now (null without the link). units: master data's
// units of the materials by item id, a quantity named as master data names the same unit (nos for units), as on screen.
// bulk: packing (whole-suite run, S24), the bulk batch's open deviations as read now (server/routes/batches.ts bulkDeviations).
export interface RecordInput extends LoadedBatch { versionNo: number; issuedByName: string; signatures: Signature[]; deviationsRead?: ReadonlyMap<string, DeviationStatus> | null;
  units?: ReadonlyMap<string, string>; bulk?: BulkDeviations | null }

const MEANING: Record<string, string> = {
  issued: 'Issued', performed: 'Performed', verified: 'Verified (second person)', released: 'Released', rejected: 'Rejected',
  production_approved: 'Production approved', qc_approved: 'QC approved',
};
const EVENT: Record<EventKind, string> = {
  started: 'Started', value: 'Recorded', done: 'Signed as done', checked: 'Checked', sent_back: 'Sent back', corrected: 'Corrected',
  not_applicable: 'Not applicable', late: 'Ran over (server timer)', qa_released_hold: 'QA released the hold', note: 'Deviation note',
  demo_wait_skipped: 'DEMO: wait skipped',
};
const STATE: Record<string, string> = {
  waiting: 'not started', open: 'not started', in_progress: 'in progress', done_awaiting_check: 'waiting for check', done: 'done', checked: 'checked', not_applicable: 'not applicable',
};

const RED = '#b3261e';
const isItem = (v: Value): v is { itemId: string; code: string; name: string; version: number } => typeof v === 'object' && !Array.isArray(v) && 'itemId' in v;
export function valueText(v: Value | undefined, stockUnit?: string): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => x.value).join(', ') + (v[0]?.unit ? ` ${unitName(v[0].unit, stockUnit)}` : '');
  // Master data's version of a machine or room stays in the event; the record names the item (owner, 17 Nov 2026).
  if (isItem(v)) return `${v.code} · ${v.name}`;
  if (typeof v === 'object') return `${v.value}${v.unit ? ` ${unitName(v.unit, stockUnit)}` : ''}`;
  return plantText(v, true);
}
/** The value at the end of a worked line ("… = 10.152 kg"). */
const endOf = (r: Stored) => (r.ok ? (/=\s*([^=;]+)$/.exec(r.shown)?.[1]?.trim() ?? `${r.value} ${r.unit}`) : '');
// A formula line's role and place in words, never their keys (owner, 17 Nov 2026).
const ROLE: Record<string, string> = { api: 'API', excipient: 'Excipient', solvent: 'Solvent' };
const PLACE: Record<string, string> = { intragranular: 'intragranular', extragranular: 'extragranular', binder: 'binder solution', coating: 'coating' };
const checksOf = (r: Stored) => (r.ok ? Object.entries(r).filter(([k, v]) => /check$/i.test(k) && v && typeof v === 'object') as [string, { pass: boolean; shown: string }][] : []);

const small = (text: string, extra: Record<string, unknown> = {}): Content => ({ text: runs(text), fontSize: 7.5, ...extra }) as Content;
const heading = (text: string): Content => ({ text: runs(text), bold: true, fontSize: 11, margin: [0, 12, 0, 4] });
const th = (text: string): Content => ({ text, fontSize: 8, bold: true, fillColor: '#eef1f4' });
const table = (widths: (number | string)[], head: string[], rows: Content[][], empty = 'None.'): Content =>
  rows.length ? { table: { headerRows: 1, dontBreakRows: true, widths, body: [head.map(th), ...rows] }, layout: 'lightHorizontalLines' } : { text: empty, italics: true, fontSize: 8 };

export function batchRecordDoc(r: RecordInput, by: string, printedAt = new Date(), demo = false): TDocumentDefinitions {
  const { doc, events, batchEvents, now } = r;
  const h = doc.header;
  const view = batchView(doc, events, batchEvents, now, r.deviationsRead);
  const { steps } = openSteps(doc, events, now);
  const names = new Map(events.map((e) => [e.person, e.personName]));
  const who = (id: number | null) => (id === null ? 'server' : names.get(id) ?? `person ${id}`);
  const sigOf = new Map(r.signatures.filter((s) => s.objectType === 'step_event').map((s) => [s.objectId, s]));
  const stepOf = (v: StepView) => doc.stages[v.key.stage]!.steps[v.key.step]!;
  // Master data's unit of a step's material.
  const unitOf = (v: StepView) => {
    const m = Object.values(stepOf(v).settings).find((x): x is { formula: string } => typeof x === 'object' && 'formula' in x);
    return m && r.units?.get(materialLines(doc).find((l) => l.key === m.formula)?.materialItemId ?? '');
  };
  const stepName = (v: StepView) => {
    const s = doc.stages[v.key.stage]!;
    const st = stepOf(v);
    return `${v.key.stage + 1}.${v.key.step + 1} ${stepTitle(doc, st)}${s.kind === 'sub-batch' ? ` · sub-batch ${v.key.sub}` : ''}${st.flow.kind === 'repeat-until' ? ` · round ${v.key.round}` : ''}`;
  };
  const byId = new Map(steps.map((v) => [v.id, v]));
  const stepLabel = (id: string) => { const v = byId.get(id); return v ? `${doc.stages[v.key.stage]!.name} · ${stepName(v)}` : id; };

  const record = doc.pack ? 'Packing record' : 'Batch record';
  // A batch QA terminated: said at the top and in the decisions.
  const ended = batchEvents.find((b) => b.payload.terminated);
  const endedText = ended && terminatedText(ended, plant);
  // What a terminated batch never did is not "yet" to come (owner 16 Nov 2026).
  const notYet = (what: string) => (ended ? `not ${what} (terminated)` : `not ${what} yet`);
  const facts = doc.pack ? steps.find((v) => v.id === '0.1.0.1') : undefined;
  const content: Content[] = [
    { text: runs(`${record} ${r.batch.batchNo}`), fontSize: 16, bold: true },
    { text: runs(`${h.productCode} · ${h.productName}`), fontSize: 11, margin: [0, 2, 0, 8] },
    { table: { widths: [90, '*', 90, '*', 90, '*'], body: [
      [th('Product'), small(`${h.productCode} · ${h.productName}`), th('Batch no.'), small(r.batch.batchNo, { bold: true }), th('Status'), small(statusWords(view.status, !!doc.pack, true), { bold: true })],
      doc.pack ? [th('Pack'), small(`${doc.pack.type}, ${doc.pack.unitsPerPack} tablets per pack, ${doc.pack.packsPerCarton} packs per carton; ${doc.pack.destination}${doc.pack.mrp ? `, MRP Rs. ${doc.pack.mrp}` : ''}`),
        th('Bulk'), small(`${doc.pack.bulkCode} · batch ${valueText(facts?.values.bulk)} · ${valueText(facts?.values.tablets)} issued · line ${valueText(facts?.values.line)}${facts?.results.expiry?.ok ? ` · ${facts.results.expiry.shown}` : ''}`),
        th('Master version'), small(`version ${r.versionNo}`)]
        : [th('Batch size'), small(`${Number(h.batchSize).toLocaleString('en-IN')} tablets`), th('Core tablet weight'), small(`${h.coreWeightMg} mg${h.coatedWeightMg ? ` (coated ${h.coatedWeightMg} mg)` : ''}`), th('Master version'), small(`version ${r.versionNo}`)],
      [th('Issued'), small(`${r.issuedByName}, ${plant(r.batch.issuedAt)}`), th('Times'), small('plant time (IST)'), th('Changed values'), small('marked CHANGED; the original is struck through, with the reason', { color: RED })],
    ] }, layout: 'lightHorizontalLines' },
    ...(endedText ? [small(endedText, { bold: true, color: RED, margin: [0, 6, 0, 0] })] : []),
  ];

  // Packing: the packing materials, with the lots and quantities issued and their reconciliation.
  const naming = (v: StepView, key: string, block: string) => stepOf(v).block.id === block && Object.values(stepOf(v).settings).some((x) => typeof x === 'object' && 'formula' in x && x.formula === key);
  if (doc.pack) content.push(heading('Packing materials'), table([150, 70, 60, '*', '*'], ['Material', 'Kind', 'Quantity', 'Lots and quantities issued', 'Reconciliation'], doc.pack.materials.map((m) => [
    small(`${m.code} · ${m.name}`), small(`${m.kind}${m.printed ? ', printed' : ''}${m.coded ? ', coded' : ''}`), small(perPackText(m, r.units?.get(m.materialItemId))),
    small(steps.filter((v) => naming(v, m.key, 'pack-material-issue')).map((v) => `${v.values.lot === undefined ? 'not issued' : `Lot ${valueText(v.values.lot)}: ${valueText(v.values.issued, unitOf(v))}`} · ${stepName(v)}`).join('\n') || notYet('issued')),
    // A count in master data's name for it (nos), as the per-pack column; the verdict once, after the line.
    small(steps.filter((v) => naming(v, m.key, 'printed-reconciliation')).map((v) => {
      const rec = v.results.reconciliation;
      if (!rec?.ok) return notYet('reconciled');
      const shown = withoutVerdict(rec.shown).replace(/\bunits\b/g, unitName('units', r.units?.get(m.materialItemId)));
      return `${shown}: ${checksOf(rec).every(([, c]) => c.pass) ? 'PASS' : 'FAIL'}`;
    }).join('\n') || (m.printed ? notYet('reconciled') : '—')),
  ])));

  // The formula, with the lots and the quantities dispensed (the weighing steps that name the line).
  if (!doc.pack) content.push(heading('Formula'));
  if (!doc.pack) content.push(table([150, 90, 55, 80, '*'], ['Material', 'Role · place', 'mg per tablet', 'Batch quantity', 'Lots and dispensed quantities'], doc.formula.map((l) => {
    const q = lineQuantity(doc, [], { stage: 0, sub: 1, step: 0, round: 1 }, l, false, {});
    const weighed = steps.filter((v) => Object.values(stepOf(v).settings).some((s) => typeof s === 'object' && 'formula' in s && s.formula === l.key && findBlock(stepOf(v).block)?.gmp === 'weighing'));
    return [small(`${l.code} · ${l.name}`), small(`${ROLE[l.role] ?? l.role} · ${PLACE[l.place] ?? l.place}`), small(l.mgPerTablet), small(endOf(q)),
      small(weighed.map((v) => {
        const net = v.results.net;
        if (!net) return `${notYet('weighed')} · ${stepName(v)}`;
        // The target: the weighing's own, or the lubricant re-scaled to the actual granules.
        const target = v.results.target?.ok ? v.results.target : v.results.rescaled?.ok ? v.results.rescaled : undefined;
        return `Lot ${valueText(v.values.lot)}: ${endOf(net)}${target ? ` (target ${endOf(target)})` : ''} · ${stepName(v)}`;
      }).join('\n') || '—')];
  })));

  // The deviations of the notes: the number written with the note, or the one Deviations filed from it (read live).
  const devs = deviations(events, batchEvents, r.deviationsRead);
  const devOf = (e: { id: number }) => devs.find((x) => x.note === e.id);

  // Every stage and step: values, worked calculation lines with limits and pass/fail, who did and checked what and when.
  doc.stages.forEach((s, si) => {
    const mine = steps.filter((v) => v.key.stage === si);
    const yields = mine.filter((v) => findBlock(stepOf(v).block)?.gmp === 'yield' && v.results.yield?.ok)
      .map((v) => `yield ${endOf(v.results.yield!)}${checksOf(v.results.yield!).some(([, c]) => !c.pass) ? ' (OUT OF LIMITS)' : ''}${s.kind === 'sub-batch' ? ` in sub-batch ${v.key.sub}` : ''}`);
    content.push(heading(`Stage ${si + 1}: ${s.name}`));
    content.push(small([s.kind === 'preparation' ? 'Preparation' : s.kind === 'sub-batch' ? `${s.count} sub-batches` : 'Stage', s.role, s.roomTypes.length ? `rooms: ${s.roomTypes.join(', ')}` : '',
      ...yields].filter(Boolean).join(' · '), { margin: [0, 0, 0, 4] }));
    content.push(table([120, '*', '*', 175], ['Step', 'Recorded values', 'Calculations, limits and result', 'Who and when'], mine.map((v) => {
      const st = stepOf(v);
      const block = findBlock(st.block);
      return [
        { stack: [small(stepName(v), { bold: true }), small((ended && TERMINATED_STATE[v.state]) || (STATE[v.state] ?? v.state), { color: v.state === 'not_applicable' ? '#666666' : undefined })] },
        { stack: block ? valueLines(block, v, who, unitOf(v)) : [] },
        { stack: block ? resultLines(block, st, v, who, cutShort(ended, v, steps), unitOf(v)) : [] },
        { stack: v.events.filter((e) => e.kind !== 'value').map((e) => {
          // Demo installations only (server/demo.ts).
          if (e.kind === 'demo_wait_skipped') return small(`DEMO: wait skipped by ${who(e.person)} at ${plant(e.at)} · ${String(e.payload.label ?? '')}`, { color: RED, bold: true });
          const sig = sigOf.get(e.id);
          const d = e.kind === 'note' ? devOf(e) : undefined;
          const extra = e.payload.reason ? ` · reason: ${e.payload.reason}` : e.payload.text ? ` · ${d ? `deviation ${deviationText(d)}: ` : ''}${e.payload.text}` : '';
          // Packing: the batch facts are recorded when the batch is issued (the issuer starts the first step); the
          // operator then receives the bulk and signs it done.
          const kind = doc.pack && v.id === '0.1.0.1' && e.kind === 'started' ? 'Batch facts recorded at issue' : EVENT[e.kind];
          // The signer's training in the step's skill (owner, 17 Nov 2026): from Recruitment, or typed by hand.
          const trained = trainingOf(e);
          const training = trained ? ` · ${trained.from === 'hand' ? trainingText(trained).toUpperCase() : trainingText(trained)}` : '';
          return small(`${kind}: ${who(e.person)}, ${plant(e.at)}${sig ? ` · signed "${MEANING[sig.meaning] ?? sig.meaning}"` : ''}${training}${extra}`,
            e.kind === 'late' || e.kind === 'sent_back' || trained?.from === 'hand' ? { color: RED } : {});
        }) },
      ];
    }), 'No steps.'));
  });

  // Timers that ran over, with the deviation notes made after them.
  content.push(heading('Timers that ran over'));
  content.push(table([250, 120, '*'], ['Timer', 'Due', 'Deviation notes'], lateItems(doc, events, now).map((l) => [
    small(l.timer.label), small(plant(l.timer.at)), small(l.notes.map((n) => `${devOf(n) ? `${devOf(n)!.reference}: ` : ''}${n.payload.text ?? ''} (${who(n.person)}, ${plant(n.at)})`).join('\n') || 'NO DEVIATION NOTE', l.notes.length ? {} : { color: RED }),
  ])));

  // Deviation notes with their number and status (a note with a deviation number is open until it is closed: in the
  // Deviations system while it answers, else by QA); a number typed by hand, or filed in Deviations from the note, says so.
  content.push(heading('Deviation notes'));
  content.push(table([70, 170, '*', 110, 170], ['Deviation', 'Step', 'Note', 'Written', 'Status'], events.filter((e) => e.kind === 'note').map((e) => {
    const d = devOf(e);
    const closed = d?.closed && batchEvents.find((b) => b.id === d.closed!.id);
    return [small(d ? deviationNumber(d) : '—'), small(stepLabel(`${e.stage}.${e.sub}.${e.step}.${e.round}`)), small(e.payload.text ?? ''), small(`${who(e.person)}, ${plant(e.at)}`),
      small(!d ? 'note (no deviation number)' : d.status ? `${d.open ? 'OPEN: ' : ''}${deviationStatusWords(d.status)} in the Deviations system${d.closedAt ? `, ${plant(d.closedAt)}` : ''}` : d.open ? 'OPEN' : `closed by ${closed?.personName ?? ''}, ${plant(closed?.at)}: ${closed?.payload.reason ?? ''}`, d?.open ? { color: RED } : {})];
  })));

  // Packing (whole-suite run, S24): the bulk batch's deviations still open, as read now; release waits for them. A link
  // that did not answer: not checked, QA confirms by hand at release (the release decision below says what QA typed).
  if (r.bulk) {
    content.push(heading(`Open deviations of the bulk batch ${r.bulk.bulk}`));
    content.push(r.bulk.state !== 'ok' ? small(`${bulkNotCheckedText(r.bulk)}: QA confirms by hand at release.`, { color: RED })
      : r.bulk.open.length ? { stack: r.bulk.open.map((d) => small(`${bulkOpenText(r.bulk!.bulk, d)}${d.title ? ` · ${d.title}` : ''}`, { color: RED })) }
      : small('None: every deviation of the bulk batch is closed in the Deviations system.'));
  }

  // Signatures whose training was typed by hand because Recruitment was not reachable, for QA (owner, 17 Nov 2026);
  // only when the master names a training.
  if (doc.stages.some((s) => s.steps.some((t) => t.training))) {
    content.push(heading('Training typed by hand (Recruitment not reachable)'));
    content.push(table([170, 150, 120, '*'], ['Step', 'Signed by', 'When', 'Training'], trainingTyped(events).map((x) => [
      small(stepLabel(x.step)), small(`${who(x.person)} (${x.kind === 'checked' ? 'checked' : 'performed'})`), small(plant(x.at)),
      small(`${skillText(x)}: ticked "I am trained", Recruitment ${x.state === 'down' ? 'link down' : 'not linked'}`, { color: RED }),
    ]), 'None: every training was read from Recruitment.'));
  }

  // Every signature of the batch with its meaning.
  content.push(heading('Signatures'));
  content.push(table([150, 140, 130, '*'], ['Meaning', 'Signed by', 'When', 'What was signed'], r.signatures.map((s) => {
    const what = s.objectType === 'batch' ? `Batch ${r.batch.batchNo}` : s.step ? stepLabel(s.step) : 'The batch record';
    return [small(MEANING[s.meaning] ?? s.meaning), small(s.printedName), small(plant(s.signedAt)), small(what)];
  })));

  // The decisions: production approval, QC approval (with the QC report), QA release or rejection.
  content.push(heading('Release decision'));
  const decisions = batchEvents.filter((b) => b.kind !== 'deviation_closed');
  content.push(decisions.length ? { stack: decisions.map((b) => small(b === ended ? endedText! :
    `${MEANING[b.kind] ?? b.kind}: ${b.personName}, ${plant(b.at)}${b.payload.reportNo ? ` · QC report ${b.payload.reportNo}` : ''}${b.payload.reason ? ` · reason: ${b.payload.reason}` : ''}${b.payload.bulk ? ` · ${bulkCheckedText(b.payload.bulk)}` : ''}`,
    { fontSize: 9, bold: b.kind === 'released' || b.kind === 'rejected', color: b.kind === 'rejected' ? RED : undefined, margin: [0, 0, 0, 2] })) }
    : { text: `No decision yet: the batch is ${statusWords(view.status, !!doc.pack)}.`, italics: true, fontSize: 9 });
  if (view.status !== 'released' && view.status !== 'rejected') content.push(small(`This copy was made while the batch is ${statusWords(view.status, !!doc.pack)}: it is not a released record.`, { color: RED, margin: [0, 4, 0, 0] }));

  return pageFrame(`${doc.pack ? 'TrueBatch Tablets Packing' : 'TrueBatch Tablets'} · ${record} ${r.batch.batchNo} · ${h.productCode} ${h.productName}`, by, content, printedAt, demo);
}

/** The recorded values; a corrected value shows the original struck through, the reason, the person and the time. */
function valueLines(block: Block, v: StepView, who: (id: number | null) => string, stockUnit?: string): Content[] {
  // Label answers typed while a link was off stay in the record when the link gives the value again.
  const names = new Set([...block.fields, ...handFields(block.fields, v.source)].map((f) => f.name).concat(Object.keys(v.values), v.replaced.map((x) => x.field)));
  return [...names].filter((name) => v.values[name] !== undefined || v.replaced.some((x) => x.field === name)).map((name) => {
    const changes = v.replaced.filter((x) => x.field === name);
    const now = runs(`${fieldLabel(block.fields, name)}: ${valueText(v.values[name], stockUnit)}${name in CERTIFICATE ? certificateText(v.source[name]) : sourceText(v.source[name])}`);
    if (!changes.length) return { text: now, fontSize: 7.5 };
    return { stack: [
      { text: [...now, { text: '  CHANGED', bold: true, color: RED }], fontSize: 7.5 },
      ...changes.map((c) => ({ text: [{ text: 'was ' }, ...runs(valueText(c.was, stockUnit)).map((x) => ({ ...x, decoration: 'lineThrough' as const })),
        ...runs(` · reason: ${c.reason} · ${who(c.person)}, ${plant(c.at)}`)], fontSize: 7, color: RED, margin: [8, 0, 0, 0] as [number, number, number, number] })),
    ] } as Content;
  });
}

// Where a value came from: pulled through a link (as read), or typed by hand while the link was off or down.
const sourceText = (s: Source | undefined) => (!s ? '' : s.from === 'hand' ? ` (BY HAND: ${PROVIDER_NAME[s.link]} ${s.state === 'down' ? 'link down' : 'not linked'})` : ` (${plantText(s.shown, true)})`);

// A certificate value from MMS: its basis and report, without the value said again ("· as is, MMS report QC/RM/26/1171").
function certificateText(s: Source | undefined): string {
  const m = s && s.from !== 'hand' ? /^\S+ [\d.]+ %(?: \(([^)]*)\))?, report (.+)$/.exec(s.shown) : null;
  return m ? ` · ${m[1] ? `${m[1]}, ` : ''}${PROVIDER_NAME[(s as { from: keyof typeof PROVIDER_NAME }).from]} report ${m[2]}` : sourceText(s);
}

/** The worked calculation lines, with the limits and pass or fail; a count of the step's material in master data's name
 *  for it (nos for units), as its recorded values and the floor's worked lines. */
function resultLines(block: Block, st: Step, v: StepView, who: (id: number | null) => string, terminated: boolean, stockUnit?: string): Content[] {
  const label = (name: string) => block.calcs.find((c) => c.name === name)?.label ?? block.settings.find((s) => s.name === name)?.label ?? name;
  const out: Content[] = Object.entries(v.results).flatMap(([name, r]) => {
    if (!r.ok) return [small(`${label(name)}: ${r.message}`, { color: RED })];
    const checks = checksOf(r);
    // A round whose stop check is not reached yet is not out of limits: the rounds go on.
    const notYet = name === v.notYet;
    const counted = (t: string) => t.replace(/\bunits\b/g, unitName('units', stockUnit));
    const text = (t: string) => counted(plantText(notYet ? notYetText(t, terminated) : t, true));
    // A check's worked line may start with its own question ("Packing finished: no", "Line clear after packing: …"):
    // the label is not said twice.
    // A figure leads, with its limit (owner, 17 Nov 2026); the worked lines follow without their verdict, which the
    // verdict line under them says once.
    const h = headline(r) && counted(headline(r)!);
    const limit = limitOf(r) && counted(limitOf(r)!);
    const shown = withoutVerdict(text(r.shown));
    const lead = h ? `${label(name)}: ${h}${limit ? ` (limit ${limit})` : ''}` : shown.toLowerCase().startsWith(label(name).toLowerCase()) ? shown : `${label(name)}: ${shown}`;
    return [
      small(lead, h ? { bold: true } : {}),
      ...(h ? [small(shown, { color: '#555555', margin: [8, 0, 0, 0] })] : []),
      ...checks.filter(([, c]) => c.shown !== r.shown).map(([, c]) => small(withoutVerdict(text(c.shown)), { color: '#555555', margin: [8, 0, 0, 0] })),
      ...checks.map(([, c]) => small(c.pass ? 'PASS' : notYet ? (terminated ? 'NOT REACHED: terminated' : 'NOT YET: the rounds go on') : 'FAIL: out of limits', { bold: true, color: c.pass ? '#1b6e3a' : notYet ? '#666666' : RED, margin: [8, 0, 0, 2] })),
    ];
  });
  if (v.inputChanged.length) out.push(small(`Worked out again: an input was corrected later (${v.inputChanged.map((e) => `${who(e.person)}, ${plant(e.at)}`).join('; ')})`, { color: RED }));
  if (!out.length && st.flow.kind === 'qa-hold') out.push(small('QA hold'));
  return out;
}
