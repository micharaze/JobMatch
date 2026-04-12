import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import logger from './logger';

const PORT               = Number(process.env.PORT ?? 3002);
const PROCESS_INTERVAL_MS = Number(process.env.PROCESS_INTERVAL_MS ?? 0);

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json());
app.use('/', router);

async function start(): Promise<void> {
  db.recoverStale();

  // Optional background polling (disabled by default — use POST /process-pending instead)
  if (PROCESS_INTERVAL_MS > 0) {
    setInterval(() => {
      // Fire-and-forget via the router logic
      void fetch(`http://localhost:${PORT}/process-pending`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      }).catch((err: unknown) => logger.error('Auto process-pending failed', { error: String(err) }));
    }, PROCESS_INTERVAL_MS);
  }

  const server = app.listen(PORT, () => {
    logger.info('Normalizer service started', { port: PORT });
  });

  process.on('SIGTERM', () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}

start().catch((err: unknown) => {
  logger.error('Fatal startup error', { error: String(err) });
  process.exit(1);
});
