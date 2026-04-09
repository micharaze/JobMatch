// ── Per-dimension minimum cosine similarity thresholds ───────────────────────
// Source of truth — import from here, never hardcode in service logic.

export const SIMILARITY_THRESHOLDS: Record<string, number> = {
  programming_languages: 0.92,
  tools:                 0.90,
  infrastructure:        0.88,
  project_management:    0.85,
  domain_knowledge:      0.82,
  spoken_languages:      0.95,
  soft_skills:           0.75,
};

// Default top-k candidates per job skill forwarded to the validator.
// Overridable via MATCHER_TOP_K env var.
export const DEFAULT_TOP_K = 5;
