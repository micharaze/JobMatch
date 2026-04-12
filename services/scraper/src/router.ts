import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { scraperFor, registeredHostnames } from './scrapers/base';
import { db } from './db/sqlite';
import logger from './logger';

// Import scrapers so they self-register via registerScraper()
import './scrapers/freelancermap';
import './scrapers/gulp';
import './scrapers/xing';

export const router = Router();

const ScrapeBodySchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ urls: z.array(z.string().url()).min(1) }),
]);

// ── POST /scrape ─────────────────────────────────────────────────────────────

router.post('/scrape', async (req: Request, res: Response): Promise<void> => {
  const parsed = ScrapeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const urls: string[] =
    'urls' in parsed.data ? parsed.data.urls : [parsed.data.url];

  // Validate all URLs have a registered scraper before starting
  for (const url of urls) {
    if (!scraperFor(url)) {
      let hostname = url;
      try { hostname = new URL(url).hostname; } catch { /* use raw url */ }
      res.status(400).json({
        error: `No scraper registered for: ${hostname}`,
        supported: registeredHostnames(),
      });
      return;
    }
  }

  const results = {
    scraped: 0,
    skipped: 0,
    errors: [] as Array<{ url: string; error: string }>,
  };

  for (const url of urls) {
    // Skip if already in DB (avoids unnecessary network requests)
    if (db.existsByUrl(url)) {
      logger.info('Skipping — already in database', { url });
      results.skipped++;
      continue;
    }

    const scraper = scraperFor(url)!;
    try {
      const posting = await scraper.scrape(url);
      const inserted = db.upsert(posting);
      if (inserted) {
        results.scraped++;
        logger.info('Posting scraped and stored', { id: posting.id, url });
      } else {
        results.skipped++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Scrape failed', { url, error: message });
      db.logFailure(url, message);
      results.errors.push({ url, error: message });
    }
  }

  res.json(results);
});

// ── GET /postings ─────────────────────────────────────────────────────────────

router.get('/postings', (req: Request, res: Response): void => {
  const source = typeof req.query.source === 'string' ? req.query.source : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  res.json(db.findAll({ source, limit, offset }));
});

// ── GET /postings/:id ─────────────────────────────────────────────────────────

router.get('/postings/:id', (req: Request, res: Response): void => {
  const posting = db.findById(req.params.id);
  if (!posting) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(posting);
});

// ── DELETE /postings ──────────────────────────────────────────────────────────
// Body: { url: string } | { urls: string[] }

router.delete('/postings', (req: Request, res: Response): void => {
  const body = req.body as { url?: string; urls?: string[] };
  const urls: string[] = body.urls ?? (body.url ? [body.url] : []);

  if (urls.length === 0) {
    res.status(400).json({ error: 'Provide url or urls in the request body' });
    return;
  }

  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const url of urls) {
    if (db.deleteByUrl(url)) {
      deleted.push(url);
    } else {
      notFound.push(url);
    }
  }

  res.json({ deleted: deleted.length, not_found: notFound.length, deleted_urls: deleted });
});

// ── GET /failures ─────────────────────────────────────────────────────────────

router.get('/failures', (_req: Request, res: Response): void => {
  res.json(db.findFailures());
});
