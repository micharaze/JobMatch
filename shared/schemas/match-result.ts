export interface MatchResult {
  posting_id:      string;
  cv_id:           string;
  score:           number;    // 0–100
  summary:         string;
  matched_skills:  string[];
  missing_skills:  string[];
  adjacent_skills: string[];  // e.g. "Vue.js → Angular: related but different framework"
  model:           string;
  matched_at:      string;
}
