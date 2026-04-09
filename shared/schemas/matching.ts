// ── Match candidate (output of the matcher / input to the validator) ──────────

export interface MatchCandidate {
  job_skill:   string;              // skill text from the job posting
  cv_skill:    string;              // skill text from the CV
  dimension:   string;              // e.g. "programming_languages"
  priority:    'required' | 'preferred';
  score:       number;              // cosine similarity [0.0, 1.0]
  cv_point_id: string;              // LanceDB point ID of the CV skill
  posting_id:  string;              // which job posting this comes from
  cv_id:       string;              // which CV this candidate belongs to
}
