import type { MatchCandidate } from '@jobcheck/shared';
import { SIMILARITY_THRESHOLDS, DEFAULT_TOP_K } from '@jobcheck/shared';
import { embedQueries } from './embedding/client';
import { getPointsByPostingId, searchCvSkills } from './db/lance';
import logger from './logger';

const TOP_K = Number(process.env.MATCHER_TOP_K ?? DEFAULT_TOP_K);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** cosine similarity from LanceDB cosine distance: similarity = 1 - distance */
function distanceToSimilarity(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

// ── Core matching logic ───────────────────────────────────────────────────────

/**
 * Match all job skills from a posting against all CV skills of a specific CV.
 *
 * Steps:
 * 1. Load job skill points from LanceDB (source_type='job_posting').
 * 2. Group by dimension.
 * 3. For each dimension, re-encode skill texts as queries ("query: " prefix) and
 *    run vector search against CV skills in that dimension.
 * 4. Apply per-dimension similarity threshold and keep top-k.
 * 5. Return MatchCandidate[].
 */
export async function matchPostingAgainstCv(
  postingId: string,
  cvId:      string,
): Promise<MatchCandidate[]> {
  // 1. Get all job skill points for this posting
  const jobPoints = await getPointsByPostingId(postingId);
  const jobPostingPoints = jobPoints.filter((p) => p.source_type === 'job_posting');

  if (jobPostingPoints.length === 0) {
    logger.warn('No embedded job skills found for posting', { posting_id: postingId });
    return [];
  }

  // 2. Group by dimension
  const byDimension = new Map<string, typeof jobPostingPoints>();
  for (const point of jobPostingPoints) {
    const existing = byDimension.get(point.dimension) ?? [];
    existing.push(point);
    byDimension.set(point.dimension, existing);
  }

  const candidates: MatchCandidate[] = [];

  // 3. Process each dimension
  for (const [dimension, points] of byDimension) {
    const threshold = SIMILARITY_THRESHOLDS[dimension] ?? 0.80;

    // Embed all job skills in this dimension as queries in a single batch
    const skillTexts = points.map((p) => p.skill);
    let queryVectors: number[][];

    try {
      queryVectors = await embedQueries(skillTexts);
    } catch (err) {
      logger.warn('Failed to embed job skills for dimension', {
        dimension,
        posting_id: postingId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 4. Search for CV candidates for each job skill
    for (let i = 0; i < points.length; i++) {
      const jobPoint    = points[i]!;
      const queryVector = queryVectors[i]!;

      let results: Awaited<ReturnType<typeof searchCvSkills>>;
      try {
        results = await searchCvSkills(queryVector, dimension, cvId, TOP_K);
      } catch (err) {
        logger.warn('Vector search failed', {
          dimension,
          job_skill: jobPoint.skill,
          cv_id: cvId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const result of results) {
        const similarity = distanceToSimilarity(result._distance);

        // Apply dimension-specific threshold
        if (similarity < threshold) continue;

        candidates.push({
          job_skill:   jobPoint.skill,
          cv_skill:    result.skill,
          dimension,
          priority:    jobPoint.priority,
          score:       similarity,
          cv_point_id: result.id,
          posting_id:  postingId,
          cv_id:       cvId,
        });
      }
    }
  }

  logger.info('Matching complete', {
    posting_id: postingId,
    cv_id:      cvId,
    candidates: candidates.length,
  });

  return candidates;
}
