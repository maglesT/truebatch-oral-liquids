import type { Block } from './format.js';

// Device assembly (a prefilled syringe into an autoinjector or a safety device, a canister into an inhaler): an
// engine block for any TrueBatch edition. One component from a released lot (MMS, or the lot label with a second
// person: the master picks its formula line), the assembly line, the units fed and the devices out. In-process
// function test: at least the master's number of devices tested (C2), none may fail (C1, fixed), each works and is
// complete (C4), the activation force when the master sets its limits (C1). AQL inspection of the good devices
// (C7, ISO 2859-1: critical, major and minor defects). Yield of devices (T3), accountability of the units fed (T4) and
// of the component issued (T4; one component per device). The component used (issued − returned, T1 "net") is
// published in material_use_v1 for MMS, as a weighing's net. A yield step: always checked (TB-08).
const AQL = ['0', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0'];
export const deviceAssembly: Block = {
  id: 'device-assembly', version: 1, name: 'Device assembly', gmp: 'yield', checker: true,
  instruction: 'Assemble the devices with the component lot shown. Test the devices for function and inspect the AQL sample. Count the units fed, the good and rejected devices, the samples and the components issued, rejected and returned.',
  fields: [
    { name: 'lot', label: 'Component lot', kind: 'lot' },
    { name: 'machine', label: 'Assembly line', kind: 'machine', types: ['assembl'] },
    { name: 'issued', label: 'Components issued', kind: 'number', unit: 'units' },
    { name: 'unitsIn', label: 'Filled units fed to the line', kind: 'number', unit: 'units' },
    { name: 'tested', label: 'Devices tested for function', kind: 'number', unit: 'units' },
    { name: 'failed', label: 'Devices that failed the function test', kind: 'number', unit: 'units' },
    { name: 'works', label: 'Each tested device activates, delivers and locks as it should', kind: 'yes-no' },
    { name: 'complete', label: 'Each tested device is complete: all parts, cap and label in place', kind: 'yes-no' },
    { name: 'force', label: 'Activation force (mean of the tested devices)', kind: 'number', unit: 'N', optional: true },
    { name: 'inspected', label: 'Devices inspected (AQL sample)', kind: 'number', unit: 'units' },
    { name: 'critical', label: 'Critical defects found', kind: 'number', unit: 'units' },
    { name: 'major', label: 'Major defects found', kind: 'number', unit: 'units' },
    { name: 'minor', label: 'Minor defects found', kind: 'number', unit: 'units' },
    { name: 'good', label: 'Good devices assembled', kind: 'number', unit: 'units' },
    { name: 'rejected', label: 'Devices rejected', kind: 'number', unit: 'units' },
    { name: 'samples', label: 'Devices taken as samples (QC and reserve)', kind: 'number', unit: 'units' },
    { name: 'componentRejects', label: 'Components rejected (damaged, not assembled)', kind: 'number', unit: 'units' },
    { name: 'returned', label: 'Components returned to stores', kind: 'number', unit: 'units' },
  ],
  settings: [
    { name: 'component', label: 'Component (formula line)', kind: 'material' },
    { name: 'theoretical', label: 'Theoretical number of devices', kind: 'quantity' },
    { name: 'functionSample', label: 'Devices to test for function (at least)', kind: 'number' },
    { name: 'forceLimit', label: 'Activation force limits', kind: 'limit', optional: true },
    { name: 'level', label: 'Inspection level', kind: 'text', options: ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'] },
    { name: 'criticalAql', label: 'AQL for a critical defect', kind: 'text', options: AQL },
    { name: 'majorAql', label: 'AQL for a major defect', kind: 'text', options: AQL },
    { name: 'minorAql', label: 'AQL for a minor defect', kind: 'text', options: AQL },
    { name: 'yieldLimit', label: 'Yield limits', kind: 'limit' },
    { name: 'accountabilityLimit', label: 'Accountability limits (units fed)', kind: 'limit' },
    { name: 'componentLimit', label: 'Accountability limits (component)', kind: 'limit', optional: true },
  ],
  calcs: [
    { name: 'functionCount', label: 'Devices tested for function', template: 'C2', args: { readings: '$tested', required: '$functionSample', mode: 'at least' } },
    { name: 'functionFailures', label: 'Function test defects', template: 'C1', args: { value: '$failed', limit: { high: '0', unit: 'units' } } },
    { name: 'functionCheck', label: 'Devices work and are complete', template: 'C4', args: { question: 'Tested devices work and are complete', answers: ['$works', '$complete'], expected: ['yes'] } },
    { name: 'forceCheck', label: 'Activation force', template: 'C1', args: { value: '$force', limit: '$forceLimit' } },
    { name: 'aql', label: 'AQL inspection', template: 'C7', args: { lotSize: '$good', level: '$level', classes: { critical: '$criticalAql', major: '$majorAql', minor: '$minorAql' },
      found: { critical: '$critical', major: '$major', minor: '$minor' } } },
    { name: 'yield', label: 'Yield', template: 'T3', args: { actual: '$good', theoretical: '$theoretical', limit: '$yieldLimit' } },
    { name: 'accountability', label: 'Accountability of the units fed', template: 'T4', args: { input: '$unitsIn',
      parts: [{ name: 'good devices', value: '$good' }, { name: 'rejected', value: '$rejected' }, { name: 'samples', value: '$samples' }, { name: 'function tested', value: '$tested' }],
      limit: '$accountabilityLimit' } },
    { name: 'net', label: 'Components used', template: 'T1', args: { a: '$issued', b: '$returned', names: ['issued', 'returned'] } },
    { name: 'componentAccountability', label: 'Accountability of the component', template: 'T4', args: { input: '$issued',
      parts: [{ name: 'good devices', value: '$good' }, { name: 'rejected', value: '$rejected' }, { name: 'samples', value: '$samples' }, { name: 'function tested', value: '$tested' },
        { name: 'components rejected', value: '$componentRejects' }, { name: 'returned', value: '$returned' }], limit: '$componentLimit?' } },
  ],
};
