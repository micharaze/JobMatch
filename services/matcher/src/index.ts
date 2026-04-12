import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import logger from './logger';

const PORT = Number(process.env.PORT ?? 3004);

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
  const server = app.listen(PORT, () => {
    logger.info('Matcher service started', { port: PORT });
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
