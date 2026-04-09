import Database from 'better-sqlite3';
import path from 'path';
import type { ValidatedMatch, ScoringResult } from '@jobcheck/shared';
import type { JobSkillCounts } from '../scorer';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

// ── Schema ────────────────────────────────────────────────────────────────────

const DDL = `
  CREATE TABLE IF NOT EXISTS scores (
    id               INTEGER PRIMARY KEY,
    posting_id       TEXT NOT NULL,
    cv_id            TEXT NOT NULL,
    final_score      REAL NOT NULL,
    dimension_scores TEXT NOT NULL,
    experience_score REAL NOT NULL,
    scored_at        TEXT NOT NULL,
    UNIQUE(posting_id, cv_id)
  );

  CREATE INDEX IF NOT EXISTS idx_scores_posting ON scores(posting_id, final_score DESC);
`;

// ── DB singleton ──────────────────────────────────────────────────────────────

class ScorerDb {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(DDL);
    logger.info('ScorerDb initialised', { db: DB_PATH });
  }

  // ── validated_matches (written by validator) ──────────────────────────────

  getValidatedMatches(postingId: string, cvId: string): ValidatedMatch[] {
    return this.db
      .prepare(
        `SELECT posting_id, cv_id, job_skill, cv_skill, dimension, priority, match_type, confidence, reasoning
         FROM validated_matches
         WHERE posting_id = ? AND cv_id = ?`,
      )
      .all(postingId, cvId) as ValidatedMatch[];
  }

  /**
   * Find all validated pairs that have no score yet.
   */
  getPendingValidationPairs(): Array<{ posting_id: string; cv_id: string }> {
    return this.db
      .prepare(
        `SELECT vr.posting_id, vr.cv_id
         FROM validation_runs vr
         LEFT JOIN scores s ON vr.posting_id = s.posting_id AND vr.cv_id = s.cv_id
         WHERE vr.status = 'done' AND s.posting_id IS NULL`,
      )
      .all() as Array<{ posting_id: string; cv_id: string }>;
  }

  // ── extracted_skills (written by extractor) ───────────────────────────────

  /**
   * Return total required/preferred skill counts per dimension for a job posting.
   * Used as the denominator in the scoring formula.
   */
  getJobSkillCounts(postingId: string): JobSkillCounts {
    const row = this.db
      .prepare(`SELECT * FROM extracted_skills WHERE posting_id = ?`)
      .get(postingId) as Record<string, string> | undefined;

    if (!row) return {};

    const dimensions = [
      'domain_knowledge', 'programming_languages', 'tools',
      'infrastructure', 'project_management', 'spoken_languages', 'soft_skills',
    ];

    const counts: JobSkillCounts = {};
    for (const dim of dimensions) {
      try {
        const parsed = JSON.parse(row[dim] ?? '{"required":[],"preferred":[]}') as {
          required: string[];
          preferred: string[];
        };
        counts[dim] = {
          required:  parsed.required.length,
          preferred: parsed.preferred.length,
        };
      } catch {
        counts[dim] = { required: 0, preferred: 0 };
      }
    }
    return counts;
  }

  /** Return the experience_level for a posting_id (works for both job postings and CVs). */
  getExperienceLevel(postingId: string): string | null {
    const row = this.db
      .prepare(`SELECT experience_level FROM extracted_skills WHERE posting_id = ?`)
      .get(postingId) as { experience_level: string | null } | undefined;
    return row?.experience_level ?? null;
  }

  // ── scores ────────────────────────────────────────────────────────────────

  saveScore(result: ScoringResult): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO scores
           (posting_id, cv_id, final_score, dimension_scores, experience_score, scored_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.posting_id,
        result.cv_id,
        result.final_score,
        JSON.stringify(result.dimension_scores),
        result.experience_score,
        result.scored_at,
      );
  }

  getScores(opts: {
    posting_id?: string;
    cv_id?:      string;
    limit?:      number;
    offset?:     number;
  }): ScoringResult[] {
    const conditions: string[] = [];
    const params: unknown[]    = [];

    if (opts.posting_id) { conditions.push('posting_id = ?'); params.push(opts.posting_id); }
    if (opts.cv_id)      { conditions.push('cv_id = ?');      params.push(opts.cv_id); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = Math.min(opts.limit  ?? 100, 1000);
    const offset = opts.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT posting_id, cv_id, final_score, dimension_scores, experience_score, scored_at
         FROM scores ${where}
         ORDER BY final_score DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Omit<ScoringResult, 'dimension_scores'> & { dimension_scores: string }>;

    return rows.map((r) => ({
      ...r,
      dimension_scores: JSON.parse(r.dimension_scores) as Record<string, number>,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export const db = new ScorerDb();
