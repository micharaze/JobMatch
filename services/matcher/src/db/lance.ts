import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import type { EmbeddedSkillPoint } from '@jobcheck/shared';
import logger from '../logger';

const LANCE_DIR  = process.env.LANCE_DIR ?? path.resolve(__dirname, '../../../../data/vectors');
const TABLE_NAME = 'skills';

// ── Connection + table cache ──────────────────────────────────────────────────

let _db:    lancedb.Connection | null = null;
let _table: lancedb.Table      | null = null;

async function getDb(): Promise<lancedb.Connection> {
  if (!_db) {
    if (!fs.existsSync(LANCE_DIR)) fs.mkdirSync(LANCE_DIR, { recursive: true });
    _db = await lancedb.connect(LANCE_DIR);
    logger.info('LanceDB connected (matcher)', { dir: LANCE_DIR });
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

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Retrieve all stored points for a given posting_id (used to get job skill vectors).
 */
export async function getPointsByPostingId(postingId: string): Promise<EmbeddedSkillPoint[]> {
  const table = await getTable();
  if (!table) return [];

  const safe = postingId.replace(/'/g, "''");
  const rows = await table.query().where(`posting_id = '${safe}'`).toArray();
  return rows.map(rowToPoint);
}

/**
 * Vector similarity search for CV skills in a specific dimension.
 * Uses asymmetric retrieval: job skills are re-encoded as queries at search time.
 *
 * @param queryVector - job skill vector encoded with "query: " prefix
 * @param dimension   - skill dimension to filter (e.g. "programming_languages")
 * @param cvId        - posting_id of the CV to search within
 * @param topK        - maximum number of candidates to return
 */
export async function searchCvSkills(
  queryVector: number[],
  dimension:   string,
  cvId:        string,
  topK:        number,
): Promise<Array<EmbeddedSkillPoint & { _distance: number }>> {
  const table = await getTable();
  if (!table) return [];

  const safeDim  = dimension.replace(/'/g, "''");
  const safeCvId = cvId.replace(/'/g, "''");

  const filter = `source_type = 'cv' AND dimension = '${safeDim}' AND posting_id = '${safeCvId}'`;

  const rows = await table
    .vectorSearch(queryVector)
    .where(filter)
    .distanceType('cosine')
    .limit(topK)
    .toArray();

  return rows.map((row) => ({
    ...rowToPoint(row),
    // LanceDB returns distance (lower = closer). Convert to cosine similarity: 1 - distance.
    _distance: row['_distance'] as number ?? 0,
  }));
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
    vector:      Array.from(row['vector'] as Float32Array),
  };
}
