import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { calculateScore } from './scorer';
import logger from './logger';

export const router = Router();

// ── Shared scoring helper ─────────────────────────────────────────────────────

async function scorePair(postingId: string, cvId: string): Promise<void> {
  const matches  = db.getValidatedMatches(postingId, cvId);
  const jobCounts = db.getJobSkillCounts(postingId);
  const jobLevel  = db.getExperienceLevel(postingId);
  const cvLevel   = db.getExperienceLevel(cvId);

  const result = calculateScore(postingId, cvId, matches, jobCounts, cvLevel, jobLevel);
  db.saveScore(result);

  logger.info('Pair scored', {
    posting_id:  postingId,
    cv_id:       cvId,
    final_score: result.final_score,
  });
}

// ── POST /score ───────────────────────────────────────────────────────────────

const ScoreBodySchema = z.object({
  posting_id: z.string().min(1),
  cv_ids:     z.array(z.string().min(1)).optional(),
});

router.post('/score', async (req: Request, res: Response): Promise<void> => {
  const parsed = ScoreBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { posting_id, cv_ids: requestedCvIds } = parsed.data;

  const cvIds = requestedCvIds ?? db
    .getPendingValidationPairs()
    .filter((p) => p.posting_id === posting_id)
    .map((p) => p.cv_id);

  if (cvIds.length === 0) {
    res.status(404).json({ error: 'No validated matches found for this posting' });
    return;
  }

  logger.info('Scoring job started', { posting_id, cv_count: cvIds.length });
  res.json({ ok: true, posting_id, cv_ids: cvIds, message: 'Scoring started in background' });

  for (const cvId of cvIds) {
    try {
      await scorePair(posting_id, cvId);
    } catch (err) {
      logger.warn('Scoring failed for pair', {
        posting_id,
        cv_id:  cvId,
        error:  err instanceof Error ? err.message : String(err),
      });
    }
  }
});

// ── POST /process-pending ─────────────────────────────────────────────────────

router.post('/process-pending', async (_req: Request, res: Response): Promise<void> => {
  const pairs = db.getPendingValidationPairs();

  if (pairs.length === 0) {
    res.json({ scored: 0, message: 'No pending validation pairs' });
    return;
  }

  logger.info('Batch scoring starting', { pairs: pairs.length });
  res.json({ scored: pairs.length, message: 'Scoring started in background' });

  let processed = 0;
  let errors    = 0;

  for (const { posting_id, cv_id } of pairs) {
    try {
      await scorePair(posting_id, cv_id);
      processed++;
    } catch (err) {
      errors++;
      logger.warn('Scoring failed for pair', {
        posting_id,
        cv_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Batch scoring complete', { processed, errors });
});

// ── GET /scores ───────────────────────────────────────────────────────────────

router.get('/scores', (req: Request, res: Response): void => {
  const posting_id = typeof req.query.posting_id === 'string' ? req.query.posting_id : undefined;
  const cv_id      = typeof req.query.cv_id      === 'string' ? req.query.cv_id      : undefined;
  const limit      = Math.min(Number(req.query.limit  ?? 100), 1000);
  const offset     = Number(req.query.offset ?? 0);

  res.json(db.getScores({ posting_id, cv_id, limit, offset }));
});

// ── GET /scores/:posting_id ───────────────────────────────────────────────────

router.get('/scores/:posting_id', (req: Request, res: Response): void => {
  const scores = db.getScores({ posting_id: req.params.posting_id });

  if (scores.length === 0) {
    res.status(404).json({ error: 'No scores found for this posting' });
    return;
  }

  res.json({ posting_id: req.params.posting_id, count: scores.length, scores });
});

// ── GET /scores/:posting_id/:cv_id ────────────────────────────────────────────

router.get('/scores/:posting_id/:cv_id', (req: Request, res: Response): void => {
  const { posting_id, cv_id } = req.params;
  const scores = db.getScores({ posting_id, cv_id, limit: 1 });

  if (scores.length === 0) {
    res.status(404).json({ error: 'No score found for this pair' });
    return;
  }

  res.json(scores[0]);
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});
