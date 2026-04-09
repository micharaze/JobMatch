// ── Score result (output of the scorer) ──────────────────────────────────────

export interface ScoringResult {
  posting_id:       string;
  cv_id:            string;
  final_score:      number;            // [0.0, 1.0]
  dimension_scores: Record<string, number>;  // per-dimension [0.0, 1.0]
  experience_score: number;            // [0.0, 1.0]
  scored_at:        string;            // ISO 8601
}
