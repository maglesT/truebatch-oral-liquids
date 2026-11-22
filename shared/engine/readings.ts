/**
 * The readings TrueBatch Oral Liquids publishes in report.reading_v1 (round 46, for Operations' continued process
 * verification): every number field of the blocks a liquid master may use, with the master setting that holds its
 * limits, worked out from the block's own checks (a C1 on the value: each reading; a T7 on the list: their mean), or the
 * fixed limit a block writes itself. db/migrations/0026 keeps the same list as the view reading_parameters; a test
 * compares the two, so a new block (or a new number field) needs a migration that replaces that view.
 */
import { blocksFor } from '../blocks/index.js';
import type { Block } from '../blocks/format.js';

export interface ReadingParameter {
  block: string;
  field: string;
  label: string;
  /** The master setting with the limits (a 'limit' setting of the step), or null. */
  limitSetting: string | null;
  /** A limit the block itself writes (e.g. no device may fail: not more than 0 units), or null. */
  fixedLimit: { low?: string; high?: string; unit: string } | null;
  /** What the limit applies to: each reading, or the mean of the list. Null without a limit. */
  limitOf: 'each' | 'mean' | null;
}

const ref = (x: unknown) => (typeof x === 'string' && x.startsWith('$') && !x.startsWith('$prev.') ? x.slice(1).replace(/\?$/, '') : undefined);

function limitOf(b: Block, field: string): Pick<ReadingParameter, 'limitSetting' | 'fixedLimit' | 'limitOf'> {
  for (const c of b.calcs) {
    const a = c.args as { value?: unknown; readings?: unknown; limit?: unknown };
    const on = c.template === 'C1' ? ref(a.value) : c.template === 'T7' ? ref(a.readings) : undefined;
    if (on !== field || a.limit === undefined) continue;
    const of = c.template === 'T7' ? 'mean' : 'each';
    const setting = ref(a.limit);
    if (setting && b.settings.some((s) => s.name === setting && s.kind === 'limit')) return { limitSetting: setting, fixedLimit: null, limitOf: of };
    if (a.limit && typeof a.limit === 'object' && 'unit' in a.limit) return { limitSetting: null, fixedLimit: a.limit as ReadingParameter['fixedLimit'], limitOf: of };
  }
  return { limitSetting: null, fixedLimit: null, limitOf: null };
}

/** Every number field of the blocks a liquid master may use, in block order. */
export function readingParameters(): ReadingParameter[] {
  return blocksFor(false).flatMap((b) => b.fields.filter((f) => f.kind === 'number').map((f) => ({ block: b.id, field: f.name, label: f.label, ...limitOf(b, f.name) })));
}
