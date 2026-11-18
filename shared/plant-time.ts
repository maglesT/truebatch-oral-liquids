// Times as people read them: plant time (IST), never raw UTC or ISO text (owner, 15 Nov 2026). The record keeps the
// exact instant; only what is shown is turned into plant time: worked lines, values read through a link, messages.
export const PLANT_TZ = 'Asia/Kolkata';
// "2026-11-15T18:23:50Z", "2026-11-15T18:23:50.123+05:30", "2026-11-15 17:38:16.254+00" (PostgreSQL text).
const STAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)(?![\d:])/g;

// The browser's and Node's date words write September "Sept" (en-GB, en-IN); every date here says "Sep".
export const sep = (s: string) => s.replace(/\bSept\b/g, 'Sep');

/**
 * One instant in plant time, the one format of every screen (owner, 17 Nov 2026): "17 Nov, 16:32 IST", with the year
 * only when it is not this year ("17 Nov 2025, 16:32 IST"); to the minute, never seconds. `full`: always with the year,
 * for the printed record ("17 Nov 2026, 16:32 IST").
 */
export function plantClock(t: string | Date, full = false, now: Date = new Date()): string {
  const d = new Date(t);
  const year = (x: Date) => x.toLocaleString('en-GB', { timeZone: PLANT_TZ, year: 'numeric' });
  const s = d.toLocaleString('en-GB', { timeZone: PLANT_TZ, day: 'numeric', month: 'short', ...(full || year(d) !== year(now) ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${sep(s)} IST`;
}

// A calendar date on its own ("2029-10-31": a lot's expiry, a date of manufacture), not inside a code or a time stamp.
const DATE = /(?<![\w-])(\d{4})-(\d{2})-(\d{2})(?![\w-]|[T ]\d{2}:)/g;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar date as people read it: "31 Oct 2029" (the date itself, no time zone); anything else unchanged. */
export function plantDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? `${Number(m[3])} ${month} ${m[1]}` : date;
}

/**
 * Every time stamp in a text in plant time, as plantClock writes it (`full`: with the year, for the printed record), and
 * every date as "31 Oct 2029". The record keeps the exact instant.
 */
export const plantText = (text: string, full = false) => text.replace(STAMP, (m) => {
  const d = new Date(m.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? m : plantClock(d, full);
}).replace(DATE, (m) => plantDate(m));
