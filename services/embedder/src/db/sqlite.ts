import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ExtractionResult, SkillSet } from '@jobcheck/shared';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  logger.info('SQLite database opened', { path: DB_PATH });
  return db;
}

export interface ExtractedRow {
  posting_id:            string;
  source_type:           'job_posting' | 'cv';
  domain_knowledge:      string;
  programming_languages: string;
  spoken_languages:      string;
  tools:                 string;
  infrastructure:        string;
  project_management:    string;
  soft_skills:           string;
  experience_level:      string | null;
  extracted_at:          string;
  embedding_status:      string;
}

class EmbedderDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
  }

  /** Reset rows stuck in 'processing' from a prior crash. */
  recoverStale(): number {
    try {
      const result = this.db
        .prepare(
          `UPDATE extracted_skills
           SET embedding_status = 'pending'
           WHERE embedding_status = 'processing'`,
        )
        .run();
      if (result.changes > 0) {
        logger.warn('Recovered stale embedding rows', { count: result.changes });
      }
      return result.changes;
    } catch (err) {
      logger.debug('recoverStale skipped — extracted_skills not yet initialised', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /** Claim up to `limit` pending rows for embedding. */
  claimPending(limit = 50): ExtractedRow[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM extracted_skills
           WHERE embedding_status = 'pending'
           ORDER BY extracted_at ASC
           LIMIT ?`,
        )
        .all(limit) as ExtractedRow[];

      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.posting_id);
      const placeholders = ids.map(() => '?').join(', ');
      this.db
        .prepare(
          `UPDATE extracted_skills
           SET embedding_status = 'processing'
           WHERE posting_id IN (${placeholders})`,
        )
        .run(...ids);

      return rows;
    } catch (err) {
      // extracted_skills table doesn't exist yet — extractor hasn't run
      logger.debug('claimPending skipped — extracted_skills not yet initialised', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** Claim a single row by posting_id (must be 'pending'). */
  claimSingle(postingId: string): ExtractedRow | undefined {
    try {
      const row = this.db
        .prepare(`SELECT * FROM extracted_skills WHERE posting_id = ?`)
        .get(postingId) as ExtractedRow | undefined;

      if (!row || row.embedding_status !== 'pending') return undefined;

      this.db
        .prepare(
          `UPDATE extracted_skills
           SET embedding_status = 'processing'
           WHERE posting_id = ?`,
        )
        .run(postingId);

      return row;
    } catch (err) {
      logger.debug('claimSingle skipped — extracted_skills not yet initialised', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /** Mark embedding as done. */
  markDone(postingId: string): void {
    this.db
      .prepare(
        `UPDATE extracted_skills SET embedding_status = 'done' WHERE posting_id = ?`,
      )
      .run(postingId);
  }

  /** Mark embedding as failed. */
  markError(postingId: string, error: string): void {
    logger.error('Embedding failed for posting', { postingId, error });
    this.db
      .prepare(
        `UPDATE extracted_skills SET embedding_status = 'error' WHERE posting_id = ?`,
      )
      .run(postingId);
  }

  /** Count rows by embedding_status. */
  statusCounts(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT embedding_status, COUNT(*) as count
         FROM extracted_skills
         GROUP BY embedding_status`,
      )
      .all() as { embedding_status: string; count: number }[];
    return Object.fromEntries(rows.map((r) => [r.embedding_status, r.count]));
  }

  close(): void {
    this.db.close();
  }
}

function parseSkillSet(json: string): SkillSet {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'required' in parsed &&
      'preferred' in parsed
    ) {
      return parsed as SkillSet;
    }
  } catch { /* fall through */ }
  return { required: [], preferred: [] };
}

export function deserializeRow(row: ExtractedRow): ExtractionResult {
  return {
    source_type:           row.source_type,
    domain_knowledge:      parseSkillSet(row.domain_knowledge),
    programming_languages: parseSkillSet(row.programming_languages),
    tools:                 parseSkillSet(row.tools),
    infrastructure:        parseSkillSet(row.infrastructure),
    project_management:    parseSkillSet(row.project_management),
    spoken_languages:      parseSkillSet(row.spoken_languages),
    soft_skills:           parseSkillSet(row.soft_skills),
    experience_level:      (row.experience_level ?? null) as ExtractionResult['experience_level'],
  };
}

export const db = new EmbedderDb();
