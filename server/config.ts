import { z } from 'zod';
import { TABLETS, type Product } from './product.js';

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());
const schema = z.object({
  // The app connects as the restricted role truebatch_app (PL-06); migrations use MIGRATION_DATABASE_URL.
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  // Set only when DATABASE_URL logs in as the owner (local development): the app then switches role.
  DB_APP_ROLE: z.string().optional(),
  // master_data's views, read with TrueBatch's own login while the link is on (PL-08).
  MASTER_DATA_DATABASE_URL: z.string().url(),
  // The optional links (PL-08), written by apply only while each link is on; unset, people go on by hand.
  DEVIATIONS_DATABASE_URL: optionalUrl,
  QMS_DATABASE_URL: optionalUrl,
  LOGBOOK_DATABASE_URL: optionalUrl,
  MMS_DATABASE_URL: optionalUrl,
  // Recruitment's training_v1: only trained people sign a step that names a training (owner, 17 Nov 2026).
  RECRUITMENT_DATABASE_URL: optionalUrl,
  // Packing only: TrueBatch Tablets' published views (its bulk batches), TRUEBATCH_DATABASE_URL on the platform.
  TRUEBATCH_LINK_URL: optionalUrl,
  // Sign-on through Medhanta core, written by the platform's apply.
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().default('truebatch'),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI: z.string().url(),
  // Set to false only for plain-HTTP development; production runs behind TLS.
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  // The fixed start of every batch number, then the plant year and a counter: TB260001 (TB-03).
  BATCH_PREFIX: z.string().regex(/^[A-Z]{1,6}$/).default('TB'),
  // Plant-local display time zone; storage is always UTC.
  DISPLAY_TZ: z.string().default('Asia/Kolkata'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, product: Product = TABLETS): Config {
  // On the Medhanta platform apply names the product's own database <PRODUCT>_DATABASE_URL (TRUEBATCH_DATABASE_URL,
  // TRUEBATCH_PACKING_DATABASE_URL), its sign-on client after the product, and each link after its provider.
  const own = env[`${product.id.toUpperCase()}_DATABASE_URL`];
  return schema.parse({ ...env, DATABASE_URL: env.DATABASE_URL ?? own, OIDC_CLIENT_ID: env.OIDC_CLIENT_ID ?? product.id, BATCH_PREFIX: env.BATCH_PREFIX ?? product.batchPrefix,
    TRUEBATCH_LINK_URL: product.id === TABLETS.id ? undefined : env.TRUEBATCH_DATABASE_URL });
}
