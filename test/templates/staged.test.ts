import { describe, expect, it } from 'vitest';
import { c6StagedTest } from '../../shared/templates/staged.js';
import { ok, refused } from './helpers.js';

const six = (s: string): string[] => s.split(' ');

describe('C6 Staged test: disintegration (6, then 12 more; 16 of 18)', () => {
  it.each([
    [[six('8 9 10 11 12 14')], 'pass', 1],
    [[six('8 9 10 11 12 16')], 'next stage', 1],
    [[six('8 9 10 16 17 18')], 'fail', 1], // 3 of 6 failed
    [[six('8 9 10 11 12 16'), six('8 9 10 11 12 13 14 9 10 11 12 16')], 'pass', 2], // 2 failed of 18 → 16 pass
    [[six('8 9 10 11 16 16'), six('8 9 10 11 12 13 14 9 10 11 12 16')], 'fail', 2], // 3 failed → 15 of 18
    [[six('8 9 10 11 12 15.4')], 'pass', 1], // 15.4 rounds to 15 ≤ 15
    [[six('8 9 10 11 12 15.5')], 'next stage', 1], // 15.5 rounds to 16
    [[six('8 9 10 11 12 >15')], 'next stage', 1], // not disintegrated
  ])('C6: %o → %s at stage %s', (stages, decision, stage) => {
    const r = ok(c6StagedTest({ test: 'disintegration', maxTime: '15', stages }));
    expect(r.decision).toBe(decision);
    expect(r.stageReached).toBe(stage);
  });

  it('C6: readings recorded with their unit count as their values', () => {
    const min = (s: string) => six(s).map((value) => ({ value, unit: 'min' }));
    expect(ok(c6StagedTest({ test: 'disintegration', maxTime: '15', stages: [min('8 9 10 11 12 16'), min('8 9 10 11 12 13 14 9 10 11 12 13')] })).decision).toBe('pass');
  });

  it('C6: refuses the wrong number of units', () => {
    expect(refused(c6StagedTest({ test: 'disintegration', maxTime: '15', stages: [six('8 9 10 11 12')] }))).toMatch(/needs 6 units/);
  });
});

describe('C6 Staged test: dissolution, immediate release (S1-S3), Q = 80 %', () => {
  const s1ok = six('86 88 90 87 85 89'); // 85 = Q + 5 exactly passes
  const s1low = six('86 84 90 87 85 89');
  const s2 = six('80 78 82 79 81 83'); // mean of 12: (521 + 483) ÷ 12 = 83.67 ≥ 80, none < 65
  const s2bad = six('70 66 70 64 70 70'); // unit 64 < 65 → S3
  const s3 = '80 81 82 83 80 81 82 83 80 81 82 83'.split(' ');
  const s3low = Array(12).fill('78') as string[];
  it.each([
    [[s1ok], 'pass', 1],
    [[s1low], 'next stage', 1],
    [[s1low, s2], 'pass', 2],
    [[s1low, s2bad], 'next stage', 2], // mean (521 + 410) ÷ 12 = 77.6 < 80
    [[s1low, s2bad, s3], 'pass', 3], // 24: (521 + 410 + 978) ÷ 24 = 79.54 → 80 ≥ 80 (rounded to Q's decimals); one unit < 65
    [[s1low, s2bad, s3low], 'fail', 3], // (521 + 410 + 936) ÷ 24 = 77.79 → 78 < 80
  ])('C6: %#: %s at stage %s', (stages, decision, stage) => {
    const r = ok(c6StagedTest({ test: 'dissolution IR', Q: '80', stages }));
    expect(r.decision).toBe(decision);
    expect(r.stageReached).toBe(stage);
  });

  it('C6: S3 pass: mean ≥ Q, 2 units below Q − 15 allowed, none below Q − 25', () => {
    // S1 521 + S2 514 + S3 (11 × 85 + 60 = 995) = 2030 ÷ 24 = 84.6 ≥ 80
    const r = ok(c6StagedTest({ test: 'dissolution IR', Q: '80', stages: [six('86 84 90 87 85 89'), six('90 90 90 64 90 90'), Array(11).fill('85').concat(['60']) as string[]] }));
    expect(r.decision).toBe('pass'); // 64 and 60 below 65 (2 allowed), none below 55
  });

  it('C6: S3 fail: one unit below Q − 25', () => {
    const r = ok(c6StagedTest({ test: 'dissolution IR', Q: '80', stages: [six('86 84 90 87 85 89'), six('90 90 90 64 90 90'), Array(11).fill('85').concat(['54']) as string[]] }));
    expect(r.decision).toBe('fail');
  });
});

describe('C6 Staged test: delayed release (acid A1-A3, buffer B1-B3)', () => {
  it.each([
    [[six('2 3 1 4 2 3')], 'pass'],
    [[six('2 3 1 12 2 3')], 'next stage'],
    [[six('2 3 1 12 2 3'), six('2 3 1 4 2 3')], 'pass'], // mean 38 ÷ 12 = 3.2 ≤ 10, none > 25
    [[six('2 3 1 26 2 3'), six('2 3 1 4 2 3')], 'next stage'], // 26 > 25
    [[six('2 3 1 26 2 3'), six('2 3 1 4 2 3'), Array(12).fill('3') as string[]], 'fail'], // the 26 % unit stays in the 24
  ])('C6: acid stage %#: %s', (stages, decision) => {
    expect(ok(c6StagedTest({ test: 'dissolution DR acid', stages })).decision).toBe(decision);
  });

  it('C6: buffer stage uses the Q rule (pantoprazole, formulation 5): Q 75, all ≥ 80', () => {
    expect(ok(c6StagedTest({ test: 'dissolution DR buffer', Q: '75', stages: [six('82 85 80 88 84 81')] })).decision).toBe('pass');
  });
});

describe('C6 Staged test: extended release (L1-L3)', () => {
  const ranges = [{ time: '1 h', low: '20', high: '40' }, { time: '4 h', low: '45', high: '65' }, { time: '8 h', low: '80' }];
  const good = (n: number): string[][] => Array(n).fill(['30', '55', '90']) as string[][];
  it.each([
    [[good(6)], 'pass', 1],
    [[[['42', '55', '90'], ...good(5)]], 'next stage', 1], // 42 outside 20-40 by 2
    [[[['42', '55', '90'], ...good(5)], good(6)], 'pass', 2], // mean inside, none more than 10 outside
    [[[['52', '55', '90'], ...good(5)], good(6)], 'next stage', 2], // 52 is 12 outside
    [[[['52', '55', '90'], ...good(5)], good(6), good(12)], 'pass', 3], // 1 unit > 10 outside (2 allowed), none > 20
    [[[['62', '55', '90'], ...good(5)], good(6), good(12)], 'fail', 3], // 62 is 22 outside
    [[[['30', '55', '79'], ...good(5)]], 'next stage', 1], // below NLT 80 at 8 h
  ])('C6: %#: %s at stage %s', (stages, decision, stage) => {
    const r = ok(c6StagedTest({ test: 'dissolution ER', ranges, stages }));
    expect(r.decision).toBe(decision);
    expect(r.stageReached).toBe(stage);
  });

  it('C6: refuses a unit with the wrong number of time points', () => {
    expect(refused(c6StagedTest({ test: 'dissolution ER', ranges, stages: [[['30', '55'], ...good(5)]] }))).toMatch(/needs 3 results/);
  });
});

describe('C6 Staged test: content uniformity L1/L2 (via T14)', () => {
  const stage1 = [...Array(5).fill('105.95'), ...Array(5).fill('94.05')] as string[]; // AV 15.05 → 15.1
  it('C6: fails L1, asks for 20 more, passes L2 with all 30', () => {
    const r1 = ok(c6StagedTest({ test: 'content uniformity', coating: 'uncoated', stages: [stage1] }));
    expect(r1.decision).toBe('next stage');
    expect(r1.nextStageUnits).toBe(20);
    // 30 units: s = 5.95 × √(10/29) = 3.49399; AV = 2.0 × 3.494 = 6.99 → pass, all inside 75-125
    const r2 = ok(c6StagedTest({ test: 'content uniformity', coating: 'uncoated', stages: [stage1, Array(20).fill('100.0') as string[]] }));
    expect(r2.decision).toBe('pass');
    expect(r2.shown).toContain('AV = |100.00 − 100.00| + 2 × 3.494 = 7.0');
  });
});
