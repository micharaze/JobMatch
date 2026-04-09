import * as lancedb from '@lancedb/lancedb';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { FlatSkill, EmbeddedSkillPoint } from '@jobcheck/shared';
import logger from '../logger';

const LANCE_DIR  = process.env.LANCE_DIR ?? path.resolve(__dirname, '../../../../data/vectors');
const TABLE_NAME = 'skills';

/** Deterministic point ID: first 32 hex chars of SHA-256(posting_id:dimension:priority:skill) */
export function pointId(postingId: string, skill: FlatSkill): string {
  return crypto
    .createHash('sha256')
    .update(`${postingId}:${skill.dimension}:${skill.priority}:${skill.skill}`)
    .digest('hex')
    .slice(0, 32);
}

// ── Connection + table cache ──────────────────────────────────────────────────

let _db:    lancedb.Connection | null = null;
let _table: lancedb.Table      | null = null;

async function getDb(): Promise<lancedb.Connection> {
  if (!_db) {
    if (!fs.existsSync(LANCE_DIR)) fs.mkdirSync(LANCE_DIR, { recursive: true });
    _db = await lancedb.connect(LANCE_DIR);
    logger.info('LanceDB connected', { dir: LANCE_DIR });
  }
  return _db;
}

async function getTable(): Promise<lancedb.Table | null> {
  if (_table) return _table;
  const db    = await getDb();
  const names = await db.tableNames();
  if (names.includes(TABLE_NAME)) {
    _table = await db.openTable(TABLE_NAME);
  }
  return _table;
}

/** No-op — table is created lazily on first upsert. */
export async function ensureTable(): Promise<void> {
  logger.debug('LanceDB ready', { dir: LANCE_DIR, table: TABLE_NAME });
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Upsert embedded skill points into LanceDB (merge on `id`). */
export async function upsertPoints(points: EmbeddedSkillPoint[]): Promise<void> {
  if (points.length === 0) return;

  const records = points.map((p) => ({
    id:          p.id,
    vector:      p.vector,
    posting_id:  p.posting_id,
    source_type: p.source_type,
    dimension:   p.dimension,
    priority:    p.priority,
    skill:       p.skill,
  }));

  const db = await getDb();

  if (!_table) {
    const names = await db.tableNames();
    if (names.includes(TABLE_NAME)) {
      _table = await db.openTable(TABLE_NAME);
    } else {
      _table = await db.createTable(TABLE_NAME, records);
      logger.info('Created LanceDB table', { table: TABLE_NAME, rows: records.length });
      return;
    }
  }

  await _table.mergeInsert('id')
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute(records);

  logger.debug('Upserted points to LanceDB', { table: TABLE_NAME, count: records.length });
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Retrieve all stored points for a given posting_id. */
export async function getPointsByPostingId(postingId: string): Promise<EmbeddedSkillPoint[]> {
  const table = await getTable();
  if (!table) return [];

  // Escape single quotes to prevent filter injection
  const safe  = postingId.replace(/'/g, "''");
  const rows  = await table.query().where(`posting_id = '${safe}'`).toArray();
  return rows.map(rowToPoint);
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Delete all points for a given posting_id (e.g. before re-embedding). */
export async function deletePointsByPostingId(postingId: string): Promise<void> {
  const table = await getTable();
  if (!table) return;
  const safe  = postingId.replace(/'/g, "''");
  await table.delete(`posting_id = '${safe}'`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPoint(row: Record<string, unknown>): EmbeddedSkillPoint {
  return {
    id:          row['id']          as string,
    posting_id:  row['posting_id']  as string,
    source_type: row['source_type'] as 'job_posting' | 'cv',
    dimension:   row['dimension']   as string,
    priority:    row['priority']    as 'required' | 'preferred',
    skill:       row['skill']       as string,
    // LanceDB returns Float32Array for vector columns — convert to plain number[]
    vector:      Array.from(row['vector'] as Float32Array),
  };
}
