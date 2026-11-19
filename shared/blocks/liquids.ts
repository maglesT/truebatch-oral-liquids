import type { Block } from './format.js';

// TrueBatch Liquids library (library.md section 5): the blocks taken from the TrueBatch Injectables library (data,
// sterile words removed) and the new ones of the plan. Each block is data; the engine runs it. Where a library
// "setting" changes which fields are needed, the block has a variant of its own (dissolve / sugar-syrup / hydrate,
// make-up / make-up-volume, bulk-yield / bulk-yield-weight, liquid-fill / liquid-fill-unit, powder-fill /
// powder-fill-sachet), never a conditional field. Fill checks take a fixed 10 containers per round (owner, 18 Nov 2026).

const yes = (name: string, label: string, optional = false) => ({ name, label, kind: 'yes-no' as const, ...(optional ? { optional: true } : {}) });
const time = (name: string, label: string) => ({ name, label, kind: 'timer' as const });
const num = (name: string, label: string, unit: string, optional = false) => ({ name, label, kind: 'number' as const, unit, ...(optional ? { optional: true } : {}) });
const text = (name: string, label: string, optional = false) => ({ name, label, kind: 'text' as const, ...(optional ? { optional: true } : {}) });
const limit = (name: string, label: string, optional = true) => ({ name, label, kind: 'limit' as const, ...(optional ? { optional: true } : {}) });
const within = (name: string, label: string, value: string, lim: string) => ({ name, label, template: 'C1', args: { value: `$${value}`, limit: `$${lim}` } });
const observe = (name: string, label: string, answers: string[]) => ({ name, label, template: 'C4', args: { question: label, answers: answers.map((a) => `$${a}`), expected: ['yes'] } });
const duration = (name: string, label: string, start: string, end: string, lim: string) => ({ name, label, template: 'T13', args: { mode: 'duration', start: `$${start}`, end: `$${end}`, ...(lim ? { limit: `$${lim}` } : {}) } });
const going = (name: string, label: string) => ({ name, label, kind: 'choice' as const, options: ['going on', 'finished'] });
const finished = (field: string, what: string) => ({ name: 'done', label: `${what} finished`, template: 'C4', args: { question: what, answers: [`$${field}`], expected: ['finished'], options: ['going on', 'finished'] } });
// A vessel, tank, mixer or stirrer; never a granulator ("Rapid mixer granulator") or a dry mill.
const vessel = { name: 'machine', label: 'Vessel', kind: 'machine' as const, types: ['vessel', 'tank', 'mixer', 'stirrer'], notTypes: ['granulat'] };
const FILLS = 10;

// ---------------------------------------------------------------- Manufacturing (library 5.2, 5.3)

// Purified water from its point of use (TL-13: its point of use and time are its identity; its quality is the plant's
// water programme). Inj. "vehicle".
export const water: Block = {
  id: 'water', version: 1, name: 'Collect purified water', checker: true,
  instruction: 'Collect purified water from the point of use shown into the vessel; record the time, its temperature and the quantity.',
  fields: [text('point', 'Point of use'), time('collected', 'Collected at'), num('temperature', 'Temperature', '°C'), num('quantity', 'Quantity collected', 'kg')],
  settings: [{ name: 'water', label: 'Water', kind: 'text', options: ['ambient', 'hot', 'cooled'] }, limit('temperatureLimit', 'Temperature limits'), limit('quantityLimit', 'Quantity limits')],
  calcs: [within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), within('quantityCheck', 'Quantity', 'quantity', 'quantityLimit?')],
};

// Mix until dissolved (a minimum time by the master step's minMinutes): speed, temperature, time, "clear".
export const dissolve: Block = {
  id: 'dissolve', version: 1, name: 'Mix until dissolved', checker: false,
  instruction: 'Add the material, mix at the speed shown until it has dissolved, and look at the solution.',
  fields: [vessel, num('speed', 'Speed', 'rpm', true), num('temperature', 'Temperature', '°C', true), time('start', 'Start'), time('end', 'End'), yes('clear', 'Solution clear, everything dissolved')],
  settings: [limit('speedLimit', 'Speed limits'), limit('temperatureLimit', 'Temperature limits'), limit('timeLimit', 'Mixing time limits')],
  calcs: [within('speedCheck', 'Speed', 'speed?', 'speedLimit?'), within('temperatureCheck', 'Temperature', 'temperature?', 'temperatureLimit?'),
    duration('mixTime', 'Mixing time', 'start', 'end', 'timeLimit?'), observe('clearCheck', 'Solution clear', ['clear'])],
};

// The sugar syrup: sugar dissolved hot, its density (or Brix) read against limits.
export const sugarSyrup: Block = {
  id: 'sugar-syrup', version: 1, name: 'Make the sugar syrup', checker: false,
  instruction: 'Dissolve the sugar in the hot water at the temperature shown, mix until clear, and read the density of the syrup.',
  fields: [vessel, num('temperature', 'Temperature', '°C'), time('start', 'Start'), time('end', 'End'), num('density', 'Syrup density', 'g/mL'), yes('clear', 'Syrup clear, all sugar dissolved')],
  settings: [limit('temperatureLimit', 'Temperature limits', false), limit('densityLimit', 'Syrup density limits', false), limit('timeLimit', 'Mixing time limits')],
  calcs: [within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit'), duration('mixTime', 'Mixing time', 'start', 'end', 'timeLimit?'),
    within('densityCheck', 'Syrup density', 'density', 'densityLimit'), observe('clearCheck', 'Syrup clear', ['clear'])],
};

// Hydrate a suspending agent (xanthan, MCC-CMC, HPMC): dispersed without lumps, left to hydrate the minimum time
// (the master step's minMinutes).
export const hydrate: Block = {
  id: 'hydrate', version: 1, name: 'Hydrate the suspending agent', checker: false,
  instruction: 'Disperse the suspending agent into the vortex at the speed shown, mix for the time shown and leave it to hydrate; look for lumps.',
  fields: [vessel, num('speed', 'Speed', 'rpm', true), time('start', 'Start'), time('end', 'End'), yes('lumpFree', 'Fully hydrated, no lumps')],
  settings: [limit('speedLimit', 'Speed limits'), limit('timeLimit', 'Hydration time limits')],
  calcs: [within('speedCheck', 'Speed', 'speed?', 'speedLimit?'), duration('hydrationTime', 'Hydration time', 'start', 'end', 'timeLimit?'), observe('lumpCheck', 'No lumps', ['lumpFree'])],
};

// Adjust the pH round by round until it is inside its window; the total added is checked against its maximum (a
// value the master may set from the stoichiometry).
export const phAdjust: Block = {
  id: 'ph-adjust', version: 1, name: 'Adjust the pH', checker: false, stop: 'phCheck',
  instruction: 'Measure the pH; if it is outside the window, add the adjusting solution, mix and measure again.',
  fields: [
    num('ph', 'pH', 'pH'), num('temperature', 'Temperature', '°C'),
    { name: 'solution', label: 'Adjusting solution', kind: 'choice', options: ['none', 'sodium hydroxide', 'hydrochloric acid', 'citric acid', 'sodium citrate', 'other (named in the master)'] },
    num('added', 'Volume added this round', 'mL'),
  ],
  settings: [limit('phLimit', 'pH window', false), limit('totalLimit', 'Most adjusting solution in total')],
  calcs: [within('phCheck', 'pH', 'ph', 'phLimit'), { name: 'total', label: 'Adjusting solution added so far', template: 'T2', args: { values: ['$prev.total?', '$added'], limit: '$totalLimit?' } }],
};

// Make up to the final volume by weight: the target batch weight from the volume and density (I18), the net weight
// against it, the mixing time after.
export const makeUp: Block = {
  id: 'make-up', version: 1, name: 'Make up to final weight', checker: true,
  instruction: 'Add the vehicle to the final weight shown, mix for the time shown and record the gross weight.',
  fields: [{ name: 'machine', label: 'Vessel', kind: 'machine', types: ['vessel', 'tank'] }, num('gross', 'Vessel gross weight', 'kg'), num('tare', 'Vessel tare weight', 'kg'),
    num('temperature', 'Temperature', '°C'), time('mixStart', 'Mixing start'), time('mixEnd', 'Mixing end')],
  settings: [
    { name: 'volume', label: 'Final batch volume', kind: 'quantity' }, { name: 'density', label: 'Density at the make-up temperature', kind: 'quantity' },
    { name: 'tolerance', label: 'Tolerance on the batch weight (± %)', kind: 'number' }, limit('temperatureLimit', 'Temperature limits'), limit('mixTimeLimit', 'Mixing time limits'),
  ],
  calcs: [
    { name: 'target', label: 'Target batch weight', template: 'I18', args: { mode: 'convert', quantity: '$volume', density: '$density', unit: 'kg', decimals: 3 } },
    { name: 'net', label: 'Batch weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'netCheck', label: 'Batch weight against the target', template: 'C1', args: { value: '$net', around: { centre: '$target', name: 'target batch weight', plusMinusPercent: '$tolerance' } } },
    within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), duration('mixTime', 'Mixing time', 'mixStart', 'mixEnd', 'mixTimeLimit?'),
  ],
};

// Make up to the final volume by the level of a calibrated tank.
export const makeUpVolume: Block = {
  id: 'make-up-volume', version: 1, name: 'Make up to final volume', checker: true,
  instruction: 'Add the vehicle to the level of the final volume on the calibrated tank, mix for the time shown and read the volume.',
  fields: [{ name: 'machine', label: 'Calibrated tank', kind: 'machine', types: ['vessel', 'tank'] }, num('reading', 'Final volume read', 'L'),
    num('temperature', 'Temperature', '°C'), time('mixStart', 'Mixing start'), time('mixEnd', 'Mixing end')],
  settings: [{ name: 'volume', label: 'Final batch volume', kind: 'quantity' }, { name: 'tolerance', label: 'Tolerance on the volume (± %)', kind: 'number' },
    limit('temperatureLimit', 'Temperature limits'), limit('mixTimeLimit', 'Mixing time limits')],
  calcs: [
    { name: 'volumeCheck', label: 'Volume against the final batch volume', template: 'C1', args: { value: '$reading', around: { centre: '$volume', name: 'final batch volume', plusMinusPercent: '$tolerance' } } },
    within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), duration('mixTime', 'Mixing time', 'mixStart', 'mixEnd', 'mixTimeLimit?'),
  ],
};

// Clarifying filtration or sieving of the syrup (Inj. filtration-clarifying): filter or mesh, its screen seen intact
// after use, time and pressure.
export const filtration: Block = {
  id: 'filtration', version: 1, name: 'Filter or sieve the liquid', checker: false,
  instruction: 'Filter the liquid through the filter or screen shown; after use look at the screen.',
  fields: [text('filter', 'Filter or screen ID'), time('start', 'Start'), time('end', 'End'), num('pressure', 'Highest pressure', 'bar', true), yes('intact', 'Filter or screen intact after use')],
  settings: [{ name: 'filterType', label: 'Filter', kind: 'text', options: ['filter cartridge', 'filter bag', 'screen'] }, { name: 'size', label: 'Pore size or mesh', kind: 'text' },
    limit('pressureLimit', 'Pressure limit'), limit('timeLimit', 'Filtration time limits')],
  calcs: [duration('time', 'Filtration time', 'start', 'end', 'timeLimit?'), within('pressureCheck', 'Pressure', 'pressure?', 'pressureLimit?'), observe('intactCheck', 'Filter or screen intact', ['intact'])],
};

// An oil or water phase at its temperature (emulsions), as a preparation beside the stage.
export const phasePrep: Block = {
  id: 'phase-prep', version: 1, name: 'Prepare a phase', checker: false,
  instruction: 'Heat the phase to the temperature shown and mix until the materials have dissolved or melted.',
  fields: [vessel, num('temperature', 'Temperature', '°C'), time('start', 'Start'), time('end', 'End'), yes('dissolved', 'Dissolved or melted')],
  settings: [{ name: 'phase', label: 'Phase', kind: 'text', options: ['oil phase', 'water phase'] }, limit('temperatureLimit', 'Temperature limits')],
  calcs: [within('temperatureCheck', 'Temperature', 'temperature', 'temperatureLimit?'), duration('time', 'Time', 'start', 'end', ''), observe('dissolvedCheck', 'Dissolved or melted', ['dissolved'])],
};

// Colloid mill, homogeniser or high-shear mixer: one pass (or period) per round, until the size check passes or the
// passes run out (master: repeat until). Two-stage homogenisers give both valve pressures.
export const homogenise: Block = {
  id: 'homogenise', version: 1, name: 'Homogenise or mill', checker: false,
  instruction: 'Run one pass (or period) at the settings shown and record the pressure or speed, the temperature and the time.',
  fields: [{ name: 'machine', label: 'Homogeniser, colloid mill or mixer', kind: 'machine', types: ['homogen', 'colloid mill', 'shear', 'mixer'], notTypes: ['granulat'] },
    num('pressure', 'Pressure (first stage)', 'bar', true), num('pressure2', 'Pressure (second stage)', 'bar', true), num('speed', 'Speed', 'rpm', true),
    num('temperature', 'Temperature', '°C', true), time('start', 'Start'), time('end', 'End')],
  settings: [limit('pressureLimit', 'Pressure limits (first stage)'), limit('pressure2Limit', 'Pressure limits (second stage)'), limit('speedLimit', 'Speed limits'), limit('temperatureLimit', 'Temperature limits')],
  calcs: [within('pressureCheck', 'Pressure (first stage)', 'pressure?', 'pressureLimit?'), within('pressure2Check', 'Pressure (second stage)', 'pressure2?', 'pressure2Limit?'),
    within('speedCheck', 'Speed', 'speed?', 'speedLimit?'), within('temperatureCheck', 'Temperature', 'temperature?', 'temperatureLimit?'), duration('time', 'Time of this run', 'start', 'end', '')],
};

// Particle or droplet size; the stop check of homogenise.
export const sizeCheck: Block = {
  id: 'size-check', version: 1, name: 'Particle or droplet size', checker: false, stop: 'sizeOk',
  instruction: 'Measure the particle or droplet size as the master says (d50 and d90, or by microscope); look for settling.',
  fields: [num('size', 'd50 or mean size', 'µm'), num('d90', 'd90', 'µm', true), yes('redisperses', 'No caking or separation; redisperses on shaking')],
  settings: [limit('sizeLimit', 'Size limits', false), limit('d90Limit', 'd90 limit')],
  calcs: [within('sizeOk', 'Size', 'size', 'sizeLimit'), within('d90Check', 'd90', 'd90?', 'd90Limit?'), observe('redisperseCheck', 'Redisperses', ['redisperses'])],
};

// The bulk sample to QC, held for its results (a QA hold): pH, density, viscosity, assay, alcohol and preservative
// content where the master asks (in-process QC results, round 42: the step opens a LIMS lab request when it starts and
// each figure is picked from the approved in-process report of that request while LIMS answers), appearance; a bioburden sample's reference (results through the QC sign, TL-21).
export const bulkTest: Block = {
  id: 'bulk-test', version: 1, name: 'Bulk test (hold)', checker: true, qaHold: true,
  instruction: 'Take the bulk sample, send it to QC and record the results when they come. Wait for QA to release the hold.',
  fields: [
    text('reference', 'Sample reference'),
    ...[num('ph', 'pH', 'pH', true), num('density', 'Density', 'g/mL', true), num('viscosity', 'Viscosity', 'mPa·s', true), num('assay', 'Assay (% of target)', '%', true),
      num('ethanol', 'Alcohol content', '%v/v', true), num('preservative', 'Preservative content (% of target)', '%', true)].map((f) => ({ ...f, qc: 'in_process' as const })),
    text('bioburden', 'Bioburden sample reference', true),
    yes('appearance', 'Appearance as specified'),
  ],
  settings: [limit('phLimit', 'pH limits'), limit('densityLimit', 'Density limits'), limit('viscosityLimit', 'Viscosity limits'), limit('assayLimit', 'Assay limits'),
    limit('ethanolLimit', 'Alcohol content limits'), limit('preservativeLimit', 'Preservative content limits')],
  calcs: [
    within('phCheck', 'pH', 'ph?', 'phLimit?'), within('densityCheck', 'Density', 'density?', 'densityLimit?'), within('viscosityCheck', 'Viscosity', 'viscosity?', 'viscosityLimit?'),
    within('assayCheck', 'Assay', 'assay?', 'assayLimit?'), within('ethanolCheck', 'Alcohol content', 'ethanol?', 'ethanolLimit?'),
    within('preservativeCheck', 'Preservative content', 'preservative?', 'preservativeLimit?'), observe('appearanceCheck', 'Appearance', ['appearance']),
  ],
};

// Correct the bulk concentration (T26): the vehicle or a concentrated donor to add, worked out from the measured value.
export const bulkAdjust: Block = {
  id: 'bulk-adjust', version: 1, name: 'Correct the bulk concentration', checker: true,
  instruction: 'From the measured concentration, add the quantity worked out, mix and record it.',
  fields: [num('measured', 'Measured concentration', 'mg/mL'), num('bulk', 'Bulk quantity in the vessel', 'kg'), num('added', 'Quantity added', 'kg')],
  settings: [
    { name: 'target', label: 'Target concentration', kind: 'quantity' }, { name: 'donor', label: 'Concentration of what is added (0 for the vehicle)', kind: 'quantity' },
    { name: 'direction', label: 'Direction', kind: 'text', options: ['dilute with the vehicle', 'raise with a concentrated donor'] },
    limit('largestLimit', 'Largest correction allowed'), { name: 'tolerance', label: 'Tolerance on the quantity added (± %)', kind: 'number' },
  ],
  calcs: [
    { name: 'toAdd', label: 'Quantity to add', template: 'T26', args: { mass: '$bulk', a: '$measured', b: '$donor', target: '$target', property: 'concentration', limit: '$largestLimit?' } },
    { name: 'addedCheck', label: 'Added against the quantity worked out', template: 'C1', args: { value: '$added', around: { centre: '$toAdd', name: 'quantity to add', plusMinusPercent: '$tolerance' } } },
  ],
};

// The bulk to the holding tank (TL-10 connection check, TL-17 hold from here): from and to tank picked, the line or
// hose connected to this tank, the quantity in the tank, the stirrer on for a suspension or emulsion.
export const bulkTransfer: Block = {
  id: 'bulk-transfer', version: 1, name: 'Transfer the bulk to the holding tank', checker: true,
  instruction: 'Connect the transfer line or hose to the holding tank shown, check the connection, transfer the bulk and read the quantity in the tank.',
  fields: [
    { name: 'from', label: 'From vessel', kind: 'machine', types: ['vessel', 'tank'] }, // The holding tank is a tank (a holding or storage tank), never a manufacturing vessel: the master check then warns
    // when no tank stands in a room the stage allows (found in the Phase E run).
    { name: 'to', label: 'Holding tank', kind: 'machine', types: ['tank'] },
    yes('connected', 'Line or hose connected to this holding tank'), time('start', 'Start'), time('end', 'End'),
    num('quantity', 'Quantity in the holding tank', '$unit'), yes('stirring', 'Stirrer on', true),
  ],
  settings: [{ name: 'unit', label: 'Read in', kind: 'text', options: ['L', 'kg'] }, limit('quantityLimit', 'Quantity limits')],
  calcs: [observe('connectedCheck', 'Connected to the right tank, stirrer on where asked', ['connected', 'stirring?']), within('quantityCheck', 'Quantity in the tank', 'quantity', 'quantityLimit?'),
    duration('time', 'Transfer time', 'start', 'end', '')],
};

// The bulk yield (TL-18), as stage-yield: the bulk read in the tank (dip or level, in L; or kg), the samples and the
// residue, against the theoretical batch (T3, T4).
export const bulkYield: Block = {
  id: 'bulk-yield', version: 1, name: 'Bulk yield', gmp: 'yield', checker: true,
  instruction: 'Read the bulk in the holding tank (level or dip), and record the samples taken and the residue left in the vessels.',
  fields: [num('output', 'Bulk in the tank', '$unit'), num('samples', 'Samples', '$unit'), num('rejects', 'Residue and losses', '$unit')],
  settings: [{ name: 'unit', label: 'Read in', kind: 'text', options: ['L', 'kg'] }, { name: 'theoretical', label: 'Theoretical quantity', kind: 'quantity' },
    limit('yieldLimit', 'Yield limits', false), limit('accountabilityLimit', 'Accountability limits')],
  calcs: [
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$output', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$theoretical', parts: [{ name: 'output', value: '$output' }, { name: 'samples', value: '$samples' }, { name: 'rejects', value: '$rejects' }], limit: '$accountabilityLimit?' } },
  ],
};

// The bulk yield by weight: the net weight in the tank turned into litres by the density (I18).
export const bulkYieldWeight: Block = {
  id: 'bulk-yield-weight', version: 1, name: 'Bulk yield by weight', gmp: 'yield', checker: true,
  instruction: 'Weigh the holding tank (gross and tare); record the samples taken and the residue left in the vessels.',
  fields: [num('gross', 'Tank gross weight', 'kg'), num('tare', 'Tank tare weight', 'kg'), num('samples', 'Samples', 'L'), num('rejects', 'Residue and losses', 'L')],
  settings: [{ name: 'density', label: 'Density of the bulk', kind: 'quantity' }, { name: 'theoretical', label: 'Theoretical quantity', kind: 'quantity' },
    limit('yieldLimit', 'Yield limits', false), limit('accountabilityLimit', 'Accountability limits')],
  calcs: [
    { name: 'net', label: 'Net weight', template: 'T1', args: { a: '$gross', b: '$tare' } },
    { name: 'output', label: 'Bulk in the tank', template: 'I18', args: { mode: 'convert', quantity: '$net', density: '$density', unit: 'L', decimals: 1 } },
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$output', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability', template: 'T4', args: { input: '$theoretical', parts: [{ name: 'output', value: '$output' }, { name: 'samples', value: '$samples' }, { name: 'rejects', value: '$rejects' }], limit: '$accountabilityLimit?' } },
  ],
};

// Room readings alongside a stage (filling room not above 30 °C for India, SCHM-IX 4.4; humidity for a dry syrup).
export const roomStatus: Block = {
  id: 'room-status', version: 1, name: 'Room conditions', checker: false, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round read the room temperature, and the humidity and pressure where the master asks.',
  fields: [num('temperature', 'Room temperature', '°C'), num('humidity', 'Relative humidity', '%RH', true), num('pressure', 'Differential pressure', 'Pa', true), going('running', 'Work in the room')],
  settings: [limit('temperatureLimit', 'Room temperature limits', false), limit('humidityLimit', 'Humidity limits'), limit('pressureLimit', 'Differential pressure limits')],
  calcs: [within('temperatureCheck', 'Room temperature', 'temperature', 'temperatureLimit'), within('humidityCheck', 'Humidity', 'humidity?', 'humidityLimit?'),
    within('pressureCheck', 'Differential pressure', 'pressure?', 'pressureLimit?'), finished('running', 'Work in the room')],
};

// ---------------------------------------------------------------- Filling (TrueBatch Liquids Packing, library 5.4)

// Wash or air-rinse bottles, caps or droppers before filling (TL-P4; Inj. component-wash).
export const bottleWash: Block = {
  id: 'bottle-wash', version: 1, name: 'Wash or air-rinse the containers', checker: false, packing: true,
  instruction: 'Wash or air-rinse the containers shown in the machine, inverted; count them and look at them.',
  fields: [{ name: 'washer', label: 'Washer or air rinser', kind: 'machine', types: ['washing machine', 'washer', 'rinser', 'air jet'] },
    { name: 'method', label: 'Method', kind: 'choice', options: ['water wash', 'air rinse'] }, num('count', 'Containers washed or rinsed', 'units'), yes('visual', 'Clean, no particles, not damaged')],
  settings: [{ name: 'what', label: 'What is washed', kind: 'text', options: ['bottles', 'caps', 'droppers', 'cups'] }],
  calcs: [observe('visualCheck', 'Containers clean', ['visual'])],
};

// Fill a liquid into bottles (TL-P10): rounds at the start, at the master's interval, after a stoppage and at the end;
// 10 bottles per round by weight (net, g) or by volume (mL), mean and each against limits; stirring on for a
// suspension or emulsion; the counter.
const fillRound = { name: 'round', label: 'Round', kind: 'choice' as const, options: ['start', 'interval', 'after a stoppage', 'end'] };
const fillCalcs = [
  { name: 'mean', label: 'Mean fill', template: 'T7', args: { readings: '$fills', limit: '$meanLimit' } },
  { name: 'each', label: 'Each fill', template: 'C3', args: { readings: '$fills', band: { limit: '$eachLimit' } } },
  // TL-17: the bulk hold runs from the end of manufacturing to the end of filling (CHECK-L3); a round after it is out of
  // limits and needs a deviation note.
  { name: 'holdCheck', label: 'Time since the bulk was ready', template: 'T13', args: { mode: 'duration', start: '$batch.readyAt', end: '$checkedAt', unit: 'h', limit: { high: '$batch.holdHours', unit: 'h' } } },
];
const checkedAt = time('checkedAt', 'Round checked at');
export const liquidFill: Block = {
  id: 'liquid-fill', version: 1, name: 'Fill bottles with periodic fill checks', checker: false, packing: true, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round take 10 filled bottles and record each fill (net weight or volume as shown) and read the counter.',
  fields: [{ name: 'machine', label: 'Filling machine', kind: 'machine', types: ['fill'] }, fillRound, checkedAt,
    { name: 'fills', label: `Fill of ${FILLS} bottles`, kind: 'number', unit: '$fillUnit', count: FILLS },
    num('counter', 'Counter', 'units'), going('filling', 'Filling')],
  settings: [{ name: 'fillUnit', label: 'Fill checked in', kind: 'text', options: ['g', 'mL'] }, limit('meanLimit', 'Mean fill limits', false), limit('eachLimit', 'Each fill limits', false)],
  calcs: [...fillCalcs, finished('filling', 'Filling')],
};

// A suspension or emulsion: as liquid-fill, the bulk stirred continuously during filling, confirmed every round
// (TL-P10; A9 8, SCHM-IX 4.3).
export const liquidFillStirred: Block = {
  ...liquidFill, id: 'liquid-fill-stirred', name: 'Fill bottles with the bulk stirred, with periodic fill checks',
  instruction: 'Keep the bulk stirred. At each round take 10 filled bottles and record each fill (net weight or volume as shown), confirm the stirrer is on and read the counter.',
  fields: [...liquidFill.fields.slice(0, -2), yes('stirring', 'Bulk stirred during filling'), ...liquidFill.fields.slice(-2)],
  calcs: [...fillCalcs, observe('stirringCheck', 'Bulk stirred', ['stirring']), finished('filling', 'Filling')],
};

// Fill a liquid into single-dose units (sachet, unit-dose cup or glass ampoule): as liquid-fill, each unit sealed.
export const liquidFillUnit: Block = {
  id: 'liquid-fill-unit', version: 1, name: 'Fill single-dose units with periodic fill checks', checker: false, packing: true, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round take 10 filled units and record each net fill; check that they are sealed and read the counter.',
  fields: [{ name: 'machine', label: 'Filling machine', kind: 'machine', types: ['fill', 'sachet', 'cup', 'ampoule'] }, fillRound, checkedAt,
    { name: 'fills', label: `Net fill of ${FILLS} units`, kind: 'number', unit: '$fillUnit', count: FILLS },
    yes('sealed', 'Units sealed'), yes('stirring', 'Bulk stirred during filling', true), num('counter', 'Counter', 'units'), going('filling', 'Filling')],
  settings: [{ name: 'container', label: 'Unit', kind: 'text', options: ['sachet', 'unit-dose cup', 'glass ampoule'] }, { name: 'fillUnit', label: 'Fill checked in', kind: 'text', options: ['g', 'mL'] },
    limit('meanLimit', 'Mean fill limits', false), limit('eachLimit', 'Each fill limits', false)],
  calcs: [...fillCalcs, observe('sealedCheck', 'Units sealed, bulk stirred where asked', ['sealed', 'stirring?']), finished('filling', 'Filling')],
};

// Fill a dry syrup powder into bottles by weight: 10 bottles per round, the room's humidity, caps on.
const powderFields = [{ name: 'machine', label: 'Powder filling machine', kind: 'machine' as const, types: ['powder fill', 'auger', 'fill'] }, fillRound, checkedAt,
  { name: 'fills', label: `Net fill weight of ${FILLS} containers`, kind: 'number' as const, unit: 'g', count: FILLS }, num('humidity', 'Room relative humidity', '%RH')];
const powderSettings = [limit('meanLimit', 'Mean fill weight limits', false), limit('eachLimit', 'Each fill weight limits', false), limit('humidityLimit', 'Room humidity limit', false)];
export const powderFill: Block = {
  id: 'powder-fill', version: 1, name: 'Fill powder into bottles with periodic fill checks', checker: false, packing: true, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round weigh the net powder of 10 filled bottles, read the room humidity, check the caps and read the counter.',
  fields: [...powderFields, yes('capped', 'Caps on'), num('counter', 'Counter', 'units'), going('filling', 'Filling')],
  settings: powderSettings,
  calcs: [...fillCalcs, within('humidityCheck', 'Room humidity', 'humidity', 'humidityLimit'), observe('cappedCheck', 'Caps on', ['capped']), finished('filling', 'Filling')],
};
export const powderFillSachet: Block = {
  id: 'powder-fill-sachet', version: 1, name: 'Fill powder into sachets with periodic fill checks', checker: false, packing: true, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round weigh the net powder of 10 filled sachets, read the room humidity, check the seals and read the counter.',
  fields: [...powderFields, yes('sealed', 'Sachets sealed'), num('counter', 'Counter', 'units'), going('filling', 'Filling')],
  settings: powderSettings,
  calcs: [...fillCalcs, within('humidityCheck', 'Room humidity', 'humidity', 'humidityLimit'), observe('sealedCheck', 'Sachets sealed', ['sealed']), finished('filling', 'Filling')],
};

// Capping (Inj. seal-check version 2): the capping machine; per round the caps checked, defects, and where the master
// asks the removal torque, the induction seal and the child-resistant closure.
export const capCheck: Block = {
  id: 'cap-check', version: 1, name: 'Cap and check the closures', checker: false, packing: true, periodic: { maxMinutes: 1440, alongside: true }, stop: 'done',
  instruction: 'At each round check the closures of the bottles shown; record defects and, where the master asks, the removal torque, the induction seal and the child-resistant closure.',
  fields: [
    { name: 'capper', label: 'Capping machine', kind: 'machine', types: ['capping', 'capper'] },
    { name: 'closure', label: 'Closure', kind: 'choice', options: ['plain screw cap', 'child-resistant cap', 'dropper', 'child-resistant cap with syringe plug', 'aluminium tear-off seal'] },
    num('checked', 'Bottles checked', 'units'), num('defects', 'Defective closures', 'units'), yes('seated', 'Caps seated and tight'), num('torque', 'Removal torque', 'N·cm', true),
    yes('inductionSeal', 'Induction seal present', true), yes('crc', 'Child-resistant closure engages', true), going('capping', 'Capping'),
  ],
  settings: [limit('defectLimit', 'Defective closures allowed per round', false), limit('torqueLimit', 'Removal torque limits')],
  calcs: [within('defectCheck', 'Defective closures', 'defects', 'defectLimit'), within('torqueCheck', 'Removal torque', 'torque?', 'torqueLimit?'),
    observe('closureCheck', 'Closures as they should be', ['seated', 'inductionSeal?', 'crc?']), finished('capping', 'Capping')],
};
