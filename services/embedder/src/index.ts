import 'dotenv/config';
import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import { unloadModel } from './embedding/client';
import logger from './logger';

const PORT = Number(process.env.PORT ?? 3003);

const app = express();
app.use(express.json());
app.use(router);

// Recover any stale processing rows from a prior crash
db.recoverStale();

const server = app.listen(PORT, () => {
  logger.info('Embedder service started', { port: PORT });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  logger.info('Shutting down embedder service');
  server.close();
  try {
    await unloadModel();
  } catch (err) {
    logger.warn('Failed to unload embedding model on shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT',  () => { void shutdown(); });
