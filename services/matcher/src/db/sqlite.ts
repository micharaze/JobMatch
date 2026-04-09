import Database from 'better-sqlite3';
import path from 'path';
import type { MatchCandidate } from '@jobcheck/shared';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

// ── Schema ────────────────────────────────────────────────────────────────────

const CREATE_MATCH_RUNS = `
  CREATE TABLE IF NOT EXISTS match_runs (
    id             INTEGER PRIMARY KEY,
    posting_id     TEXT NOT NULL,
    cv_id          TEXT NOT NULL,
    status         TEXT CHECK(status IN ('pending','processing','done','error')) DEFAULT 'pending',
    candidate_count INTEGER,
    error          TEXT,
    started_at     TEXT,
    completed_at   TEXT,
    UNIQUE(posting_id, cv_id)
  )
`;

const CREATE_MATCH_CANDIDATES = `
  CREATE TABLE IF NOT EXISTS match_candidates (
    id          INTEGER PRIMARY KEY,
    posting_id  TEXT NOT NULL,
    cv_id       TEXT NOT NULL,
    job_skill   TEXT NOT NULL,
    cv_skill    TEXT NOT NULL,
    dimension   TEXT NOT NULL,
    priority    TEXT CHECK(priority IN ('required','preferred')) NOT NULL,
    score       REAL NOT NULL,
    cv_point_id TEXT NOT NULL,
    matched_at  TEXT NOT NULL
  )
`;

const CREATE_IDX_MC = `
  CREATE INDEX IF NOT EXISTS idx_mc_posting_cv ON match_candidates(posting_id, cv_id)
`;

// ── DB singleton ──────────────────────────────────────────────────────────────

class MatcherDb {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_MATCH_RUNS);
    this.db.exec(CREATE_MATCH_CANDIDATES);
    this.db.exec(CREATE_IDX_MC);
    logger.info('MatcherDb initialised', { db: DB_PATH });
  }

  // ── match_runs ──────────────────────────────────────────────────────────────

  /** Register a (posting_id × cv_id) pair — no-op if it already exists. */
  upsertRun(postingId: string, cvId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO match_runs (posting_id, cv_id, started_at)
         VALUES (?, ?, ?)`,
      )
      .run(postingId, cvId, new Date().toISOString());
  }

  /**
   * Atomically claim a run for processing.
   * Returns false if the run is already processing or done.
   */
  claimRun(postingId: string, cvId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE match_runs
         SET status = 'processing', started_at = ?
         WHERE posting_id = ? AND cv_id = ? AND status IN ('pending', 'error')`,
      )
      .run(new Date().toISOString(), postingId, cvId);
    return result.changes > 0;
  }

  /** Store candidates and mark the run as done. */
  saveCandidates(postingId: string, cvId: string, candidates: MatchCandidate[]): void {
    const now = new Date().toISOString();

    const insertCandidate = this.db.prepare(
      `INSERT INTO match_candidates
         (posting_id, cv_id, job_skill, cv_skill, dimension, priority, score, cv_point_id, matched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const updateRun = this.db.prepare(
      `UPDATE match_runs
       SET status = 'done', candidate_count = ?, completed_at = ?, error = NULL
       WHERE posting_id = ? AND cv_id = ?`,
    );

    // Delete previous candidates for this pair before inserting fresh ones
    this.db
      .prepare(`DELETE FROM match_candidates WHERE posting_id = ? AND cv_id = ?`)
      .run(postingId, cvId);

    const transaction = this.db.transaction(() => {
      for (const c of candidates) {
        insertCandidate.run(
          c.posting_id, c.cv_id,
          c.job_skill, c.cv_skill,
          c.dimension, c.priority,
          c.score, c.cv_point_id,
          now,
        );
      }
      updateRun.run(candidates.length, now, postingId, cvId);
    });

    transaction();
  }

  /** Mark a run as failed. */
  markError(postingId: string, cvId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE match_runs
         SET status = 'error', error = ?, completed_at = ?
         WHERE posting_id = ? AND cv_id = ?`,
      )
      .run(error, new Date().toISOString(), postingId, cvId);
  }

  // ── match_candidates ────────────────────────────────────────────────────────

  /** Fetch candidates, optionally filtered by posting_id and/or cv_id. */
  getCandidates(opts: {
    posting_id?: string;
    cv_id?:      string;
    limit?:      number;
    offset?:     number;
  }): MatchCandidate[] {
    const conditions: string[] = [];
    const params: unknown[]    = [];

    if (opts.posting_id) { conditions.push('posting_id = ?'); params.push(opts.posting_id); }
    if (opts.cv_id)      { conditions.push('cv_id = ?');      params.push(opts.cv_id); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = Math.min(opts.limit  ?? 200, 1000);
    const offset = opts.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT posting_id, cv_id, job_skill, cv_skill, dimension, priority, score, cv_point_id
         FROM match_candidates ${where}
         ORDER BY score DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as MatchCandidate[];

    return rows;
  }

  /** Run status counts. */
  statusCounts(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as count FROM match_runs GROUP BY status`)
      .all() as Array<{ status: string; count: number }>;

    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }

  /**
   * Return all CV IDs (posting_ids from extracted_skills with source_type='cv'
   * and embedding_status='done').
   */
  getEmbeddedCvIds(): string[] {
    const rows = this.db
      .prepare(
        `SELECT posting_id FROM extracted_skills
         WHERE source_type = 'cv' AND embedding_status = 'done'`,
      )
      .all() as Array<{ posting_id: string }>;
    return rows.map((r) => r.posting_id);
  }

  close(): void {
    this.db.close();
  }
}

export const db = new MatcherDb();
