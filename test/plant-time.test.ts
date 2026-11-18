import { describe, expect, it } from 'vitest';
import { plantClock, plantDate, plantText } from '../shared/plant-time.js';
import { valueText } from '../server/batch-record.js';
import { plant } from '../server/pdf.js';
import { plantTime } from '../web/src/api.js';
import { plainClock } from '../web/src/api-floor.js';

// Times are shown in plant time (IST) everywhere, never as raw UTC or ISO text (owner, 15 Nov 2026).
describe('plant time', () => {
  it('a worked line with mixing times reads in plant time, to the minute (17 Nov 2026 run, F20)', () => {
    expect(plantText('2026-11-15T18:23:50Z − 2026-11-15T18:13:19Z = 11 min', true))
      .toBe('15 Nov 2026, 23:53 IST − 15 Nov 2026, 23:43 IST = 11 min');
  });

  it('a time read from the Logbook as PostgreSQL text (cleaned on) reads in plant time; a plain date reads as a date, never ISO', () => {
    expect(plantText('2026-11-15 17:38:16.254+00', true)).toBe('15 Nov 2026, 23:08 IST');
    expect(plantText('MMS lot E26-0001: released, expiry 2029-10-31, retest 2027-04-01')).toBe('MMS lot E26-0001: released, expiry 31 Oct 2029, retest 1 Apr 2027');
    expect(valueText('2026-11-15')).toBe('15 Nov 2026');
    // A lot or batch code that holds a date-like part is left as it is.
    expect(plantText('Lot A-2026-11-15, LOT2026-11-15X, expiry month 2028-10')).toBe('Lot A-2026-11-15, LOT2026-11-15X, expiry month 2028-10');
    expect(valueText('2026-11-15 17:38:16.254+00')).toBe('15 Nov 2026, 23:08 IST');
  });

  it('a date: 31 Oct 2029', () => {
    expect(['2029-10-31', '2026-01-05', 'not a date'].map(plantDate)).toEqual(['31 Oct 2029', '5 Jan 2026', 'not a date']);
  });

  it('one format on every screen: the year only when it is not this year (in plant time), never seconds (17 Nov 2026 run, F20)', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(plantClock('2026-11-15T18:30:05Z', false, now)).toBe('16 Nov, 00:00 IST');
    expect(plantClock('2025-12-31T18:29:00Z', false, now)).toBe('31 Dec 2025, 23:59 IST');
    // 31 Dec 2025 18:30 UTC is already 1 Jan 2026 at the plant: this year.
    expect(plantClock('2025-12-31T18:30:00Z', false, now)).toBe('1 Jan, 00:00 IST');
    // The printed record always has the year.
    expect(plantClock('2026-11-15T18:30:00Z', true, now)).toBe('16 Nov 2026, 00:00 IST');
    // A pulled value (the Logbook's "cleaned on"), the floor clock and the designer's times read alike.
    const t = new Date(Date.now() - 60_000).toISOString();
    expect(new Set([plantText(t.replace('T', ' ').replace('Z', '+00')), plainClock(t), plantTime(t), plantClock(t)]).size).toBe(1);
    expect(plainClock(t)).toMatch(/^\d{1,2} \w{3}, \d\d:\d\d IST$/);
  });

  it('September is "Sep" like every other month, on the screens and in the PDF (never "Sept")', () => {
    const t = '2027-09-30T06:00:00Z';
    expect([plantClock(t, true), plant(t), plantClock(t, false, new Date(t)), plantDate('2027-09-30')]).toEqual(['30 Sep 2027, 11:30 IST', '30 Sep 2027, 11:30 IST', '30 Sep, 11:30 IST', '30 Sep 2027']);
  });
});
