import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import { extractSkills } from './llm/extractor';
import logger from './logger';

const PORT                = Number(process.env.PORT                ?? 3002);
const PROCESS_INTERVAL_MS = Number(process.env.PROCESS_INTERVAL_MS ?? 0);
const BATCH_LIMIT         = Number(process.env.BATCH_LIMIT         ?? 50);

const app = express();
app.use(express.json());
app.use(router);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const server = app.listen(PORT, () => {
  logger.info('Extractor service started', { port: PORT });
});

// Reset any rows left stuck in 'processing' from a prior crash
db.recoverStale();

// ── Optional background auto-processing ──────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runBatch(): Promise<void> {
  const pending = db.claimPending(BATCH_LIMIT);
  if (pending.length === 0) return;

  logger.info('Auto-batch started', { count: pending.length });

  for (const posting of pending) {
    try {
      const result = await extractSkills(posting.description, 'job_posting');
      db.markDone(posting.id, result);
      logger.info('Auto-batch: posting extracted', { posting_id: posting.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markError(posting.id, message);
      logger.warn('Auto-batch: extraction error', { posting_id: posting.id, error: message });
    }
  }
}

if (PROCESS_INTERVAL_MS > 0) {
  logger.info('Auto-processing enabled', { interval_ms: PROCESS_INTERVAL_MS });
  intervalHandle = setInterval(() => { void runBatch(); }, PROCESS_INTERVAL_MS);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(): void {
  logger.info('Shutting down extractor service');
  if (intervalHandle !== null) clearInterval(intervalHandle);
  server.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
