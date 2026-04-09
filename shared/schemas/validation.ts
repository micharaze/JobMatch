// ── Validated match (output of the validator / input to the scorer) ───────────

export type MatchType = 'exact' | 'semantic' | 'uncertain';

export interface ValidatedMatch {
  posting_id: string;
  cv_id:      string;
  job_skill:  string;
  cv_skill:   string;
  dimension:  string;
  priority:   'required' | 'preferred';
  match_type: MatchType;
  confidence: number;   // [0.0, 1.0]
  reasoning:  string;
}
