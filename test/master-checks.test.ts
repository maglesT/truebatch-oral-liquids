import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../shared/blocks/index.js';
import { blockProblems, type Block } from '../shared/blocks/format.js';
import { evaluate } from '../shared/engine/index.js';
import { blocking, masterChecks } from '../shared/master/checks.js';
import { masterSchema, type MasterDoc } from '../shared/master/schema.js';
import { placed, tablet, unplaced } from './engine-fixture.js';
// The problems, without the rooms a stage must name (TB-11): the fixtures name none.
const checks = (d: Parameters<typeof masterChecks>[0]) => unplaced(masterChecks(d));

/** The fixture with one change; the problems that change makes. */
function after(change: (d: MasterDoc) => void) {
  const d = tablet();
  change(d);
  return checks(d).map((p) => `${p.level} ${p.rule ?? '-'} ${p.path}: ${p.message}`);
}
const errors = (change: (d: MasterDoc) => void) => after(change).filter((p) => p.startsWith('error'));
const step = (d: MasterDoc, stage: string, key: string) => d.stages.find((s) => s.key === stage)!.steps.find((t) => t.key === key)!;

describe('blocks are data', () => {
  it.each(BLOCKS.map((b) => [b.id, b] as const))('the %s block is a valid description', (_id, b) => {
    expect(blockProblems(b)).toEqual([]);
  });

  it('no calculation label states its own outcome (the record never reads "Within limits: … OUT OF LIMITS")', () => {
    const labels = BLOCKS.flatMap((b) => b.calcs.map((c) => c.label));
    expect(labels.filter((l) => /within|out of|pass|fail/i.test(l))).toEqual([]);
    expect(labels).toContain('Result against limits');
  });

  it('a block naming an unknown template, field or stop check is refused', () => {
    const bad: Block = { ...BLOCKS[0]!, calcs: [{ name: 'x', label: 'X', template: 'T99', args: { a: '$nothing' } }], stop: 'y' };
    expect(blockProblems(bad)).toEqual(['calculation x: unknown template T99', 'calculation x: "$nothing" is not a field, setting or earlier calculation', 'stop: no calculation y']);
  });
});

describe('master checks', () => {
  it('the fixture tablet master passes every check', () => {
    expect(checks(tablet())).toEqual([]);
    expect(masterChecks(placed(tablet()))).toEqual([]);
  });

  it('TB-11 a stage that works machines or names a room, with no rooms chosen, is an error; balances alone and the line a packing batch is issued to are not', () => {
    expect(masterChecks(tablet()).filter((p) => p.rule === 'TB-11').map((p) => `${p.path}: ${p.message}`)).toEqual(['Binder solution', 'Granulation', 'Compression', 'Coating']
      .map((name, i) => `stages[${i}].roomTypes: Stage ${name}: choose the rooms this stage may run in (an area or a room of master data, in the stage settings)`));
    const d = placed(tablet());
    d.stages[0]!.roomTypes = [];
    d.stages[0]!.steps = d.stages[0]!.steps.filter((t) => t.block.id === 'weigh');
    expect(masterChecks(d).filter((p) => p.rule === 'TB-11')).toEqual([]);
  });

  it('a draft may be incomplete, but its shape is checked', () => {
    expect(masterSchema.safeParse({ ...tablet(), stages: [{ key: 'X Y' }] }).success).toBe(false);
  });

  it.each<[string, (d: MasterDoc) => void, string]>([
    ['weighing', (d) => { step(d, 'granulation', 'weigh-api').checker = false; }, 'error TB-08 stages[1].steps[0]: A weighing step needs a second-person check'],
    ['charge-in', (d) => { step(d, 'granulation', 'charge-api').checker = false; }, 'error TB-08 stages[1].steps[2]: A charge-in step needs a second-person check'],
    ['yield', (d) => { step(d, 'compression', 'yield').checker = false; }, 'error TB-08 stages[2].steps[1]: A yield step needs a second-person check'],
    ['critical', (d) => { step(d, 'granulation', 'granulate').critical = true; }, 'error TB-08 stages[1].steps[3]: A critical step needs a second-person check'],
  ])('TB-08 a %s step without a second-person check is an error', (_what, change, want) => {
    expect(after(change)).toEqual([want]);
  });

  it('TB-10 a stage worked in a room without a line clearance step is an error; line clearance not first is a warning', () => {
    expect(after((d) => { d.stages[2]!.roomTypes = ['Compression']; })).toEqual(['error TB-10 stages[2]: Stage Compression is worked in a room but has no line clearance step']);
    const clearance = { key: 'line-clearance', block: { id: 'line-clearance', version: 1 }, checker: true, waitForCheck: false, critical: false, settings: {}, flow: { kind: 'none' as const } };
    expect(after((d) => { d.stages[2]!.roomTypes = ['Compression']; d.stages[2]!.steps.unshift(clearance); })).toEqual([]);
    expect(after((d) => { d.stages[2]!.steps.push(clearance); })).toEqual(['warning - stages[2].steps[2]: Line clearance is not the first step of Compression']);
    expect(after((d) => { d.stages[2]!.steps.unshift({ ...clearance, checker: false }); }))
      .toEqual(['error TB-08 stages[2].steps[0]: A line clearance step needs a second-person check']);
  });

  it('TB-01 an intermediate without a hold time is an error', () => {
    expect(after((d) => { delete d.stages[1]!.produces!.holdHours; })).toEqual(['error TB-01 stages[1].produces: The intermediate dried granules has no hold time']);
  });

  it('a stage without a yield step is an error (a preparation needs none)', () => {
    expect(after((d) => { d.stages[2]!.steps.pop(); })).toEqual(['error - stages[2]: Stage Compression has no yield step']);
  });

  it('the formula must add up to the theoretical core weight (coating and solvents left out)', () => {
    expect(after((d) => { d.formula[4]!.mgPerTablet = '17.0'; })).toEqual(['error - formula: The core materials add up to 249.5 mg per tablet, not the theoretical core weight 250.0 mg']);
    expect(after((d) => { d.formula[3]!.mgPerTablet = '80.0'; d.formula[6]!.mgPerTablet = '9.0'; d.header.coatedWeightMg = '259.0'; })).toEqual([]);
  });

  it('TB-13 adjustment settings the templates library refuses are errors (same basis, overage, salt factor)', () => {
    expect(errors((d) => {
      d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true } }, potency: { basis: 'anhydrous' } };
    })).toEqual([expect.stringMatching(/^error TB-13 formula\[0\]\.adjust: Same-basis rule \(C5\): the standard quantity already uses the hydrate/)]);
    expect(after((d) => { d.formula[0]!.adjust = { potency: { basis: 'as is' } }; }))
      .toEqual(['error TB-13 formula[0].adjust: Say whether the standard quantity is the anhydrous weight or the hydrate/solvate weight (same-basis rule C5)']);
    expect(after((d) => { d.formula[0]!.adjust = { overage: { percent: '5.0', maxPercent: '3.0' } }; }))
      .toEqual(['error - formula[0].adjust: The overage 5.0 % is above the 3.0 % the master allows']);
    expect(errors((d) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'hemifumarate', mw: '0' } } }; }))
      .toEqual(['error - formula[0].adjust: Molecular weights must be more than zero']);
    expect(after((d) => { d.formula[1]!.adjust = { compensates: ['nothing'] }; })).toEqual(['error - formula[1].adjust.compensates: No other formula line nothing to compensate']);
  });

  it('a limit the library refuses is an error', () => {
    expect(after((d) => { step(d, 'granulation', 'granulate').settings.endPointLimit = { low: '12.0', high: '8.0', unit: 'kW' }; }))
      .toEqual(['error - stages[1].steps[3].settings.endPointLimit: The lower limit 12.0 is above the upper limit 8.0']);
  });

  it('TB-01 a limit or a typed target in a unit of another kind than the value it checks is an error (every reading would be refused)', () => {
    expect(errors((d) => { step(d, 'compression', 'compress').settings.meanLimit = { low: '245.0', high: '255.0', unit: 'min' }; }))
      .toEqual(['error TB-01 stages[2].steps[0].settings.meanLimit: Mean weight limits: min is a time, but the value checked is a mass. Choose a unit of that kind (in min every reading would be refused at batch time)']);
    expect(errors((d) => { step(d, 'coating', 'qa-hold').settings = { what: 'Weight', unit: 'mg', limit: { low: '95', high: '105', unit: '%' } }; }))
      .toEqual(['error TB-01 stages[3].steps[1].settings.limit: Limits: % is a percentage, but the value checked is a mass. Choose a unit of that kind (in % every reading would be refused at batch time)']);
    expect(errors((d) => { step(d, 'granulation', 'yield').settings.yieldLimit = { low: '97.0', high: '100.5', unit: 'kg' }; })).toHaveLength(1);
    expect(errors((d) => { step(d, 'granulation', 'weigh-lactose').settings.target = '12.0 min'; })).toEqual([expect.stringMatching(/^error TB-01 stages\[1\]\.steps\[1\]\.settings\.target: .*min is a time, but the value checked is a mass/)]);
    // A unit not in the list is refused as before; a unit of the same kind, or °C on a temperature difference, is not a kind problem.
    expect(errors((d) => { step(d, 'compression', 'compress').settings.meanLimit = { low: '245.0', high: '255.0', unit: 'F-min' }; })).toEqual([expect.stringMatching(/"F-min" is not in the unit list/)]);
    expect(errors((d) => { Object.assign(step(d, 'compression', 'compress').settings, { meanLimit: { low: '0.245', high: '0.255', unit: 'g' }, hardnessLimit: { low: '6', high: '12', unit: 'kp' } }); })).toEqual([]);
    expect(errors((d) => { step(d, 'granulation', 'weigh-lactose').settings.target = '12.0 kg'; })).toEqual([]);
  });

  it('a limit of the wrong unit kind is refused at batch time too: C1 and T7 refuse the reading, nothing is compared', () => {
    const d = tablet();
    step(d, 'compression', 'compress').settings.meanLimit = { low: '245.0', high: '255.0', unit: 'min' };
    const r = evaluate(d, [], { stage: 2, sub: 1, step: 0, round: 1 }, { weights: Array(20).fill({ value: '250.0', unit: 'mg' }) });
    expect(r.meanWeight).toEqual({ ok: false, message: 'mg (mass) cannot be converted to min (time)' });
  });

  it('TB-15 compression checks more than 30 minutes apart, or with no interval, are an error', () => {
    expect(after((d) => { step(d, 'compression', 'compress').everyMinutes = 45; }))
      .toEqual(['error TB-15 stages[2].steps[0].everyMinutes: Periodic checks every 45 min: they must be at least every 30 min']);
    expect(after((d) => { delete step(d, 'compression', 'compress').everyMinutes; }))
      .toEqual(['error TB-15 stages[2].steps[0].everyMinutes: Compress with periodic checks needs the interval of its periodic checks']);
    expect(after((d) => { step(d, 'compression', 'compress').everyMinutes = 30; })).toEqual([]);
  });

  it('a repeat-until step without the most rounds, or without a stop check, is an error', () => {
    expect(after((d) => { step(d, 'granulation', 'dry').flow = { kind: 'repeat-until' }; }))
      .toEqual(['error - stages[1].steps[4].flow: A repeat-until step needs the most rounds allowed']);
    expect(after((d) => { step(d, 'granulation', 'dry').flow = { kind: 'repeat-until', maxRounds: 3, stop: 'nothing' }; }))
      .toEqual(['error - stages[1].steps[4].flow: A repeat-until step needs a stop check (a calculation of its block)']);
  });

  it('a reference to a field that does not exist, comes later, or is inside another sub-batch stage is an error', () => {
    const coat = (ref: string) => after((d) => { step(d, 'coating', 'coat').settings.coreWeight = { ref }; });
    expect(coat('compression/compress/nothing')).toEqual(['error - stages[3].steps[0].settings.coreWeight: compression/compress/nothing: step compress has no field or calculation nothing']);
    expect(coat('coating/yield/yield')).toEqual(['error - stages[3].steps[0].settings.coreWeight: coating/yield/yield comes later than this step']);
    expect(coat('nowhere/x/y')).toEqual(['error - stages[3].steps[0].settings.coreWeight: nowhere/x/y: no such stage and step']);
    expect(after((d) => { step(d, 'compression', 'yield').settings.theoretical = { ref: 'coating/coat/gain' }; }))
      .toEqual(['error - stages[2].steps[1].settings.theoretical: coating/coat/gain comes later than this step']);
  });

  it('unknown blocks, missing settings and stages used before they exist are errors; an unused preparation is a warning', () => {
    expect(after((d) => { step(d, 'granulation', 'mill').block.version = 9; })).toEqual(['error - stages[1].steps[5].block: No block sieve version 9']);
    expect(after((d) => { delete step(d, 'granulation', 'dry').settings.lodLimit; })).toEqual(['error - stages[1].steps[4].settings.lodLimit: LOD limit is not set']);
    expect(after((d) => { d.stages[1]!.uses = ['coating']; })).toEqual(['warning - stages[0]: No stage uses the preparation Binder solution', 'error - stages[1].uses: coating is not an earlier stage']);
  });
});

// Calculation checks (owner decision of 15 November 2026): error-proofing of the calculations at master-building time.
// They are not GMP rules. Refusals are ⛔ errors; the warnings need an answer, kept in the master document.
describe('calculation checks', () => {
  type Change = (d: MasterDoc) => void;
  const salt = (to: { name: string; mw: string; moleculesPerUnit?: number; hydrateOrSolvate?: boolean }, extra: object = {}) =>
    (d: MasterDoc) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to }, ...extra }; };
  const only = (level: string, path: string) => (change: Change) => after(change).filter((p) => p.startsWith(`${level} `) && p.includes(` ${path}: `));

  it.each<[string, Change, Change, RegExp]>([
    ['water counted twice (hydrate MW and a water/LOD correction)',
      salt({ name: 'sodium sesquihydrate', mw: '432.4', hydrateOrSolvate: true }, { potency: { basis: 'anhydrous' } }),
      salt({ name: 'sodium', mw: '405.4' }, { potency: { basis: 'anhydrous' } }), /would count the water twice/],
    ['potency as parent with a salt factor',
      salt({ name: 'sodium', mw: '405.4' }, { potency: { basis: 'as is', potencyAs: 'parent' } }),
      (d) => { d.formula[0]!.adjust = { potency: { basis: 'as is', potencyAs: 'parent' } }; }, /factor is already inside it/],
    ['potency as element with a compound factor (calcium 40.08 to calcium carbonate 100.09: × 2.497)',
      (d) => { d.formula[0]!.adjust = { salt: { from: { name: 'calcium', mw: '40.08' }, to: { name: 'calcium carbonate', mw: '100.09' } }, potency: { basis: 'as is', potencyAs: 'element' } }; },
      (d) => { d.formula[0]!.adjust = { potency: { basis: 'as is', potencyAs: 'element' } }; }, /factor is already inside it/],
    ['molecules per salt unit ignored (a hemi-salt at 1 molecule per unit)',
      salt({ name: 'hemifumarate', mw: '883.1' }), salt({ name: 'hemifumarate', mw: '883.1', moleculesPerUnit: 2 }), /is a hemi-salt/],
    ['IU or CFU turned into a mass (a content per gram for a formula in mg)',
      (d) => { d.formula[0]!.adjust = { content: { formulaQuantityIs: 'dry', nominalContent: '5000 IU/g' } }; },
      (d) => { d.formula[0]!.adjust = { content: { formulaQuantityIs: 'dry', nominalContent: '98.0 %' } }; }, /must be in IU/],
  ])('calculation check ⛔ %s: shown on the formula line with a plain message', (_what, bad, fixed, message) => {
    const errors = only('error', 'formula[0].adjust');
    expect(errors(bad)).toEqual([expect.stringMatching(message)]);
    expect(errors(fixed)).toEqual([]);
  });

  it('calculation check ⛔ negative filler: a compensating filler that cannot take the overage even at an assay of 100 %', () => {
    const mccCompensates = (overage: string) => (d: MasterDoc) => { d.formula[0]!.adjust = { ...d.formula[0]!.adjust, overage: { percent: overage } }; d.formula[4]!.adjust = { compensates: ['api'] }; };
    // 100 000 tablets: 10.000 kg API × 1.20 = 12.000 kg; 2.000 kg more than the 1.750 kg of MCC
    expect(only('error', 'formula[4].adjust.compensates')(mccCompensates('20.0')))
      .toEqual([expect.stringMatching(/^error TB-13 formula\[4\]\.adjust\.compensates: At the nominal certificate values: Not enough Microcrystalline cellulose to compensate.*-0\.250 kg of Microcrystalline cellulose\. The batch weight cannot be kept$/)]);
    expect(only('error', 'formula[4].adjust.compensates')(mccCompensates('10.0'))).toEqual([]);
  });

  it('calculation check ⛔ weight variation on coated tablets other than film-coated: the block offers no other coating, and T14 refuses it', () => {
    const uniformity = (coating: string): Change => (d) => {
      d.stages[2]!.steps.splice(1, 0, { key: 'uniformity', block: { id: 'uniformity-by-weight', version: 1 }, checker: true, waitForCheck: false, critical: false,
        settings: { coating, labelClaim: '100 mg' }, flow: { kind: 'none' } });
    };
    expect(errors(uniformity('sugar-coated'))).toEqual(['error - stages[2].steps[1].settings.coating: Coating: choose one of uncoated, film-coated']);
    expect(errors(uniformity('film-coated'))).toEqual([]);
    const d = tablet();
    uniformity('sugar-coated')(d);
    const weights = Array.from({ length: 10 }, () => ({ value: '250.0', unit: 'mg' }));
    expect(evaluate(d, [], { stage: 2, sub: 1, step: 1, round: 1 }, { weights, assay: { value: '99.0', unit: '%' } }).acceptance)
      .toEqual({ ok: false, message: 'The weight-variation method is not allowed for sugar-coated tablets: only uncoated and film-coated tablets may use it. Test content uniformity on individual units' });
  });

  it('calculation check ⛔ a liquid make-up the templates refuse is shown on its step before any batch (T17)', () => {
    const solution = (targetSolids: string): Change => (d) => {
      d.stages[0]!.steps[1] = { key: 'stir', block: { id: 'binder-solution', version: 1 }, checker: true, waitForCheck: false, critical: false, flow: { kind: 'none' },
        settings: { binder: { formula: 'pvp' }, targetSolids, tolerance: '1.0', mixTimeLimit: { low: '10', high: '20', unit: 'min' } } };
    };
    expect(errors(solution('0 %'))).toEqual(['error - stages[0].steps[1]: Solvent to add: The target solids content must be more than 0 and not more than 100 %']);
    expect(errors(solution('10 %'))).toEqual([]);
  });

  const hcl: Change = (d) => { d.formula[0]!.name = 'Examplol hydrochloride'; };
  const herbal: Change = (d) => { d.formula[4]!.name = 'Withania root extract'; };
  const premix: Change = (d) => { step(d, 'granulation', 'charge-api').instruction = 'Premix with lactose 1:4, then charge.'; };
  const double: Change = (d) => { d.formula[4]!.adjust = { content: { formulaQuantityIs: 'dry', contentSource: 'in-process result' } }; };
  // 405.4 ÷ 383.4 = 1.0574: 1.10 is 4.0 % off, 1.060 is 0.2 % off
  const factor = (f: string): Change => (d) => { d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium', mw: '405.4' }, factor: f } }; };
  it.each<[string, Change, Change, string, string, string]>([
    ['(a) label basis per market', hcl, () => {}, 'label-basis/api', 'formula[0]', 'as Examplol hydrochloride'],
    ['(b) herbal or extract line', herbal, () => {}, 'herbal/mcc', 'formula[4]', 'extract weight'],
    ['(c) ratio in a step instruction with the API', premix, (d) => { step(d, 'granulation', 'mill').instruction = 'Mill 10 % of the granules first.'; }, 'ratio-basis/granulation/charge-api', 'stages[1].steps[2]', 'as weighed'],
    ['(d) potency adjusted at dispensing and again from a blend assay', double, (d) => { delete d.formula[0]!.adjust; double(d); }, 'double-adjustment/mcc', 'formula[4].adjust', 'intended'],
    ['(e) salt factor differing from the molecular weights by more than 0.5 %', factor('1.10'), factor('1.060'), 'salt-factor/api', 'formula[0].adjust.salt', 'confirmed'],
  ])('calculation check ⚠️ %s: fires, passes, and once answered no longer blocks', (_what, fires, passes, key, path, choice) => {
    const d = tablet();
    fires(d);
    const q = checks(d).find((p) => p.question?.key === key)!;
    expect(q).toMatchObject({ level: 'warning', path, question: { options: expect.arrayContaining([choice]) } });
    expect(blocking(q)).toBe(true);
    // passes: the warning is not there
    const ok = tablet();
    passes(ok);
    expect(checks(ok).some((p) => p.question?.key === key)).toBe(false);
    // answered (with a reason where one is needed): shown as answered, not blocking
    d.answers = { [key]: { about: q.message, choice, reason: q.question!.needsReason ? 'Per the development report' : '' } };
    const answered = checks(d).find((p) => p.question?.key === key)!;
    expect(answered.question!.answer).toMatchObject({ choice });
    expect(blocking(answered)).toBe(false);
  });

  it('calculation check ⚠️ an answer counts only while it fits: a choice from the list, a reason where needed, the warning as answered', () => {
    const d = tablet();
    double(d);
    const q = checks(d).find((p) => p.question?.key === 'double-adjustment/mcc')!;
    const answer = (a: object) => { d.answers = { 'double-adjustment/mcc': { about: q.message, choice: 'intended', reason: 'Validated', ...a } }; return checks(d).find((p) => p.question?.key === 'double-adjustment/mcc')!; };
    expect(blocking(answer({}))).toBe(false);
    expect(blocking(answer({ reason: ' ' }))).toBe(true);
    expect(blocking(answer({ choice: 'maybe' }))).toBe(true);
    expect(blocking(answer({ about: 'an older wording' }))).toBe(true);
  });
});

it('calculation check ⚠️ the messages say what to answer, in plain words', () => {
  const d = tablet();
  d.formula[0]!.adjust = { salt: { from: { name: 'base', mw: '383.4' }, to: { name: 'sodium', mw: '405.4' }, factor: '1.10' } };
  expect(checks(d).map((p) => `${p.path}: ${p.message}`)).toEqual([
    "formula[0]: Label claim for this master's market: is the strength of Examplol stated as base or as sodium? The formula gives 100.0 mg of base per tablet.",
    'formula[0].adjust.salt: The salt factor 1.10 written for Examplol differs by 4.0 % from the molecular weights of base and sodium (factor 1.0574), which the batch quantity uses. Confirm with a reason, or correct the factor or the molecular weights.',
  ]);
});
