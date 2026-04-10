import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../data/scraper.db');

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  logger.info('NormalizerDb opened', { path: DB_PATH });
  return db;
}

export interface PendingItem {
  id:   string;
  text: string;  // description for job postings, text for cvs
}

class NormalizerDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
    this.migrate();
  }

  // ── Migrations ──────────────────────────────────────────────────────────────

  private migrate(): void {
    // Add columns to job_postings if they don't exist yet
    try { this.db.exec(`ALTER TABLE job_postings ADD COLUMN normalized_text TEXT`); } catch { /* already exists */ }
    try { this.db.exec(`ALTER TABLE job_postings ADD COLUMN normalization_status TEXT DEFAULT 'pending'`); } catch { /* already exists */ }

    // Add columns to cvs if they don't exist yet
    try { this.db.exec(`ALTER TABLE cvs ADD COLUMN normalized_text TEXT`); } catch { /* already exists */ }
    try { this.db.exec(`ALTER TABLE cvs ADD COLUMN normalization_status TEXT DEFAULT 'pending'`); } catch { /* already exists */ }

    // Backfill: any existing rows with NULL status should be pending
    try {
      this.db.exec(`UPDATE job_postings SET normalization_status = 'pending' WHERE normalization_status IS NULL`);
      this.db.exec(`UPDATE cvs SET normalization_status = 'pending' WHERE normalization_status IS NULL`);
    } catch { /* tables may not exist yet if scraper hasn't run */ }
  }

  // ── Stale recovery ──────────────────────────────────────────────────────────

  recoverStale(): void {
    try {
      const jp = this.db.prepare(
        `UPDATE job_postings SET normalization_status = 'pending' WHERE normalization_status = 'processing'`,
      ).run();
      const cv = this.db.prepare(
        `UPDATE cvs SET normalization_status = 'pending' WHERE normalization_status = 'processing'`,
      ).run();
      if (jp.changes + cv.changes > 0) {
        logger.warn('Recovered stale normalization rows', { job_postings: jp.changes, cvs: cv.changes });
      }
    } catch (err) {
      logger.debug('recoverStale skipped', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Job postings ────────────────────────────────────────────────────────────

  claimPendingPostings(limit = 50): PendingItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, description AS text FROM job_postings
         WHERE normalization_status = 'pending'
         ORDER BY scraped_at ASC
         LIMIT ?`,
      )
      .all(limit) as PendingItem[];

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE job_postings SET normalization_status = 'processing' WHERE id IN (${placeholders})`)
      .run(...ids);

    return rows;
  }

  findPostingById(id: string): PendingItem | undefined {
    return this.db
      .prepare(`SELECT id, description AS text FROM job_postings WHERE id = ?`)
      .get(id) as PendingItem | undefined;
  }

  claimPosting(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE job_postings SET normalization_status = 'processing'
         WHERE id = ? AND normalization_status IN ('pending', 'error')`,
      )
      .run(id);
    return result.changes > 0;
  }

  markPostingDone(id: string, normalizedText: string): void {
    this.db
      .prepare(
        `UPDATE job_postings
         SET normalized_text = ?, normalization_status = 'done'
         WHERE id = ?`,
      )
      .run(normalizedText, id);
  }

  markPostingError(id: string, error: string): void {
    logger.error('Normalization failed for posting', { id, error });
    this.db
      .prepare(`UPDATE job_postings SET normalization_status = 'error' WHERE id = ?`)
      .run(id);
  }

  // ── CVs ─────────────────────────────────────────────────────────────────────

  findCvById(id: string): PendingItem | undefined {
    return this.db
      .prepare(`SELECT id, text FROM cvs WHERE id = ?`)
      .get(id) as PendingItem | undefined;
  }

  claimCv(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE cvs SET normalization_status = 'processing'
         WHERE id = ? AND normalization_status IN ('pending', 'error')`,
      )
      .run(id);
    return result.changes > 0;
  }

  markCvDone(id: string, normalizedText: string): void {
    this.db
      .prepare(
        `UPDATE cvs
         SET normalized_text = ?, normalization_status = 'done'
         WHERE id = ?`,
      )
      .run(normalizedText, id);
  }

  markCvError(id: string, error: string): void {
    logger.error('Normalization failed for CV', { id, error });
    this.db
      .prepare(`UPDATE cvs SET normalization_status = 'error' WHERE id = ?`)
      .run(id);
  }

  close(): void {
    this.db.close();
  }
}

export const db = new NormalizerDb();
