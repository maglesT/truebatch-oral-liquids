import type { Sql } from './db.js';
import { audit } from './audit.js';
import { loadBatch } from './routes/batches.js';
import { timers } from '../shared/engine/index.js';

// A hold time or a periodic check that runs over is recorded once, as a "late" step event, as the Logbook records
// each overdue limit once. Whether the batch may go on is computed from the times themselves (shared/engine), so it
// never depends on this job having run.

/** Records every timer now late that is not on record yet. Returns the number of new records. */
export async function recordLate(sql: Sql): Promise<number> {
  let added = 0;
  // A released or rejected batch is finished: nothing more runs late.
  for (const { id } of await sql<{ id: number }[]>`select b.id::int from batches b where not exists
      (select 1 from batch_events e where e.batch_id = b.id and e.kind in ('released', 'rejected')) order by b.id`) {
    const l = await loadBatch(sql, id);
    if (!l) continue;
    for (const t of timers(l.doc, l.events, l.now)) {
      if (t.state !== 'late') continue;
      added += await sql.begin(async (tx) => {
        const [e] = await tx<{ id: number }[]>`
          insert into step_events (batch_id, stage, sub, step, round, kind, payload)
          values (${id}, ${t.key.stage}, ${t.key.sub}, ${t.key.step}, ${t.key.round}, 'late',
                  ${tx.json({ timer: t.id, kind: t.kind, label: t.label, due: t.at.toISOString() })})
          on conflict do nothing returning id::int`;
        if (e) await audit(tx, { actorId: null, action: 'step.late', objectType: 'batch', objectId: id, new: { event: e.id, timer: t.id, due: t.at.toISOString() } });
        return e ? 1 : 0;
      });
    }
  }
  return added;
}

/** Checks every minute inside the server process (as the Logbook's overdue job does). */
export function scheduleLate(sql: Sql, log: (msg: string) => void, everyMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await recordLate(sql);
      if (n) log(`late: ${n} hold time(s) or periodic check(s) ran over`);
    } catch (e) {
      log(`late check could not run: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
