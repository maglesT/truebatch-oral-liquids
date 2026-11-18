// The calculations and checks of a block written as sentences, never as formulas. A sentence is a list of parts:
// plain words, a field the operator records, a calculation worked out earlier, or a setting the master fills (a slot).
import type { Block } from '../../../shared/blocks/index.js';
import { findBlock } from '../../../shared/blocks/index.js';
import { refsIn } from '../../../shared/blocks/format.js';
import { materialLines, type Limit, type MasterDoc, type SettingValue } from '../../../shared/master/schema.js';
import { stepTitle } from '../../../shared/engine/batch.js';
import { findUnit } from '../../../shared/templates/index.js';
import { HEADER_LABEL, unitLabel } from './model.js';

export type Part = string | { setting: string } | { field: string } | { calc: string } | { prev: string };
type Calc = Block['calcs'][number];

/** A label inside a sentence: each word lower-cased, except one with a capital after its first letter (pH, RSD, CFU). */
export const lower = (label: string) => label.split(' ').map((w) => (/^.+[A-Z]/u.test(w) ? w : w.toLowerCase())).join(' ');
/** "is" or "are" after a label: "the good tablets are", "the yield is". */
const isAre = (label: string) => (/[^su]s$/.test(label.split(' ').at(-1) ?? '') ? 'are' : 'is');

// Packing: the master's pack facts and the batch facts recorded at issue, in words.
const FACTS: Record<string, string> = {
  'pack.unitsPerPack': 'the tablets per pack', 'pack.packsPerCarton': 'the packs per carton', 'pack.shelfLifeMonths': 'the approved shelf life',
  'pack.expiryRule': 'the expiry rule', 'pack.type': 'the pack type', 'pack.destination': 'the destination', 'pack.gtin': 'the pack GTIN', 'pack.mrp': 'the MRP of the master',
  'batch.bulk': 'the bulk batch number', 'batch.mfgDate': 'the date of manufacture of the bulk', 'batch.tablets': 'the bulk tablets issued',
  'batch.packs': 'the theoretical packs', 'batch.line': 'the packing line',
};

/** One input of a calculation as a part: "$gross" is a field, "$target" a setting, "$net" an earlier calculation. */
function input(block: Block, x: unknown): Part {
  if (typeof x !== 'string' || !x.startsWith('$')) return written(block, x);
  const raw = x.slice(1).replace(/\?$/, '');
  if (FACTS[raw]) return FACTS[raw];
  if (raw.startsWith('earlier.')) return `the ${lower(block.fields.find((f) => f.name === raw.slice(8))?.label ?? raw)} read in earlier rounds`;
  if (raw.startsWith('prev.')) return { prev: raw.slice(5) };
  if (block.settings.some((s) => s.name === raw)) return { setting: raw };
  if (block.fields.some((f) => f.name === raw)) return { field: raw };
  return { calc: raw };
}

/** A value written in the block itself in words: a limit as "at most 0 units", a list one by one, a name by its label. */
function written(block: Block, x: unknown): string {
  if (typeof x === 'string') {
    if (!x.startsWith('$')) return x;
    const raw = x.slice(1).replace(/\?$/, '').replace(/^prev\./, '');
    return `the ${lower([...block.fields, ...block.settings, ...block.calcs].find((y) => y.name === raw)?.label ?? raw)}`;
  }
  if (Array.isArray(x)) return x.map((y) => written(block, y)).join(' and ');
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const w = (...keys: string[]) => keys.map((k) => o[k]).filter((y) => y !== undefined).map((y) => written(block, y))[0];
    const low = w('low', 'min'); const high = w('high', 'max'); const change = w('maxChange', 'maxChangePercent');
    if (low !== undefined || high !== undefined) {
      return limitText({ low, high, unit: typeof o.unit === 'string' ? o.unit : '', lowStrict: o.lowStrict === true, highStrict: o.highStrict === true });
    }
    if (change !== undefined) return `changed by at most ${change}${o.maxChangePercent !== undefined ? ' %' : ''}`;
    return Object.values(o).map((y) => written(block, y)).join(' and ');
  }
  return String(x);
}

export function sentence(block: Block, c: Calc): Part[] {
  const a = c.args as Record<string, unknown>;
  const p = (x: unknown) => input(block, x);
  const limit = (pre = '; it must be ') => (a.limit === undefined ? [] : [pre, p(a.limit)]);
  const label = lower(c.label);
  const is = isAre(label);
  switch (c.template) {
    case 'T1': return [`The ${label} ${is} `, p(a.a), ' minus ', p(a.b), '.'];
    case 'T3': return [`The ${label} ${is} `, p(a.actual), ' as a percentage of ', p(a.theoretical), ...limit(), '.'];
    case 'T4': {
      const parts = (a.parts as { value: unknown }[]).flatMap((x, i) => [i ? ' + ' : '', p(x.value)]);
      return [`The ${label} ${is} `, ...parts, ' as a percentage of ', p(a.input), ...limit('; when limits are set, it must be '), '.'];
    }
    case 'T5': return [`The ${label} ${is} the ${a.mode === 'loss' ? 'loss' : 'gain'} from `, p(a.before), ' to ', p(a.after),
      `, as a percentage of ${a.base === 'start' ? 'the starting weight' : a.base === 'final' ? 'the final weight' : 'the named stage'}`, ...limit(), '.'];
    case 'T7': return [`The ${label} ${is} the mean of `, p(a.readings), ...limit(', which must be '), ...(a.rsdLimit ? ['; the RSD must be ', p(a.rsdLimit)] : []), '.'];
    case 'T13': return [`The ${label} ${is} the time from `, p(a.start), ' to ', p(a.end), ...limit(), '.'];
    case 'C1': {
      const around = a.around as { centre: unknown; plusMinusPercent?: unknown; plusMinus?: unknown } | undefined;
      if (around) return [p(a.value), ' must be within ± ', p(around.plusMinusPercent ?? around.plusMinus), around.plusMinusPercent ? ' % of ' : ' of ', p(around.centre), '.'];
      // None allowed (a count that must be 0): said as such, not "at most 0 units".
      const l = a.limit as { low?: unknown; high?: unknown } | undefined;
      if (l && typeof l === 'object' && l.high === '0' && l.low === undefined) return [p(a.value), ' must be 0: none allowed.'];
      return [p(a.value), ' must be ', p(a.limit), '.'];
    }
    case 'C3': {
      const band = a.band as { plusMinusPercent?: unknown; limit?: unknown }; const outer = a.outer as { plusMinusPercent: unknown } | undefined;
      if (band.limit) return ['Each of ', p(a.readings), ' must be ', p(band.limit), '.'];
      return ['Each of ', p(a.readings), ' must be within ± ', p(band.plusMinusPercent), ` % of the mean, with at most ${String(a.allowedOutside ?? 0)} outside`,
        ...(outer ? [', and none outside ± ', p(outer.plusMinusPercent), ' %'] : []), '.'];
    }
    case 'C4': return [`${String(a.question)}: the answer must be "${(a.expected as string[]).join('" or "')}".`];
    case 'C8': return [p(a.printed), ' must match ', a.kind === 'expiry' ? 'the expiry worked out from the date of manufacture of the bulk and the approved shelf life' : p(a.expected), '.'];
    case 'C9': return ['Each of ', p(a.codes), ' must carry the pack GTIN, the bulk batch number and the expiry, with a serial not read before in this batch.'];
    case 'C6': {
      if (a.test !== 'disintegration') break;
      const [first, more] = a.stages as unknown[];
      return ['Each of ', p(first), ' must be at most ', p(a.maxTime), '; when one or two are not, ', p(more), ' are recorded too, and at least 16 of the 18 must be.'];
    }
    case 'F2': return [p(a.current), ' must not differ by more than ', p((a.limit as { maxChange: unknown }).maxChange), ' from the previous round.'];
  }
  // Any other: the inputs it is worked out from, then the limits it must meet.
  const names = [...new Set(refsIn(a))];
  const isLimit = (n: string) => block.settings.some((x) => x.name === n && x.kind === 'limit');
  const ins = names.filter((n) => !isLimit(n));
  return [`The ${label} ${is} worked out from `, ...ins.flatMap((n, i) => [i === 0 ? '' : i === ins.length - 1 ? ' and ' : ', ', p(`$${n}`)]),
    ...names.filter(isLimit).flatMap((n, i) => [i ? ' and ' : '; it must be ', p(`$${n}`)]), '.'];
}

/** The settings a block's sentences show as slots; the others are asked for on their own. */
export function slotsOf(block: Block): Set<string> {
  return new Set(block.calcs.flatMap((c) => sentence(block, c)).flatMap((x) => (typeof x === 'object' && 'setting' in x ? [x.setting] : [])));
}

export function limitText(l: Limit): string {
  const u = l.unit === '' ? '' : ` ${l.unit}`;
  const low = l.low ? `${l.lowStrict ? 'more than' : 'at least'} ${l.low}${u}` : '';
  const high = l.high ? `${l.highStrict ? 'less than' : 'at most'} ${l.high}${u}` : '';
  if (l.low && l.high && !l.lowStrict && !l.highStrict) return `within ${l.low} to ${l.high}${u}`;
  return [low, high].filter(Boolean).join(' and ') || 'no limits';
}

/** A setting's value in words. */
export function settingText(doc: MasterDoc, v: SettingValue | undefined): string {
  if (v === undefined) return '(not set)';
  if (typeof v === 'string') return v.trim() === '' ? '(none)' : v;
  if ('unit' in v) return limitText(v);
  if ('formula' in v) {
    const l = materialLines(doc).find((x) => x.key === v.formula);
    // A packing material by its name and code, as in the master's packing materials.
    if (l && 'perPack' in l) return `${l.name} (${l.code})`;
    return `the batch quantity of ${l?.name || v.formula}${v.adjusted ? ', adjusted for the lot' : ''}`;
  }
  if ('header' in v) return HEADER_LABEL[v.header].label;
  const [sk, tk, name] = v.ref.split('/');
  const s = doc.stages.find((x) => x.key === sk);
  const t = s?.steps.find((x) => x.key === tk);
  const b = t && findBlock(t.block);
  const what = b ? [...b.fields, ...b.calcs].find((x) => x.name === name)?.label : undefined;
  // The step by its title as on the floor ("Weigh a material: Paracetamol"), not its block's name.
  return `the ${lower(what ?? name ?? '')} of step ${t ? stepTitle(doc, t) : tk} in ${s?.name ?? sk}`;
}

/**
 * A whole sentence in words, with the master's settings filled in (for the review view). An optional setting that is
 * not set is left out with the words before it, as the engine leaves it out; a check on it ("… must be") is left out
 * whole (an empty text). A plain number setting whose label names its unit ("Time limit (min)") reads with it: "15 min".
 */
export function sentenceText(doc: MasterDoc, block: Block, settings: Record<string, SettingValue>, parts: Part[]): string {
  const label = (n: string) => lower([...block.fields, ...block.calcs].find((x) => x.name === n)?.label ?? n);
  const out = [...parts];
  for (let i = out.length - 1; i >= 0; i--) {
    const x = out[i]!;
    if (typeof x !== 'object' || !('setting' in x) || settings[x.setting] !== undefined || !block.settings.find((s) => s.name === x.setting)?.optional) continue;
    const before = out[i - 1];
    if (typeof before === 'string' && /^ must /.test(before)) return '';
    out.splice(typeof before === 'string' ? i - 1 : i, typeof before === 'string' ? 2 : 1);
  }
  const value = (n: string) => {
    const s = block.settings.find((x) => x.name === n);
    const v = settings[n];
    const unit = s?.kind === 'number' && typeof v === 'string' ? /\(([^()±]+)\)$/.exec(s.label)?.[1] : undefined;
    return unit && findUnit(unit) ? `${v} ${unit}` : settingText(doc, v);
  };
  return out.map((x) => (typeof x === 'string' ? x
    : 'setting' in x ? value(x.setting)
    : 'field' in x ? `the ${label(x.field)}`
    : 'calc' in x ? `the ${label(x.calc)}`
    : `the previous round's ${label(x.prev)}`)).join('').replace(/^the /, 'The ');
}

export { unitLabel };
