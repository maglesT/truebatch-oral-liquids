import { describe, expect, it } from 'vitest';
import { stateWords } from '../server/pull.js';
import { clauses } from '../shared/engine/links.js';

describe('a Logbook status is shown in words, never its key', () => {
  it.each([
    ['clean', 'clean'], ['in_use', 'in use'], ['dirty_expired', 'dirty expired'], ['pm_overdue', 'PM overdue'],
    ['in_change_over', 'in change over'], ['out_of_service', 'out of service'],
  ])('%s → %s', (key, words) => expect(stateWords(key)).toBe(words));
});

describe('a sentence of another product inside one of ours ends with one full stop', () => {
  it('each part loses its own closing stop; the parts are joined by "; "', () => {
    expect(`EQ-BLS-01 is not fit for use (Logbook): ${clauses(['Dirty: clean and verify before the next use.'])}.`)
      .toBe('EQ-BLS-01 is not fit for use (Logbook): Dirty: clean and verify before the next use.');
    expect(clauses(['Dirty hold expired. ', 'Calibration overdue..', 'PM due;', ''])).toBe('Dirty hold expired; Calibration overdue; PM due');
    expect(clauses([])).toBe('');
  });
});
