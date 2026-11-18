import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Sql } from './db.js';
import { BACKGROUND_HEADER, SESSION_COOKIE, loadSession } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { masterDataRoutes } from './routes/masterdata.js';
import { masterRoutes } from './routes/masters.js';
import { batchRoutes } from './routes/batches.js';
import { demoRoutes } from './demo.js';
import type { SignOn } from './signon.js';
import { ConnectionOff, NotUsable, type Master } from './master.js';
import { links as noLinks, type Links } from './links.js';
import { TABLETS, productSignOn, type Product } from './product.js';

export const VERSION = '0.1.0';

export interface AppOptions {
  // Connection running as the restricted application role.
  sql: Sql;
  // Sign-on through Medhanta core; tests pass a stand-in.
  signOn: SignOn;
  // Key for the short signing proofs made after core's re-authentication (PL-05); random per process by default.
  proofKey?: Buffer;
  // Master data read live from master_data's views; tests pass a stand-in.
  master: Master;
  // The optional links to Deviations, QMS, Logbook and MMS; absent by default.
  links?: Links;
  logger?: boolean;
  webRoot?: string;
  // Secure flag on the session cookie; off only for plain-HTTP development.
  cookieSecure?: boolean;
  // The fixed start of every batch number (TB-03).
  batchPrefix?: string;
  // Which product this server is: TrueBatch Tablets (default) or TrueBatch Tablets Packing (server/product.ts).
  product?: Product;
  // A demo installation (TRUEBATCH_DEMO=1, server/demo.ts): the screens say DEMO and waits may be skipped.
  demo?: boolean;
}

export async function buildApp({ sql, signOn: core, master, links = noLinks(), proofKey = randomBytes(32), logger = false, webRoot, cookieSecure = true, product = TABLETS,
  batchPrefix = product.batchPrefix, demo = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true });
  const signOn = productSignOn(core, product);
  app.decorate('product', product);
  app.decorate('cookieSecure', cookieSecure);
  app.decorate('proofKey', proofKey);
  app.decorate('master', master);
  app.decorate('links', links);
  app.decorate('batchPrefix', batchPrefix);
  app.decorate('demo', demo);
  // A cut master-data link stops the feature with one message (platform D-02, PL-08); an unknown or inactive item is
  // refused at write time (PL-08).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ConnectionOff) return reply.code(503).send({ error: 'connection_off', message: err.message });
    if (err instanceof NotUsable) return reply.code(409).send({ error: err.code, message: err.message });
    return reply.send(err);
  });
  await app.register(fastifyCookie);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // Writes must be JSON: together with SameSite=Strict cookies this blocks cross-site form posts.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.headers['content-type']?.startsWith('application/json')) {
      return reply.code(415).send({ error: 'json_required' });
    }
    const sid = req.cookies[SESSION_COOKIE];
    // Logout reads the stored session itself: an idle or refused session still yields core's logout hint.
    if (sid && req.url !== '/api/logout') req.user = (await loadSession(sql, signOn, sid, !req.headers[BACKGROUND_HEADER])) ?? undefined;
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      const [row] = await sql<{ now: Date }[]>`select now() as now`;
      return { status: 'ok', version: VERSION, db: 'ok', serverTime: row!.now.toISOString(), ...(app.demo ? { demo: true } : {}) };
    } catch {
      return reply.code(503).send({ status: 'error', version: VERSION, db: 'unreachable' });
    }
  });

  authRoutes(app, sql, signOn);
  masterDataRoutes(app);
  masterRoutes(app, sql);
  batchRoutes(app, sql);
  demoRoutes(app, sql);

  // In production the built web UI is served from the same process.
  const root = webRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
  if (existsSync(path.join(root, 'index.html'))) {
    await app.register(fastifyStatic, { root });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    cookieSecure: boolean;
    proofKey: Buffer;
    master: Master;
    links: Links;
    product: Product;
  }
}
