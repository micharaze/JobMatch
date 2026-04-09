import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { extractSkills } from './llm/extractor';
import logger from './logger';

export const router = Router();

// ── POST /extract ─────────────────────────────────────────────────────────────

const ExtractBodySchema = z.object({
  posting_id: z.string().min(1),
});

router.post('/extract', async (req: Request, res: Response): Promise<void> => {
  const parsed = ExtractBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { posting_id } = parsed.data;
  const posting = db.findPostingById(posting_id);

  if (!posting) {
    res.status(404).json({ error: 'Posting not found' });
    return;
  }

  const claimed = db.claimSingle(posting_id);
  if (!claimed) {
    res.status(409).json({
      error: 'Posting is not in pending state',
      hint: 'It may already be processing, done, or in error state.',
    });
    return;
  }

  try {
    const result = await extractSkills(posting.description, 'job_posting');
    db.markDone(posting_id, result);
    logger.info('Single extraction complete', { posting_id });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.markError(posting_id, message);
    res.status(500).json({ error: 'Extraction failed', detail: message });
  }
});

// ── POST /process-pending ─────────────────────────────────────────────────────

const ProcessPendingBodySchema = z.object({
  limit: z.number().int().positive().max(200).optional().default(50),
});

router.post('/process-pending', async (req: Request, res: Response): Promise<void> => {
  const parsed = ProcessPendingBodySchema.safeParse(req.body ?? {});
  const limit = parsed.success ? parsed.data.limit : 50;

  const pending = db.claimPending(limit);

  if (pending.length === 0) {
    res.json({ claimed: 0, message: 'No pending postings' });
    return;
  }

  logger.info('Batch extraction starting', { claimed: pending.length });

  // Respond immediately so the caller is not blocked by LLM latency
  res.json({ claimed: pending.length, message: 'Processing started in background' });

  // Process after response is flushed
  let processed = 0;
  let errors = 0;

  for (const posting of pending) {
    try {
      const result = await extractSkills(posting.description, 'job_posting');
      db.markDone(posting.id, result);
      processed++;
      logger.info('Posting extracted', { posting_id: posting.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.markError(posting.id, message);
      errors++;
      logger.warn('Posting extraction failed', { posting_id: posting.id, error: message });
    }
  }

  logger.info('Batch extraction complete', { processed, errors });
});

// ── GET /extractions ──────────────────────────────────────────────────────────

router.get('/extractions', (req: Request, res: Response): void => {
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  res.json(db.findAllExtractions({ limit, offset }));
});

// ── GET /extractions/:posting_id ──────────────────────────────────────────────

router.get('/extractions/:posting_id', (req: Request, res: Response): void => {
  const row = db.findExtractionByPostingId(req.params.posting_id);
  if (!row) {
    res.status(404).json({ error: 'No extraction found for this posting' });
    return;
  }
  res.json(row);
});

