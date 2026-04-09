// ── Flat skill descriptor (before embedding) ──────────────────────────────────

export interface FlatSkill {
  skill:     string;
  dimension: string;
  priority:  'required' | 'preferred';
}

// ── Embedded skill point (a single vector in Qdrant) ─────────────────────────

export interface EmbeddedSkillPoint {
  id:          string;              // deterministic hash: SHA-256(posting_id:dimension:priority:skill)
  posting_id:  string;
  source_type: 'job_posting' | 'cv';
  dimension:   string;              // e.g. "programming_languages"
  priority:    'required' | 'preferred';
  skill:       string;              // original skill text, un-prefixed
  vector:      number[];
}
