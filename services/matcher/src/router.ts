import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { matchPostingAgainstCv } from './matcher';
import logger from './logger';

export const router = Router();

// ── POST /match ───────────────────────────────────────────────────────────────

const MatchBodySchema = z.object({
  posting_id: z.string().min(1),
  cv_ids:     z.array(z.string().min(1)).optional(),
});

router.post('/match', async (req: Request, res: Response): Promise<void> => {
  const parsed = MatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { posting_id, cv_ids: requestedCvIds } = parsed.data;

  // Resolve cv_ids: use provided list or fall back to all embedded CVs
  const cvIds = requestedCvIds ?? db.getEmbeddedCvIds();

  if (cvIds.length === 0) {
    res.status(404).json({ error: 'No embedded CVs found to match against' });
    return;
  }

  // Register runs and respond immediately
  for (const cvId of cvIds) {
    db.upsertRun(posting_id, cvId);
  }

  logger.info('Match job started', { posting_id, cv_count: cvIds.length });
  res.json({ ok: true, posting_id, cv_ids: cvIds, message: 'Matching started in background' });

  // Process after response is flushed
  for (const cvId of cvIds) {
    const claimed = db.claimRun(posting_id, cvId);
    if (!claimed) {
      logger.info('Run already processing or done, skipping', { posting_id, cv_id: cvId });
      continue;
    }

    try {
      const candidates = await matchPostingAgainstCv(posting_id, cvId);
      db.saveCandidates(posting_id, cvId, candidates);
      logger.info('Match run complete', { posting_id, cv_id: cvId, candidates: candidates.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markError(posting_id, cvId, message);
      logger.warn('Match run failed', { posting_id, cv_id: cvId, error: message });
    }
  }
});

// ── GET /matches ──────────────────────────────────────────────────────────────

router.get('/matches', (req: Request, res: Response): void => {
  const posting_id = typeof req.query.posting_id === 'string' ? req.query.posting_id : undefined;
  const cv_id      = typeof req.query.cv_id      === 'string' ? req.query.cv_id      : undefined;
  const limit      = Math.min(Number(req.query.limit  ?? 200), 1000);
  const offset     = Number(req.query.offset ?? 0);

  res.json(db.getCandidates({ posting_id, cv_id, limit, offset }));
});

// ── GET /matches/:posting_id/:cv_id ───────────────────────────────────────────

router.get('/matches/:posting_id/:cv_id', (req: Request, res: Response): void => {
  const { posting_id, cv_id } = req.params;
  const candidates = db.getCandidates({ posting_id, cv_id });

  if (candidates.length === 0) {
    res.status(404).json({ error: 'No match candidates found for this pair' });
    return;
  }

  res.json({ posting_id, cv_id, count: candidates.length, candidates });
});

// ── GET /status ───────────────────────────────────────────────────────────────

router.get('/status', (_req: Request, res: Response): void => {
  try {
    res.json(db.statusCounts());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});
