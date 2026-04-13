import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { scraperFor } from './scrapers/base';
import { getBrowser } from './browser';
import { db } from './db/sqlite';
import logger from './logger';

// Import scrapers so they self-register via registerScraper()
import './scrapers/freelancermap';
import './scrapers/gulp';
import './scrapers/xing';
import './scrapers/solcom';

export const router = Router();

// ── Redirect resolution helpers ───────────────────────────────────────────────

/**
 * Follow common tracker/proxy query params without any network request.
 * Mirrors the same logic used in the frontend EML parser.
 * e.g. jobscout.dev/proxy?target= → gulp.de/tracker?project_url= → solcom.de/…
 */
function resolveQueryParams(url: string, depth = 0): string {
  if (depth >= 8) return url;
  try {
    const u = new URL(url);
    const target =
      u.searchParams.get('target') ??
      u.searchParams.get('project_url') ??
      u.searchParams.get('url') ??
      u.searchParams.get('redirect');
    if (target) return resolveQueryParams(target, depth + 1);
  } catch { /* ignore */ }
  return url;
}

/**
 * Follow HTTP + JavaScript redirects using a headless browser.
 * Returns the final URL after all redirects have settled.
 */
async function resolveWithBrowser(url: string): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    return page.url();
  } finally {
    await page.close();
  }
}

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

    let scraper = scraperFor(url);
    let targetUrl = url;

    if (!scraper) {
      // Step 1: resolve tracker/proxy query params without a network request
      const paramResolved = resolveQueryParams(url);
      if (paramResolved !== url) {
        logger.info('Resolved via query params', { from: url, to: paramResolved });
        scraper = scraperFor(paramResolved);
        targetUrl = paramResolved;
      }
    }

    if (!scraper) {
      // Step 2: follow HTTP / JS redirects via a headless browser
      try {
        const browserResolved = await resolveWithBrowser(url);
        if (browserResolved !== url) {
          logger.info('Resolved via browser redirect', { from: url, to: browserResolved });
          scraper = scraperFor(browserResolved);
          targetUrl = browserResolved;
        }
      } catch (err) {
        logger.warn('Browser redirect resolution failed', { url, error: String(err) });
      }
    }

    if (!scraper) {
      let hostname = url;
      try { hostname = new URL(url).hostname; } catch { /* keep raw */ }
      const message = `No scraper registered for: ${hostname}`;
      logger.warn('No scraper found for URL', { url, hostname });
      db.logFailure(url, message);
      results.errors.push({ url, error: message });
      continue;
    }

    // Check deduplication against the resolved target URL
    if (targetUrl !== url && db.existsByUrl(targetUrl)) {
      logger.info('Skipping — resolved URL already in database', { url, targetUrl });
      results.skipped++;
      continue;
    }

    try {
      const posting = await scraper.scrape(targetUrl);
      const inserted = db.upsert(posting);
      if (inserted) {
        results.scraped++;
        logger.info('Posting scraped and stored', { id: posting.id, url: targetUrl });
      } else {
        results.skipped++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Scrape failed', { url: targetUrl, error: message });
      db.logFailure(targetUrl, message);
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
