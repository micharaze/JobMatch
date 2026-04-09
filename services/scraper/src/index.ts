import express from 'express';
import { router } from './router';
import { closeBrowser } from './browser';
import { db } from './db/sqlite';
import logger from './logger';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json());
app.use(router);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const server = app.listen(PORT, () => {
  logger.info('Scraper service started', { port: PORT });
});

async function shutdown(): Promise<void> {
  logger.info('Shutting down scraper service');
  server.close();
  await closeBrowser();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
