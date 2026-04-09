import Database from 'better-sqlite3';
import path from 'path';
import type { MatchCandidate, ValidatedMatch } from '@jobcheck/shared';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

// ── Schema ────────────────────────────────────────────────────────────────────

const DDL = `
  CREATE TABLE IF NOT EXISTS validation_runs (
    id             INTEGER PRIMARY KEY,
    posting_id     TEXT NOT NULL,
    cv_id          TEXT NOT NULL,
    status         TEXT CHECK(status IN ('pending','processing','done','error')) DEFAULT 'pending',
    match_count    INTEGER,
    error          TEXT,
    started_at     TEXT,
    completed_at   TEXT,
    UNIQUE(posting_id, cv_id)
  );

  CREATE TABLE IF NOT EXISTS validated_matches (
    id          INTEGER PRIMARY KEY,
    posting_id  TEXT NOT NULL,
    cv_id       TEXT NOT NULL,
    job_skill   TEXT NOT NULL,
    cv_skill    TEXT NOT NULL,
    dimension   TEXT NOT NULL,
    priority    TEXT CHECK(priority IN ('required','preferred')) NOT NULL,
    match_type  TEXT CHECK(match_type IN ('exact','semantic','uncertain')) NOT NULL,
    confidence  REAL NOT NULL,
    reasoning   TEXT NOT NULL,
    validated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_vm_posting_cv ON validated_matches(posting_id, cv_id);
`;

// ── DB singleton ──────────────────────────────────────────────────────────────

class ValidatorDb {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(DDL);
    logger.info('ValidatorDb initialised', { db: DB_PATH });
  }

  // ── validation_runs ─────────────────────────────────────────────────────────

  upsertRun(postingId: string, cvId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO validation_runs (posting_id, cv_id, started_at)
         VALUES (?, ?, ?)`,
      )
      .run(postingId, cvId, new Date().toISOString());
  }

  claimRun(postingId: string, cvId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE validation_runs
         SET status = 'processing', started_at = ?
         WHERE posting_id = ? AND cv_id = ? AND status IN ('pending', 'error')`,
      )
      .run(new Date().toISOString(), postingId, cvId);
    return result.changes > 0;
  }

  saveValidations(postingId: string, cvId: string, matches: ValidatedMatch[]): void {
    const now = new Date().toISOString();

    const insert = this.db.prepare(
      `INSERT INTO validated_matches
         (posting_id, cv_id, job_skill, cv_skill, dimension, priority, match_type, confidence, reasoning, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const updateRun = this.db.prepare(
      `UPDATE validation_runs
       SET status = 'done', match_count = ?, completed_at = ?, error = NULL
       WHERE posting_id = ? AND cv_id = ?`,
    );

    this.db
      .prepare(`DELETE FROM validated_matches WHERE posting_id = ? AND cv_id = ?`)
      .run(postingId, cvId);

    this.db.transaction(() => {
      for (const m of matches) {
        insert.run(
          m.posting_id, m.cv_id,
          m.job_skill, m.cv_skill,
          m.dimension, m.priority,
          m.match_type, m.confidence,
          m.reasoning, now,
        );
      }
      updateRun.run(matches.length, now, postingId, cvId);
    })();
  }

  markError(postingId: string, cvId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE validation_runs
         SET status = 'error', error = ?, completed_at = ?
         WHERE posting_id = ? AND cv_id = ?`,
      )
      .run(error, new Date().toISOString(), postingId, cvId);
  }

  // ── match_candidates (written by matcher) ────────────────────────────────────

  getCandidatesForPair(postingId: string, cvId: string): MatchCandidate[] {
    return this.db
      .prepare(
        `SELECT posting_id, cv_id, job_skill, cv_skill, dimension, priority, score, cv_point_id
         FROM match_candidates
         WHERE posting_id = ? AND cv_id = ?`,
      )
      .all(postingId, cvId) as MatchCandidate[];
  }

  /**
   * Find all completed match pairs that have no validation run yet.
   * Used by process-pending to discover work.
   */
  getPendingMatchPairs(): Array<{ posting_id: string; cv_id: string }> {
    return this.db
      .prepare(
        `SELECT mr.posting_id, mr.cv_id
         FROM match_runs mr
         LEFT JOIN validation_runs vr
           ON mr.posting_id = vr.posting_id AND mr.cv_id = vr.cv_id
         WHERE mr.status = 'done' AND vr.id IS NULL`,
      )
      .all() as Array<{ posting_id: string; cv_id: string }>;
  }

  // ── validated_matches ────────────────────────────────────────────────────────

  getValidations(opts: {
    posting_id?: string;
    cv_id?:      string;
    limit?:      number;
    offset?:     number;
  }): ValidatedMatch[] {
    const conditions: string[] = [];
    const params: unknown[]    = [];

    if (opts.posting_id) { conditions.push('posting_id = ?'); params.push(opts.posting_id); }
    if (opts.cv_id)      { conditions.push('cv_id = ?');      params.push(opts.cv_id); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = Math.min(opts.limit  ?? 200, 1000);
    const offset = opts.offset ?? 0;

    return this.db
      .prepare(
        `SELECT posting_id, cv_id, job_skill, cv_skill, dimension, priority, match_type, confidence, reasoning
         FROM validated_matches ${where}
         ORDER BY confidence DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ValidatedMatch[];
  }

  statusCounts(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as count FROM validation_runs GROUP BY status`)
      .all() as Array<{ status: string; count: number }>;
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }

  close(): void {
    this.db.close();
  }
}

export const db = new ValidatorDb();
