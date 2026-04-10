import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { MatchResult } from '@jobcheck/shared';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

const DDL = `
  CREATE TABLE IF NOT EXISTS match_results (
    id              INTEGER PRIMARY KEY,
    posting_id      TEXT NOT NULL,
    cv_id           TEXT NOT NULL,
    score           INTEGER NOT NULL,
    summary         TEXT NOT NULL,
    matched_skills  TEXT NOT NULL DEFAULT '[]',
    missing_skills  TEXT NOT NULL DEFAULT '[]',
    adjacent_skills TEXT NOT NULL DEFAULT '[]',
    model           TEXT NOT NULL,
    matched_at      TEXT NOT NULL,
    UNIQUE(posting_id, cv_id)
  );

  CREATE INDEX IF NOT EXISTS idx_match_results_posting
    ON match_results(posting_id, score DESC);
`;

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(DDL);
  logger.info('MatcherDb opened', { path: DB_PATH });
  return db;
}

export interface NormalizedPosting {
  id:              string;
  title:           string;
  company:         string;
  normalized_text: string;
}

export interface NormalizedCv {
  id:              string;
  normalized_text: string;
}

class MatcherDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
  }

  // ── Reads from normalizer-managed columns ────────────────────────────────────

  findNormalizedPosting(id: string): NormalizedPosting | undefined {
    return this.db
      .prepare(
        `SELECT id, title, company, normalized_text
         FROM job_postings
         WHERE id = ? AND normalization_status = 'done'`,
      )
      .get(id) as NormalizedPosting | undefined;
  }

  findNormalizedCv(id: string): NormalizedCv | undefined {
    return this.db
      .prepare(`SELECT id, normalized_text FROM cvs WHERE id = ? AND normalization_status = 'done'`)
      .get(id) as NormalizedCv | undefined;
  }

  getAllNormalizedCvIds(): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM cvs WHERE normalization_status = 'done'`)
      .all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /**
   * Find all (posting_id, cv_id) pairs where both are normalized but no match result exists yet.
   */
  getPendingPairs(): Array<{ posting_id: string; cv_id: string }> {
    return this.db
      .prepare(
        `SELECT jp.id AS posting_id, c.id AS cv_id
         FROM job_postings jp
         CROSS JOIN cvs c
         LEFT JOIN match_results mr ON mr.posting_id = jp.id AND mr.cv_id = c.id
         WHERE jp.normalization_status = 'done'
           AND c.normalization_status  = 'done'
           AND mr.id IS NULL`,
      )
      .all() as Array<{ posting_id: string; cv_id: string }>;
  }

  // ── match_results ─────────────────────────────────────────────────────────────

  upsertMatchResult(result: MatchResult): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO match_results
           (posting_id, cv_id, score, summary, matched_skills, missing_skills, adjacent_skills, model, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.posting_id,
        result.cv_id,
        result.score,
        result.summary,
        JSON.stringify(result.matched_skills),
        JSON.stringify(result.missing_skills),
        JSON.stringify(result.adjacent_skills),
        result.model,
        result.matched_at,
      );
  }

  findMatches(opts: {
    posting_id?: string;
    cv_id?:      string;
    limit?:      number;
    offset?:     number;
  }): MatchResult[] {
    const conditions: string[] = [];
    const params:     unknown[] = [];

    if (opts.posting_id) { conditions.push('posting_id = ?'); params.push(opts.posting_id); }
    if (opts.cv_id)      { conditions.push('cv_id = ?');      params.push(opts.cv_id);      }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = Math.min(opts.limit  ?? 100, 1000);
    const offset = opts.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT posting_id, cv_id, score, summary,
                matched_skills, missing_skills, adjacent_skills, model, matched_at
         FROM match_results ${where}
         ORDER BY score DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<MatchResult & { matched_skills: string; missing_skills: string; adjacent_skills: string }>;

    return rows.map(deserialize);
  }

  findMatchByPair(postingId: string, cvId: string): MatchResult | undefined {
    const rows = this.findMatches({ posting_id: postingId, cv_id: cvId, limit: 1 });
    return rows[0];
  }

  close(): void {
    this.db.close();
  }
}

function deserialize(
  row: MatchResult & { matched_skills: string; missing_skills: string; adjacent_skills: string },
): MatchResult {
  return {
    ...row,
    matched_skills:  parseJsonArray(row.matched_skills),
    missing_skills:  parseJsonArray(row.missing_skills),
    adjacent_skills: parseJsonArray(row.adjacent_skills),
  };
}

function parseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export const db = new MatcherDb();
