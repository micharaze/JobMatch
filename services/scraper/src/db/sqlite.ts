import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { JobPosting } from '@jobcheck/shared';
import logger from '../logger';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'scraper.db');

const DDL = `
  CREATE TABLE IF NOT EXISTS job_postings (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    author TEXT,
    author_company TEXT,
    author_email TEXT,
    author_tel TEXT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT NOT NULL,
    contract_type TEXT,
    posted_at TEXT,
    scraped_at TEXT NOT NULL,
    raw_html TEXT,
    extraction_status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS scrape_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    error TEXT NOT NULL,
    raw_html TEXT
  );
`;

function open(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.exec(DDL);
  logger.info('SQLite database initialised', { path: DB_PATH });
  return instance;
}

class ScraperDb {
  private db: Database.Database;

  constructor() {
    this.db = open();
  }

  /** Insert a posting. Returns true if inserted, false if it already existed. */
  upsert(posting: JobPosting): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO job_postings
        (id, source, url, author, author_company, author_email, author_tel,
         title, company, location, description, contract_type, posted_at,
         scraped_at, raw_html, extraction_status)
      VALUES
        (@id, @source, @url, @author, @author_company, @author_email, @author_tel,
         @title, @company, @location, @description, @contract_type, @posted_at,
         @scraped_at, @raw_html, 'pending')
    `);
    const result = stmt.run({
      id: posting.id,
      source: posting.source,
      url: posting.url,
      author: posting.author ?? null,
      author_company: posting.author_company ?? null,
      author_email: posting.author_email ?? null,
      author_tel: posting.author_tel ?? null,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      description: posting.description,
      contract_type: posting.contract_type ?? null,
      posted_at: posting.posted_at ?? null,
      scraped_at: posting.scraped_at,
      raw_html: posting.raw_html ?? null,
    });
    return result.changes > 0;
  }

  /** Check if a posting URL already exists (for pre-scrape deduplication). */
  existsByUrl(url: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM job_postings WHERE url = ?').get(url);
    return row !== undefined;
  }

  /** Delete a posting by URL. Returns true if a row was deleted. */
  deleteByUrl(url: string): boolean {
    const result = this.db.prepare('DELETE FROM job_postings WHERE url = ?').run(url);
    return result.changes > 0;
  }

  /** Log a failed scrape attempt. */
  logFailure(url: string, error: string, rawHtml?: string): void {
    this.db.prepare(`
      INSERT INTO scrape_failures (url, attempted_at, error, raw_html)
      VALUES (?, ?, ?, ?)
    `).run(url, new Date().toISOString(), error, rawHtml ?? null);
  }

  findAll(opts: { source?: string; limit?: number; offset?: number } = {}): JobPosting[] {
    const { source, limit = 50, offset = 0 } = opts;
    const where = source ? 'WHERE source = ?' : '';
    const params: unknown[] = source ? [source, limit, offset] : [limit, offset];
    const rows = this.db.prepare(`
      SELECT id, source, url, author, author_company, author_email, author_tel,
             title, company, location, description, contract_type, posted_at, scraped_at,
             normalization_status
      FROM job_postings
      ${where}
      ORDER BY scraped_at DESC
      LIMIT ? OFFSET ?
    `).all(...params);
    return rows as JobPosting[];
  }

  findById(id: string): JobPosting | undefined {
    const row = this.db.prepare('SELECT * FROM job_postings WHERE id = ?').get(id);
    return row as JobPosting | undefined;
  }

  findFailures(limit = 100): unknown[] {
    return this.db.prepare(`
      SELECT id, url, attempted_at, error
      FROM scrape_failures
      ORDER BY attempted_at DESC
      LIMIT ?
    `).all(limit);
  }

  close(): void {
    this.db.close();
  }
}

export const db = new ScraperDb();
