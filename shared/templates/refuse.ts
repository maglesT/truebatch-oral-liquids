/** A template refuses by throwing Refused with a plain-English message; `run` turns it into { ok: false }. */
export class Refused extends Error {}

export function refuse(message: string): never {
  throw new Refused(message);
}
