import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { matchCvToJob } from './llm/matcher';
import logger from './logger';

export const router = Router();

// ── POST /match ───────────────────────────────────────────────────────────────

const MatchBodySchema = z.object({
  posting_id: z.string().min(1),
  cv_id:      z.string().min(1).optional(),
});

router.post('/match', async (req: Request, res: Response): Promise<void> => {
  const parsed = MatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { posting_id, cv_id: requestedCvId } = parsed.data;

  const posting = db.findNormalizedPosting(posting_id);
  if (!posting) {
    res.status(404).json({ error: 'Posting not found or not yet normalized' });
    return;
  }

  const cvIds = requestedCvId ? [requestedCvId] : db.getAllNormalizedCvIds();
  if (cvIds.length === 0) {
    res.status(404).json({ error: 'No normalized CVs found' });
    return;
  }

  logger.info('Match job started', { posting_id, cv_count: cvIds.length });
  res.json({ ok: true, posting_id, cv_ids: cvIds, message: 'Matching started in background' });

  setImmediate(async () => {
    for (const cvId of cvIds) {
      const cv = db.findNormalizedCv(cvId);
      if (!cv) {
        logger.warn('CV not found or not normalized, skipping', { cv_id: cvId });
        continue;
      }
      try {
        const result = await matchCvToJob(posting_id, cvId, posting.normalized_text, cv.normalized_text);
        db.upsertMatchResult(result);
      } catch (err) {
        logger.warn('Match failed for pair', {
          posting_id,
          cv_id: cvId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('Match job complete', { posting_id, cv_count: cvIds.length });
  });
});

// ── POST /process-pending ─────────────────────────────────────────────────────

router.post('/process-pending', async (_req: Request, res: Response): Promise<void> => {
  const pairs = db.getPendingPairs();

  if (pairs.length === 0) {
    res.json({ pending: 0, message: 'No pending pairs' });
    return;
  }

  logger.info('process-pending started', { pairs: pairs.length });
  res.json({ pending: pairs.length, message: 'Matching started in background' });

  setImmediate(async () => {
    let done   = 0;
    let errors = 0;

    for (const { posting_id, cv_id } of pairs) {
      const posting = db.findNormalizedPosting(posting_id);
      const cv      = db.findNormalizedCv(cv_id);

      if (!posting || !cv) {
        errors++;
        continue;
      }

      try {
        const result = await matchCvToJob(posting_id, cv_id, posting.normalized_text, cv.normalized_text);
        db.upsertMatchResult(result);
        done++;
      } catch (err) {
        errors++;
        logger.warn('Match failed', {
          posting_id,
          cv_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('process-pending complete', { done, errors });
  });
});

// ── GET /matches ──────────────────────────────────────────────────────────────

router.get('/matches', (req: Request, res: Response): void => {
  const posting_id = typeof req.query.posting_id === 'string' ? req.query.posting_id : undefined;
  const cv_id      = typeof req.query.cv_id      === 'string' ? req.query.cv_id      : undefined;
  const limit      = Math.min(Number(req.query.limit  ?? 100), 1000);
  const offset     = Number(req.query.offset ?? 0);

  res.json(db.findMatches({ posting_id, cv_id, limit, offset }));
});

// ── GET /matches/:posting_id ──────────────────────────────────────────────────

router.get('/matches/:posting_id', (req: Request, res: Response): void => {
  const matches = db.findMatches({ posting_id: req.params.posting_id });

  if (matches.length === 0) {
    res.status(404).json({ error: 'No match results found for this posting' });
    return;
  }

  res.json({ posting_id: req.params.posting_id, count: matches.length, matches });
});

// ── GET /matches/:posting_id/:cv_id ──────────────────────────────────────────

router.get('/matches/:posting_id/:cv_id', (req: Request, res: Response): void => {
  const { posting_id, cv_id } = req.params;
  const result = db.findMatchByPair(posting_id, cv_id);

  if (!result) {
    res.status(404).json({ error: 'No match result found for this pair' });
    return;
  }

  res.json(result);
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});
