import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { validateCandidates } from './llm/validator';
import logger from './logger';

export const router = Router();

// ── POST /validate ────────────────────────────────────────────────────────────

const ValidateBodySchema = z.object({
  posting_id: z.string().min(1),
  cv_ids:     z.array(z.string().min(1)).optional(),
});

router.post('/validate', async (req: Request, res: Response): Promise<void> => {
  const parsed = ValidateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { posting_id, cv_ids: requestedCvIds } = parsed.data;

  // Resolve cv_ids: use provided list or discover from completed match runs
  const cvIds = requestedCvIds ?? db
    .getPendingMatchPairs()
    .filter((p) => p.posting_id === posting_id)
    .map((p) => p.cv_id);

  if (cvIds.length === 0) {
    res.status(404).json({ error: 'No match candidates found for this posting' });
    return;
  }

  for (const cvId of cvIds) {
    db.upsertRun(posting_id, cvId);
  }

  logger.info('Validation job started', { posting_id, cv_count: cvIds.length });
  res.json({ ok: true, posting_id, cv_ids: cvIds, message: 'Validation started in background' });

  for (const cvId of cvIds) {
    const claimed = db.claimRun(posting_id, cvId);
    if (!claimed) {
      logger.info('Validation run already processing or done, skipping', { posting_id, cv_id: cvId });
      continue;
    }

    const candidates = db.getCandidatesForPair(posting_id, cvId);
    if (candidates.length === 0) {
      logger.warn('No match candidates found for pair', { posting_id, cv_id: cvId });
      db.markError(posting_id, cvId, 'No match candidates found');
      continue;
    }

    try {
      const matches = await validateCandidates(posting_id, cvId, candidates);
      db.saveValidations(posting_id, cvId, matches);
      logger.info('Validation run complete', { posting_id, cv_id: cvId, matches: matches.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markError(posting_id, cvId, message);
      logger.warn('Validation run failed', { posting_id, cv_id: cvId, error: message });
    }
  }
});

// ── POST /process-pending ─────────────────────────────────────────────────────

router.post('/process-pending', async (_req: Request, res: Response): Promise<void> => {
  const pairs = db.getPendingMatchPairs();

  if (pairs.length === 0) {
    res.json({ claimed: 0, message: 'No pending match pairs' });
    return;
  }

  for (const { posting_id, cv_id } of pairs) {
    db.upsertRun(posting_id, cv_id);
  }

  logger.info('Batch validation starting', { pairs: pairs.length });
  res.json({ claimed: pairs.length, message: 'Validation started in background' });

  let processed = 0;
  let errors    = 0;

  for (const { posting_id, cv_id } of pairs) {
    const claimed = db.claimRun(posting_id, cv_id);
    if (!claimed) continue;

    const candidates = db.getCandidatesForPair(posting_id, cv_id);
    if (candidates.length === 0) {
      db.markError(posting_id, cv_id, 'No match candidates found');
      errors++;
      continue;
    }

    try {
      const matches = await validateCandidates(posting_id, cv_id, candidates);
      db.saveValidations(posting_id, cv_id, matches);
      processed++;
      logger.info('Pair validated', { posting_id, cv_id, matches: matches.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markError(posting_id, cv_id, message);
      errors++;
      logger.warn('Pair validation failed', { posting_id, cv_id, error: message });
    }
  }

  logger.info('Batch validation complete', { processed, errors });
});

// ── GET /validations ──────────────────────────────────────────────────────────

router.get('/validations', (req: Request, res: Response): void => {
  const posting_id = typeof req.query.posting_id === 'string' ? req.query.posting_id : undefined;
  const cv_id      = typeof req.query.cv_id      === 'string' ? req.query.cv_id      : undefined;
  const limit      = Math.min(Number(req.query.limit  ?? 200), 1000);
  const offset     = Number(req.query.offset ?? 0);

  res.json(db.getValidations({ posting_id, cv_id, limit, offset }));
});

// ── GET /validations/:posting_id/:cv_id ───────────────────────────────────────

router.get('/validations/:posting_id/:cv_id', (req: Request, res: Response): void => {
  const { posting_id, cv_id } = req.params;
  const matches = db.getValidations({ posting_id, cv_id });

  if (matches.length === 0) {
    res.status(404).json({ error: 'No validated matches found for this pair' });
    return;
  }

  res.json({ posting_id, cv_id, count: matches.length, matches });
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
