// ── Scoring weights — source of truth ────────────────────────────────────────
// Dimensions sum to 0.90; experience_level contributes the remaining 0.10.

export const DIMENSION_WEIGHTS: Record<string, number> = {
  domain_knowledge:      0.28,
  programming_languages: 0.22,
  infrastructure:        0.15,
  tools:                 0.10,
  project_management:    0.08,
  soft_skills:           0.05,
  spoken_languages:      0.02,
};

export const EXPERIENCE_WEIGHT = 0.10;

// ── Match type multipliers ────────────────────────────────────────────────────

export const MATCH_MULTIPLIERS: Record<string, number> = {
  exact:     1.0,
  semantic:  0.6,
  uncertain: 0.0,
};

// ── Experience level compatibility matrix (cv_level → job_level → score) ─────

export const EXPERIENCE_MATRIX: Record<string, Record<string, number>> = {
  junior: { junior: 1.0, mid: 0.3, senior: 0.0, lead: 0.0 },
  mid:    { junior: 1.0, mid: 1.0, senior: 0.4, lead: 0.2 },
  senior: { junior: 0.8, mid: 1.0, senior: 1.0, lead: 0.6 },
  lead:   { junior: 0.5, mid: 0.8, senior: 1.0, lead: 1.0 },
};

// If either side is null, use this neutral score (neither bonus nor penalty).
export const EXPERIENCE_NULL_SCORE = 0.5;
