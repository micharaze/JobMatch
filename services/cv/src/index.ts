import express from 'express';
import { router } from './router';
import { db } from './db/sqlite';
import logger from './logger';

const PORT = Number(process.env.PORT ?? 3007);

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json());
app.use(router);

const server = app.listen(PORT, () => {
  logger.info('CV service started', { port: PORT });
});

function shutdown(): void {
  logger.info('Shutting down CV service');
  server.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
