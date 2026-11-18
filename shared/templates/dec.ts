/** One decimal.js configuration for the whole library: 50 significant digits, half-up. */
import { Decimal } from 'decimal.js';

export const Dec = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });
export type Dec = Decimal;
