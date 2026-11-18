import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../server/auth.js';
import { MEANING_NEEDS } from '../server/signatures.js';

// PL-01: the permissions TrueBatch checks are the ones it declares to the platform (draft manifest), in the platform's
// code format `<product>.<thing>[.<action>]`, each with a label for core's people screen.

const manifest = JSON.parse(readFileSync(path.join(import.meta.dirname, '../ops/manifest.draft.json'), 'utf8')) as {
  product: string; database: string; permissions: { code: string; label: string }[]; signon: { backchannel_logout: string };
};

describe('declared permissions', () => {
  it('PL-01: the draft manifest declares exactly the permission codes and labels the server checks', () => {
    expect(Object.fromEntries(manifest.permissions.map((p) => [p.code, p.label]))).toEqual(PERMISSIONS);
    expect(manifest.product).toBe('truebatch');
    expect(manifest.database).toBe('truebatch');
    expect(manifest.signon.backchannel_logout).toBe('/backchannel-logout');
  });

  it('PL-01: every code is a truebatch code in the platform format', () => {
    for (const code of Object.keys(PERMISSIONS)) expect(code).toMatch(/^truebatch(\.[a-z0-9_]+)+$/);
  });

  it('PL-05: every signature meaning needs one declared permission', () => {
    for (const code of Object.values(MEANING_NEEDS)) expect(Object.keys(PERMISSIONS)).toContain(code);
  });
});
