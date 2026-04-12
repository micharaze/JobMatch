import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.resolve(__dirname, '../../../../../data/scraper.db');

const DDL = `
  CREATE TABLE IF NOT EXISTS cvs (
    id                TEXT PRIMARY KEY,
    original_name     TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    text              TEXT NOT NULL,
    uploaded_at       TEXT NOT NULL,
    extraction_status TEXT NOT NULL DEFAULT 'pending'
      CHECK(extraction_status IN ('pending','processing','done','error')),
    error             TEXT
  );
`;

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.exec(DDL);
  logger.info('CV SQLite database opened', { path: DB_PATH });
  return instance;
}

export interface CvRow {
  id:                   string;
  original_name:        string;
  mime_type:            string;
  text:                 string;
  uploaded_at:          string;
  extraction_status:    'pending' | 'processing' | 'done' | 'error';
  normalization_status: 'pending' | 'processing' | 'done' | 'error' | null;
  error:                string | null;
}

class CvDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
  }

  insert(cv: Omit<CvRow, 'extraction_status' | 'normalization_status' | 'error'>): void {
    this.db
      .prepare(
        `INSERT INTO cvs (id, original_name, mime_type, text, uploaded_at)
         VALUES (@id, @original_name, @mime_type, @text, @uploaded_at)`,
      )
      .run(cv);
  }

  findById(id: string): CvRow | undefined {
    return this.db
      .prepare(`SELECT * FROM cvs WHERE id = ?`)
      .get(id) as CvRow | undefined;
  }

  findAll(opts: { limit?: number; offset?: number } = {}): CvRow[] {
    const limit  = Math.min(opts.limit  ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.db
      .prepare(
        `SELECT id, original_name, mime_type, uploaded_at, extraction_status, error,
                normalization_status
         FROM cvs
         ORDER BY uploaded_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as CvRow[];
  }

  markProcessing(id: string): void {
    this.db
      .prepare(`UPDATE cvs SET extraction_status = 'processing', error = NULL WHERE id = ?`)
      .run(id);
  }

  markDone(id: string): void {
    this.db
      .prepare(`UPDATE cvs SET extraction_status = 'done', error = NULL WHERE id = ?`)
      .run(id);
  }

  markError(id: string, error: string): void {
    this.db
      .prepare(`UPDATE cvs SET extraction_status = 'error', error = ? WHERE id = ?`)
      .run(error, id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM cvs WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export const db = new CvDb();
