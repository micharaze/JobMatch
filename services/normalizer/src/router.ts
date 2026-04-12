import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db/sqlite';
import { normalize } from './llm/normalizer';
import logger from './logger';

export const router = Router();

// ── POST /normalize ───────────────────────────────────────────────────────────

router.post('/normalize', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ posting_id: z.string().min(1) }).safeParse(req.body);
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

  const claimed = db.claimPosting(posting_id);
  if (!claimed) {
    res.status(409).json({ error: 'Posting is already being normalized or is done' });
    return;
  }

  try {
    const normalizedText = await normalize(posting.text, 'job_posting');
    db.markPostingDone(posting_id, normalizedText);
    logger.info('Job posting normalized', { posting_id });
    res.json({ ok: true, posting_id, normalized_text: normalizedText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.markPostingError(posting_id, message);
    res.status(500).json({ error: message });
  }
});

// ── POST /normalize-cv ────────────────────────────────────────────────────────

router.post('/normalize-cv', async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ cv_id: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { cv_id } = parsed.data;

  const cv = db.findCvById(cv_id);
  if (!cv) {
    res.status(404).json({ error: 'CV not found' });
    return;
  }

  const claimed = db.claimCv(cv_id);
  if (!claimed) {
    res.status(409).json({ error: 'CV is already being normalized or is done' });
    return;
  }

  try {
    const normalizedText = await normalize(cv.text, 'cv');
    db.markCvDone(cv_id, normalizedText);
    logger.info('CV normalized', { cv_id });
    res.json({ ok: true, cv_id, normalized_text: normalizedText });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.markCvError(cv_id, message);
    res.status(500).json({ error: message });
  }
});

// ── POST /process-pending ─────────────────────────────────────────────────────

const ProcessPendingSchema = z.object({ limit: z.number().int().min(1).max(200).optional() });

router.post('/process-pending', async (req: Request, res: Response): Promise<void> => {
  const parsed = ProcessPendingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const limit = parsed.data.limit ?? 50;
  const postings = db.claimPendingPostings(limit);

  logger.info('process-pending started', { claimed: postings.length });
  res.json({ claimed: postings.length, message: 'Normalization started in background' });

  // Process in background after response is sent
  setImmediate(async () => {
    let done = 0;
    let errors = 0;
    for (const posting of postings) {
      try {
        const normalizedText = await normalize(posting.text, 'job_posting');
        db.markPostingDone(posting.id, normalizedText);
        done++;
        logger.info('Posting normalized', { posting_id: posting.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.markPostingError(posting.id, message);
        errors++;
        logger.warn('Normalization failed', { posting_id: posting.id, error: message });
      }
    }
    logger.info('process-pending complete', { done, errors });
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

// ── GET /status ───────────────────────────────────────────────────────────────

router.get('/status', (_req: Request, res: Response): void => {
  const provider = (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'gemini';
  const isOllama = provider === 'ollama';
  res.json({
    provider,
    model: isOllama
      ? (process.env.NORMALIZER_MODEL ?? process.env.GEMMA_MODEL ?? 'gemma4:e4b')
      : (process.env.NORMALIZER_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'),
    hasApiKey: isOllama || !!(process.env.GEMINI_API_KEY),
  });
});

// ── GET /stats ────────────────────────────────────────────────────────────────

router.get('/stats', (_req: Request, res: Response): void => {
  res.json(db.getPostingStats());
});

// ── GET /llm-ping ─────────────────────────────────────────────────────────────

router.get('/llm-ping', async (_req: Request, res: Response): Promise<void> => {
  const provider = (process.env.LLM_PROVIDER ?? 'ollama') as 'ollama' | 'gemini';
  const model = provider === 'ollama'
    ? (process.env.NORMALIZER_MODEL ?? process.env.GEMMA_MODEL ?? 'gemma4:e4b')
    : (process.env.NORMALIZER_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.0-flash');

  if (provider === 'gemini') {
    const hasKey = !!(process.env.GEMINI_API_KEY);
    res.json({ ok: hasKey, provider, model, status: hasKey ? 'ready' : 'no_api_key' });
    return;
  }

  const baseUrl = process.env.GEMMA_BASE_URL ?? 'http://localhost:11434/v1';
  const ollamaUrl = baseUrl.replace(/\/v1\/?$/, '');
  try {
    const modelShort = model.split(':')[0];
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null),
      fetch(`${ollamaUrl}/api/ps`,   { signal: AbortSignal.timeout(3000) }).catch(() => null),
    ]);

    if (!tagsRes?.ok) {
      res.json({ ok: false, provider, model, status: 'unreachable' });
      return;
    }

    const tagsData = await tagsRes.json() as { models?: Array<{ name: string }> };
    const installed = tagsData.models?.some((m) => m.name.startsWith(modelShort)) ?? false;

    let loaded = false;
    if (psRes?.ok) {
      const psData = await psRes.json() as { models?: Array<{ name: string }> };
      loaded = psData.models?.some((m) => m.name.startsWith(modelShort)) ?? false;
    }

    const status = !installed ? 'not_installed' : loaded ? 'loaded' : 'installed';
    res.json({ ok: installed, provider, model, status });
  } catch (err) {
    res.json({ ok: false, provider, model, status: 'unreachable', error: String(err) });
  }
});
