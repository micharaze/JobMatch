import type { ValidatedMatch, ScoringResult } from '@jobcheck/shared';
import {
  DIMENSION_WEIGHTS,
  EXPERIENCE_WEIGHT,
  MATCH_MULTIPLIERS,
  EXPERIENCE_MATRIX,
  EXPERIENCE_NULL_SCORE,
} from '@jobcheck/shared';

// All skill dimensions (same order as extraction schema)
const SKILL_DIMENSIONS = Object.keys(DIMENSION_WEIGHTS);

// ── Experience level scoring ──────────────────────────────────────────────────

function scoreExperience(
  cvLevel:  string | null,
  jobLevel: string | null,
): number {
  if (!cvLevel || !jobLevel) return EXPERIENCE_NULL_SCORE;
  return EXPERIENCE_MATRIX[cvLevel]?.[jobLevel] ?? EXPERIENCE_NULL_SCORE;
}

// ── Dimension scoring ─────────────────────────────────────────────────────────

interface SkillCounts {
  required:  number;
  preferred: number;
}

/**
 * Score a single dimension.
 *
 * @param matches     Validated matches for this dimension (any match_type).
 * @param totalCounts Total required/preferred skill counts from the job posting extraction.
 */
function scoreDimension(
  matches:     ValidatedMatch[],
  totalCounts: SkillCounts,
): number {
  let matchedRequired  = 0;
  let matchedPreferred = 0;

  for (const m of matches) {
    const multiplier = MATCH_MULTIPLIERS[m.match_type] ?? 0;
    if (multiplier === 0) continue; // uncertain — skip

    if (m.priority === 'required') {
      matchedRequired  += multiplier;
    } else {
      matchedPreferred += multiplier;
    }
  }

  const denominator = Math.max(
    totalCounts.required + 0.5 * totalCounts.preferred,
    1,
  );

  return (matchedRequired + 0.5 * matchedPreferred) / denominator;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface JobSkillCounts {
  [dimension: string]: SkillCounts;
}

/**
 * Calculate the final score for a (posting_id, cv_id) pair.
 *
 * @param postingId   Job posting ID.
 * @param cvId        CV ID.
 * @param matches     All validated matches for the pair.
 * @param jobCounts   Total required/preferred skill counts from the job posting (per dimension).
 * @param cvLevel     Experience level of the CV (from extracted_skills).
 * @param jobLevel    Experience level of the job posting (from extracted_skills).
 */
export function calculateScore(
  postingId: string,
  cvId:      string,
  matches:   ValidatedMatch[],
  jobCounts: JobSkillCounts,
  cvLevel:   string | null,
  jobLevel:  string | null,
): ScoringResult {
  const dimensionScores: Record<string, number> = {};

  // Group matches by dimension for efficient lookup
  const byDimension = new Map<string, ValidatedMatch[]>();
  for (const m of matches) {
    const group = byDimension.get(m.dimension) ?? [];
    group.push(m);
    byDimension.set(m.dimension, group);
  }

  let skillScore = 0;

  for (const dimension of SKILL_DIMENSIONS) {
    const weight      = DIMENSION_WEIGHTS[dimension] ?? 0;
    const dimMatches  = byDimension.get(dimension) ?? [];
    const counts      = jobCounts[dimension] ?? { required: 0, preferred: 0 };
    const dimScore    = scoreDimension(dimMatches, counts);

    dimensionScores[dimension] = dimScore;
    skillScore += dimScore * weight;
  }

  const experienceScore = scoreExperience(cvLevel, jobLevel);
  const finalScore      = skillScore + experienceScore * EXPERIENCE_WEIGHT;

  return {
    posting_id:       postingId,
    cv_id:            cvId,
    final_score:      Math.max(0, Math.min(1, finalScore)),
    dimension_scores: dimensionScores,
    experience_score: experienceScore,
    scored_at:        new Date().toISOString(),
  };
}
