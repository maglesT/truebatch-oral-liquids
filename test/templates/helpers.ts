import { expect } from 'vitest';
import type { Done, Outcome } from '../../shared/templates/core.js';

/** The result, failing the test if the template refused. */
export function ok<X extends object>(r: Outcome<X>): Done & X {
  if (!r.ok) throw new Error(`refused: ${r.message}`);
  return r;
}

/** The refusal message, failing the test if the template did not refuse. */
export function refused(r: Outcome<object>): string {
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.message;
}
