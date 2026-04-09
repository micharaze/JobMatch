import 'dotenv/config';
import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import logger from './logger';

const PORT = Number(process.env.PORT ?? 3005);

const app = express();
app.use(express.json());
app.use(router);

const server = app.listen(PORT, () => {
  logger.info('Validator service started', { port: PORT });
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(): void {
  logger.info('Shutting down validator service');
  server.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
