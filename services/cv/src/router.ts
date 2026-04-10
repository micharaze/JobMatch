import { Router, Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db/sqlite';
import { extractText, isSupportedMimeType } from './parser';
import logger from './logger';

export const router = Router();

const NORMALIZER_URL = process.env.NORMALIZER_URL ?? 'http://localhost:3002';

// Store uploads in memory — CVs are typically < 1MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── POST /cvs ─────────────────────────────────────────────────────────────────

router.post('/cvs', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
    return;
  }

  const mimeType = req.file.mimetype;
  if (!isSupportedMimeType(mimeType)) {
    res.status(400).json({
      error: `Unsupported file type: ${mimeType}`,
      supported: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
    });
    return;
  }

  let text: string;
  try {
    text = await extractText(req.file.buffer, mimeType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('CV text extraction failed', { filename: req.file.originalname, error: message });
    res.status(422).json({ error: 'Could not extract text from file', detail: message });
    return;
  }

  if (text.length < 50) {
    res.status(422).json({ error: 'File appears to be empty or contains no readable text' });
    return;
  }

  const cvId        = `cv:${uuidv4()}`;
  const uploadedAt  = new Date().toISOString();

  db.insert({
    id:            cvId,
    original_name: req.file.originalname,
    mime_type:     mimeType,
    text,
    uploaded_at:   uploadedAt,
  });

  logger.info('CV stored', { cv_id: cvId, filename: req.file.originalname, chars: text.length });

  // Respond immediately — extraction runs in background
  res.status(202).json({
    cv_id:             cvId,
    original_name:     req.file.originalname,
    extraction_status: 'pending',
    uploaded_at:       uploadedAt,
  });

  // Trigger normalization asynchronously after response is sent
  triggerNormalization(cvId);
});

async function triggerNormalization(cvId: string): Promise<void> {
  db.markProcessing(cvId);
  try {
    await axios.post(
      `${NORMALIZER_URL}/normalize-cv`,
      { cv_id: cvId },
      { timeout: 120_000 },
    );
    db.markDone(cvId);
    logger.info('CV normalization complete', { cv_id: cvId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.markError(cvId, message);
    logger.warn('CV normalization failed', { cv_id: cvId, error: message });
  }
}

// ── GET /cvs ──────────────────────────────────────────────────────────────────

router.get('/cvs', (req: Request, res: Response): void => {
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  // Return without the full text to keep the list response lean
  res.json(db.findAll({ limit, offset }));
});

// ── GET /cvs/:id ──────────────────────────────────────────────────────────────

router.get('/cvs/:id', (req: Request, res: Response): void => {
  const cv = db.findById(req.params.id!);
  if (!cv) {
    res.status(404).json({ error: 'CV not found' });
    return;
  }
  // Omit the raw text from the detail view too — callers rarely need it
  const { text: _text, ...meta } = cv;
  res.json(meta);
});

// ── DELETE /cvs/:id ───────────────────────────────────────────────────────────

router.delete('/cvs/:id', (req: Request, res: Response): void => {
  const deleted = db.delete(req.params.id!);
  if (!deleted) {
    res.status(404).json({ error: 'CV not found' });
    return;
  }
  logger.info('CV deleted', { cv_id: req.params.id });
  res.json({ ok: true, cv_id: req.params.id });
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});
