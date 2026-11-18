import { describe, expect, it } from 'vitest';
import { openSteps, timers } from '../shared/engine/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import type { MasterDoc } from '../shared/master/schema.js';
import { at, ev, tablet, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TB-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

// Calculation checks from the 1,000-formulation test (waves 1-5): not GMP rules. Each case cites its formulation.
type Change = (d: MasterDoc) => void;
const lines = (change: Change) => { const d = tablet(); change(d); return checks(d).map((p) => `${p.level} ${p.rule ?? '-'} ${p.path}: ${p.message}`); };
const only = (level: string, path: string) => (change: Change) => lines(change).filter((p) => p.startsWith(`${level} `) && p.includes(` ${path}: `));
const step = (d: MasterDoc, stage: string, key: string) => d.stages.find((s) => s.key === stage)!.steps.find((t) => t.key === key)!;
/** The change, then the warning `key` answered with `choice`. */
const answered = (change: Change, key: string, choice: string): Change => (d) => {
  change(d);
  const q = checks(d).find((p) => p.question?.key === key)!;
  d.answers = { ...d.answers, [key]: { about: q.message, choice, reason: '' } };
};
const salted = (from: object, to: object, mg: string, claim: string): Change => (d) => {
  Object.assign(d.formula[0]!, { mgPerTablet: mg, labelClaim: claim, adjust: { salt: { from, to } } });
};
const bromocriptine = { name: 'bromocriptine', mw: '654.6' };
const mesylate = { name: 'bromocriptine mesylate', mw: '750.7' };
const potassium = (charge?: number) => ({ name: 'potassium', mw: '39.098', ...(charge ? { charge } : {}) });
const citrate = { name: 'potassium citrate monohydrate', mw: '324.41', moleculesPerUnit: 3 };

describe('calculation checks ⛔ from the formulation test', () => {
  it.each<[string, Change, Change, string, RegExp]>([
    ['F0388 a batch quantity that per tablet × batch size does not give (1200 mg × 100 000 = 120.000 kg, not 5.440 kg)',
      (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '1200.0', batchQuantity: '5.440 kg' }); },
      (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '1200.0', batchQuantity: '120.000 kg' }); },
      'formula[0].batchQuantity', /5\.440 kg written for Examplol is not 1200\.0 mg × 100000 tablets = 120\.000 kg/],
    ['F0303 a batch column written for another batch size (half the batch)',
      (d) => { d.formula[1]!.batchQuantity = '6.000 kg'; }, (d) => { d.formula[1]!.batchQuantity = '12.0 kg'; }, 'formula[1].batchQuantity', /comes from the quantity per tablet × the batch size/],
    ['F0250 one material twice in one place with two quantities (HPC 570 g and 250 g per 10 000 tablets)',
      (d) => { d.formula.push({ ...d.formula[2]!, key: 'hpc-2', mgPerTablet: '25.0' }); d.formula[2]!.mgPerTablet = '57.0'; },
      (d) => { d.formula.push({ ...d.formula[2]!, key: 'hpc-2', mgPerTablet: '25.0', place: 'extragranular' }); },
      'formula[7]', /Povidone K30 appears twice in the binder part with two quantities \(57\.0 and 25\.0 mg/],
    ['F0122 API per tablet above the label claim without a declared overage (22 mg in a 20 mg tablet)',
      (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '22.0', labelClaim: '20 mg' }); },
      (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '20.0', labelClaim: '20 mg', adjust: { overage: { percent: '10.0' } } }); },
      'formula[0].labelClaim', /22\.000 mg of Examplol per tablet does not give the label claim 20 mg \(20\.000 mg of Examplol\).*an excess is an overage, which the batch quantity adds \(22 mg in a 20 mg tablet\)/],
    ['F0123 a stated strength 11 times the batch (11 mg against 1 mg)',
      (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '1.0', labelClaim: '11 mg' }); }, (d) => { Object.assign(d.formula[0]!, { mgPerTablet: '1.0', labelClaim: '1 mg' }); },
      'formula[0].labelClaim', /does not give the label claim 11 mg/],
    ['F0229 label claim as the mesylate 0.945 mg is 0.824 mg base, not the 0.800 mg base in the formula (× 654.6 ÷ 750.7)',
      answered(salted(bromocriptine, mesylate, '0.800', '0.945 mg'), 'label-basis/api', 'as bromocriptine mesylate'),
      answered(salted(bromocriptine, mesylate, '0.800', '0.8 mg'), 'label-basis/api', 'as bromocriptine'),
      'formula[0].labelClaim', /0\.800 mg of bromocriptine per tablet does not give the label claim 0\.945 mg \(0\.824 mg of bromocriptine\)/],
    ['F0393 a label claim in mEq without the ion charge from the material (10 mEq K = 390.98 mg K)',
      (d) => { salted(potassium(), citrate, '391.0', '10 mEq')(d); }, (d) => { salted(potassium(1), citrate, '391.0', '10 mEq')(d); },
      'formula[0].labelClaim', /10 mEq is in mEq: give the salt form from the ion with its charge/],
    ['F0225 one blend for two strengths: 50 mg at 115.0 mg tablets holds 46.0 mg (a wrong strength ratio gives 7-15 % less)',
      (d) => { d.header.otherStrengths = [{ name: '50 mg', labelClaim: '50 mg', coreWeightMg: '115.0' }]; },
      (d) => { d.header.otherStrengths = [{ name: '50 mg', labelClaim: '50 mg', coreWeightMg: '125.0' }]; },
      'header.otherStrengths[0]', /Examplol in 50 mg: 46\.000 mg of Examplol per tablet does not give the label claim 50 mg/],
    ['F0205 an in-process result into T18 without saying content or % of theoretical',
      (d) => { d.formula[4]!.adjust = { content: { formulaQuantityIs: 'dry', contentSource: 'in-process result' } }; },
      (d) => { d.formula[4]!.adjust = { content: { formulaQuantityIs: 'dry', contentSource: 'in-process result', resultType: 'percent of theoretical', nominalContent: '30 %' } }; },
      'formula[4].adjust', /State what the in-process result for Microcrystalline cellulose is: the content \(% w\/w\) or a relative assay in % of theoretical/],
    ['F0042 coating lines that do not add up to the coated − core weight (7.0 against 7.5 mg)',
      (d) => { d.formula[6]!.mgPerTablet = '7.0'; }, () => {}, 'formula', /coating materials add up to 7 mg per tablet, not the coated − core weight 7\.5 mg/],
  ])('calculation check ⛔ %s', (_what, bad, fixed, path, message) => {
    expect(only('error', path)(bad)).toEqual([expect.stringMatching(message)]);
    expect(only('error', path)(fixed)).toEqual([]);
  });

  it('calculation check ⛔ F0339 a liquid made with an overage needs the amount to apply per charge on the spray step', () => {
    const suspension = (apply?: { liquid: string; charge: string }): Change => (d) => {
      d.formula[6]!.adjust = { overage: { percent: '20.0' } };
      d.stages.splice(3, 0, { key: 'suspension', name: 'Coating suspension', kind: 'preparation', roomTypes: [], machineTypes: [], role: '', uses: [], produces: { name: 'coating suspension', holdHours: 24 },
        steps: [{ key: 'make', block: { id: 'coating-suspension', version: 1 }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' },
          settings: { powder: { formula: 'coat', adjusted: true }, targetSolids: '15 %', tolerance: '1.0', mixTimeLimit: { low: '30', high: '60', unit: 'min' } } }] });
      d.stages[4]!.uses.push('suspension');
      if (apply) d.stages[4]!.steps[0]!.applyPerCharge = apply;
    };
    expect(only('error', 'stages[4].steps[0]')(suspension())).toEqual([expect.stringMatching(/made with an overage: state the amount to apply per charge.*\(spraying all of it gives about 4\.5 % more drug\)/)]);
    expect(lines(suspension({ liquid: '971 g', charge: '150 g' })).filter((p) => p.startsWith('error'))).toEqual([]);
    expect(only('error', 'stages[4].steps[0].applyPerCharge.charge')(suspension({ liquid: '971 g', charge: '150' }))).toEqual([expect.stringMatching(/not a mass with a unit/)]);
  });

  it('calculation check ⛔ F0393 a label claim in mEq with the charge passes, and the formula form is the ion', () => {
    expect(lines(salted(potassium(1), citrate, '391.0', '10 mEq')).filter((p) => p.includes('labelClaim'))).toEqual([]);
    expect(only('error', 'formula[0].labelClaim')(salted(potassium(1), citrate, '1081.0', '10 mEq'))).toEqual([expect.stringMatching(/1081\.000 mg of potassium.*\(390\.980 mg of potassium\)/)]);
  });
});

describe('calculation checks ⚠️ from the formulation test', () => {
  const thin = (d: MasterDoc) => { step(d, 'compression', 'compress').settings.thicknessLimit = { low: '2.0', high: '2.4', unit: 'mm' }; d.header.dieAreaMm2 = '3.1416'; };
  const sizeTest = (limit: object): Change => (d) => { step(d, 'coating', 'qa-hold').settings = { what: 'API lot d90 (certificate)', unit: 'µm', limit: limit as never }; };
  it.each<[string, Change, Change, string, string, string]>([
    ['F0135 a target weight that does not fit the tooling (79 mg in a 2 mm die 2.2 mm thick is 11.4 g/cm³)',
      (d) => { thin(d); d.header.coreWeightMg = '79.0'; }, (d) => { thin(d); d.header.coreWeightMg = '7.9'; }, 'tooling/compression/compress', 'stages[2].steps[0]', 'confirmed'],
    ['F0175 a weight target that does not name its stage (compressed to 150 mg, core 250 mg)',
      (d) => { step(d, 'compression', 'compress').settings.meanLimit = { low: '145.5', high: '154.5', unit: 'mg' }; }, () => {},
      'weight-stage/compression/compress/meanLimit', 'stages[2].steps[0].settings.meanLimit', 'weight at this step'],
    ['F0204 a solvent-wet API weighed without a solvent correction',
      (d) => { Object.assign(d.formula[0]!, { name: 'Examplol wet cake', adjust: { potency: { basis: 'as is', standardIs: 'anhydrous' } } }); },
      (d) => { d.formula[0]!.name = 'Examplol wet cake'; }, 'solvent-wet/api', 'formula[0]', 'weighed dry'],
    ['F0476 a processing aid counted in the tablet (polyethylene rinsed out)',
      (d) => { d.formula[4]!.name = 'Polyethylene'; }, (d) => { Object.assign(d.formula[4]!, { name: 'Polyethylene', role: 'solvent' }); }, 'removed/mcc', 'formula[4]', 'stays in the tablet'],
    ['F0490 a particle-size limit on one side only (d90 not more than 10 µm)',
      sizeTest({ high: '10', unit: 'µm' }), sizeTest({ low: '2', high: '10', unit: 'µm' }), 'two-sided/coating/qa-hold', 'stages[3].steps[1].settings.limit', 'one side is enough'],
    ['F0318 an order-critical step moved before the step it must follow',
      (d) => { step(d, 'granulation', 'charge-api').orderAfter = 'granulate'; }, (d) => { step(d, 'granulation', 'charge-api').orderAfter = 'weigh-lactose'; },
      'order/granulation/charge-api', 'stages[1].steps[2]', 'new order confirmed'],
    ['F0057 label basis per strength (a salt-named API with a second strength from the same blend)',
      (d) => { d.formula[0]!.name = 'Examplol hydrochloride'; d.header.otherStrengths = [{ name: '50 mg', labelClaim: '50 mg', coreWeightMg: '125.0' }]; },
      (d) => { d.header.otherStrengths = [{ name: '50 mg', labelClaim: '50 mg', coreWeightMg: '125.0' }]; }, 'label-basis/api/50 mg', 'header.otherStrengths[0]', 'as Examplol hydrochloride'],
  ])('calculation check ⚠️ %s: fires, passes, and once answered no longer blocks', (_what, fires, passes, key, path, choice) => {
    const d = tablet();
    fires(d);
    const q = checks(d).find((p) => p.question?.key === key)!;
    expect(q).toMatchObject({ level: 'warning', path, question: { options: expect.arrayContaining([choice]) } });
    expect(blocking(q)).toBe(true);
    const ok = tablet();
    passes(ok);
    expect(checks(ok).some((p) => p.question?.key === key)).toBe(false);
    d.answers = { [key]: { about: q.message, choice, reason: q.question!.needsReason ? 'Per the development report' : '' } };
    expect(blocking(checks(d).find((p) => p.question?.key === key)!)).toBe(false);
  });
});

describe('F4 by rule and F6 with a changing interval (data-level options)', () => {
  it('F4 F0040: a step only for a core batch of at most 50 kg is in for 25 kg and left out for 75 kg, with no operator choice', () => {
    const rule = (high: string): Change => (d) => { step(d, 'compression', 'yield').onlyIf = { header: 'coreBatch', limit: { high, unit: 'kg' } }; };
    const v = (change: Change) => { const d = tablet(); change(d); return openSteps(d, [], at(0)).steps.find((s) => s.stepKey === 'yield' && s.stageKey === 'compression')!; };
    expect(v(rule('50')).state).not.toBe('not_applicable'); // 250 mg × 100 000 = 25 kg
    expect(v(rule('20'))).toMatchObject({ state: 'not_applicable', leftOut: expect.stringMatching(/only when the core batch weight is/) });
    expect(only('error', 'stages[2].steps[1].onlyIf')((d) => { step(d, 'compression', 'yield').onlyIf = { header: 'coreBatch', limit: { high: '50', unit: 'tablets' } }; }))
      .toEqual([expect.stringMatching(/The rule for leaving the step out: .*cannot be converted/)]);
  });

  it('F6 F0030: checks every 30 min, then every 15 min after 60 min; a later interval above 30 min is TB-15', () => {
    const d = tablet();
    step(d, 'compression', 'compress').everyMinutesLater = { afterMinutes: 60, everyMinutes: 15 };
    expect(checks(d)).toEqual([]);
    const events = [ev('started', '2.1.0.1', { min: 0 }), ev('started', '2.1.0.2', { min: 30 }), ev('started', '2.1.0.3', { min: 60 })];
    const t = timers(d, events, at(61)).find((x) => x.kind === 'periodic' && x.key.round === 4)!;
    expect([t.at.getTime() - at(0).getTime(), t.label]).toEqual([75 * 60_000, 'Check 4 of “Compress with periodic checks” (every 15 min)']);
    step(d, 'compression', 'compress').everyMinutesLater = { afterMinutes: 60, everyMinutes: 45 };
    expect(checks(d).map((p) => p.message)).toEqual(['Periodic checks every 45 min: they must be at least every 30 min']);
  });
});
