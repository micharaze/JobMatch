import { Router } from 'express';
import type { ExtractionResult, FlatSkill, EmbeddedSkillPoint } from '@jobcheck/shared';
import { db, deserializeRow, type ExtractedRow } from './db/sqlite';
import { ensureTable, upsertPoints, getPointsByPostingId, pointId } from './db/lance';
import { embedSkills } from './embedding/embedder';
import logger from './logger';

export const router = Router();

const SKILL_DIMENSIONS: (keyof Omit<ExtractionResult, 'source_type' | 'experience_level'>)[] = [
  'domain_knowledge',
  'programming_languages',
  'tools',
  'infrastructure',
  'project_management',
  'spoken_languages',
  'soft_skills',
];

/** Flatten all skills from an ExtractionResult into FlatSkill entries. */
function flattenSkills(result: ExtractionResult): FlatSkill[] {
  const flat: FlatSkill[] = [];
  for (const dim of SKILL_DIMENSIONS) {
    const skillSet = result[dim];
    for (const skill of skillSet.required) {
      flat.push({ skill, dimension: dim, priority: 'required' });
    }
    for (const skill of skillSet.preferred) {
      flat.push({ skill, dimension: dim, priority: 'preferred' });
    }
  }
  return flat;
}

/** Embed one extracted row and upsert into LanceDB. */
async function embedRow(row: ExtractedRow): Promise<number> {
  const result     = deserializeRow(row);
  const flatSkills = flattenSkills(result);

  if (flatSkills.length === 0) {
    db.markDone(row.posting_id);
    return 0;
  }

  const skillTexts = flatSkills.map((s) => s.skill);
  const vectors    = await embedSkills(skillTexts);

  const points: EmbeddedSkillPoint[] = flatSkills.map((s, i) => ({
    id:          pointId(row.posting_id, s),
    posting_id:  row.posting_id,
    source_type: row.source_type,
    dimension:   s.dimension,
    priority:    s.priority,
    skill:       s.skill,
    vector:      vectors[i]!,
  }));

  await upsertPoints(points);
  db.markDone(row.posting_id);

  logger.info('Embedded posting', { posting_id: row.posting_id, points: points.length });
  return points.length;
}

// ── POST /embed ───────────────────────────────────────────────────────────────

router.post('/embed', async (req, res) => {
  const { posting_id } = req.body as { posting_id?: string };
  if (!posting_id) {
    res.status(400).json({ error: 'posting_id required' });
    return;
  }

  const row = db.claimSingle(posting_id);
  if (!row) {
    res.status(409).json({ error: 'Posting not found or not in pending state', posting_id });
    return;
  }

  try {
    await ensureTable();
    const count = await embedRow(row);
    res.json({ ok: true, posting_id, points_upserted: count });
  } catch (err) {
    db.markError(posting_id, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Embedding failed', detail: String(err) });
  }
});

// ── POST /process-pending ─────────────────────────────────────────────────────

router.post('/process-pending', (_req, res) => {
  res.json({ ok: true, message: 'Batch embedding starting in background' });

  setImmediate(async () => {
    logger.info('Batch embedding starting');
    try {
      await ensureTable();
      const rows = db.claimPending();
      logger.info('Claimed pending rows for embedding', { count: rows.length });

      let total = 0;
      for (const row of rows) {
        try {
          total += await embedRow(row);
        } catch (err) {
          db.markError(row.posting_id, err instanceof Error ? err.message : String(err));
        }
      }
      logger.info('Batch embedding complete', { postings: rows.length, points: total });
    } catch (err) {
      logger.error('Batch embedding failed', { error: err instanceof Error ? err.message : String(err) });
    }
  });
});

// ── GET /embeddings/:posting_id ───────────────────────────────────────────────

router.get('/embeddings/:posting_id', async (req, res) => {
  try {
    const points = await getPointsByPostingId(req.params.posting_id!);
    res.json({ posting_id: req.params.posting_id, count: points.length, points });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch embeddings', detail: String(err) });
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────

router.get('/status', (_req, res) => {
  try {
    res.json(db.statusCounts());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
