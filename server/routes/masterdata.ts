import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../auth.js';

// Master data is read live from core's master_data views (PL-08) for pick lists: products, materials, equipment and
// rooms. Anyone with a TrueBatch permission may read them; a cut link answers 503 "connection off" (app.ts).
export function masterDataRoutes(app: FastifyInstance) {
  const anyUser = { preHandler: requirePermission() };
  app.get('/api/master/products', anyUser, async () => app.master.products());
  app.get('/api/master/materials', anyUser, async () => app.master.materials());
  app.get('/api/master/equipment', anyUser, async () => app.master.equipment());
  app.get('/api/master/rooms', anyUser, async () => app.master.rooms());
}
