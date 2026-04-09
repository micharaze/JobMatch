import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { ExtractedSkillRow, ExtractionResult, SkillSet } from '@jobcheck/shared';
import logger from '../logger';

// Resolve relative to this file so it works regardless of cwd (e.g. npm run dev)
const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

const EMPTY_SKILL_SET = '{"required":[],"preferred":[]}';

const DDL = `
  CREATE TABLE IF NOT EXISTS extracted_skills (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    posting_id            TEXT NOT NULL UNIQUE,
    source_type           TEXT NOT NULL CHECK(source_type IN ('job_posting', 'cv')),
    domain_knowledge      TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    programming_languages TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    spoken_languages      TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    tools                 TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    infrastructure        TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    project_management    TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    soft_skills           TEXT NOT NULL DEFAULT '${EMPTY_SKILL_SET}',
    experience_level      TEXT,
    extracted_at          TEXT NOT NULL,
    embedding_status      TEXT NOT NULL DEFAULT 'pending'
  );
`;

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.exec(DDL);
  logger.info('SQLite database opened', { path: DB_PATH });
  return instance;
}

export interface PendingPosting {
  id: string;
  description: string;
}

export type ExtractionRow = ExtractionResult & { posting_id: string; extracted_at: string };

class ExtractorDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
  }

  /**
   * On startup: reset rows stuck in 'processing' from a prior crash.
   * Call once before the background interval starts.
   */
  recoverStale(): number {
    try {
      const result = this.db
        .prepare(
          `UPDATE job_postings
           SET extraction_status = 'pending'
           WHERE extraction_status = 'processing'`,
        )
        .run();
      if (result.changes > 0) {
        logger.warn('Recovered stale processing rows', { count: result.changes });
      }
      return result.changes;
    } catch (err) {
      // job_postings table doesn't exist yet (scraper hasn't run) — safe to ignore
      logger.debug('recoverStale skipped — job_postings not yet initialised', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * Claim up to `limit` pending postings by setting them to 'processing'.
   * better-sqlite3 is synchronous — no async gap between SELECT and UPDATE.
   */
  claimPending(limit = 50): PendingPosting[] {
    const rows = this.db
      .prepare(
        `SELECT id, description
         FROM job_postings
         WHERE extraction_status = 'pending'
         ORDER BY scraped_at ASC
         LIMIT ?`,
      )
      .all(limit) as PendingPosting[];

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE job_postings
         SET extraction_status = 'processing'
         WHERE id IN (${placeholders})`,
      )
      .run(...ids);

    return rows;
  }

  /** Fetch a single posting for on-demand extraction. */
  findPostingById(id: string): PendingPosting | undefined {
    return this.db
      .prepare(`SELECT id, description FROM job_postings WHERE id = ?`)
      .get(id) as PendingPosting | undefined;
  }

  /**
   * Claim a single posting for extraction. Returns false if the posting is
   * not in 'pending' state (already processing, done, or error).
   */
  claimSingle(postingId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE job_postings
         SET extraction_status = 'processing'
         WHERE id = ? AND extraction_status = 'pending'`,
      )
      .run(postingId);
    return result.changes > 0;
  }

  /** Write extraction result and mark posting as done. */
  markDone(postingId: string, result: ExtractionResult): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO extracted_skills
           (posting_id, source_type,
            domain_knowledge, programming_languages, spoken_languages,
            tools, infrastructure, project_management, soft_skills,
            experience_level, extracted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        postingId,
        result.source_type,
        JSON.stringify(result.domain_knowledge),
        JSON.stringify(result.programming_languages),
        JSON.stringify(result.spoken_languages),
        JSON.stringify(result.tools),
        JSON.stringify(result.infrastructure),
        JSON.stringify(result.project_management),
        JSON.stringify(result.soft_skills),
        result.experience_level ?? null,
        now,
      );

    this.db
      .prepare(`UPDATE job_postings SET extraction_status = 'done' WHERE id = ?`)
      .run(postingId);
  }

  /** Mark extraction as failed. */
  markError(postingId: string, error: string): void {
    logger.error('Extraction failed for posting', { postingId, error });
    this.db
      .prepare(`UPDATE job_postings SET extraction_status = 'error' WHERE id = ?`)
      .run(postingId);
  }

  findAllExtractions(opts: { limit?: number; offset?: number } = {}): ExtractionRow[] {
    const { limit = 50, offset = 0 } = opts;
    const rows = this.db
      .prepare(
        `SELECT * FROM extracted_skills
         ORDER BY extracted_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as ExtractedSkillRow[];
    return rows.map(deserialize);
  }

  findExtractionByPostingId(postingId: string): ExtractionRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM extracted_skills WHERE posting_id = ?`)
      .get(postingId) as ExtractedSkillRow | undefined;
    return row ? deserialize(row) : undefined;
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

function deserialize(row: ExtractedSkillRow): ExtractionRow {
  return {
    posting_id:            row.posting_id,
    source_type:           row.source_type,
    domain_knowledge:      parseSkillSet(row.domain_knowledge),
    programming_languages: parseSkillSet(row.programming_languages),
    tools:                 parseSkillSet(row.tools),
    infrastructure:        parseSkillSet(row.infrastructure),
    project_management:    parseSkillSet(row.project_management),
    spoken_languages:      parseSkillSet(row.spoken_languages),
    soft_skills:           parseSkillSet(row.soft_skills),
    experience_level:      (row.experience_level ?? null) as ExtractionResult['experience_level'],
    extracted_at:          row.extracted_at,
  };
}

export const db = new ExtractorDb();
