import type { ExecutionRecord, ImportResult, SourceReport } from '../shared/types.js';
import type { ExecutionStore } from './store-contract.js';

export interface SqlDatabase {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Keep this DDL aligned with database/schema.sql. Inline SQL also works in
// bundled serverless functions without reading a runtime migration file.
const schema = `
CREATE TABLE IF NOT EXISTS cu_records (id TEXT PRIMARY KEY, origin TEXT NOT NULL, data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS cu_records_origin_idx ON cu_records(origin);
CREATE TABLE IF NOT EXISTS cu_sources (origin TEXT NOT NULL, path TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY(origin,path));
CREATE TABLE IF NOT EXISTS cu_analysis_cache (key TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS cu_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK (calls >= 0));
`;

async function upsertRecords(db: SqlDatabase, records: ExecutionRecord[], origin: string): Promise<void> {
  if (!records.length) return;
  // SQLite's sequential upserts use the last occurrence of an ID. PostgreSQL
  // cannot update the same row twice in one INSERT, so collapse those first.
  const unique = new Map(records.map(record => [record.id, record]));
  await db.query(`
    INSERT INTO cu_records(id, origin, data)
    SELECT incoming.id, $2, incoming.data
    FROM jsonb_to_recordset($1::jsonb) AS incoming(id TEXT, data JSONB)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data
    WHERE cu_records.origin=excluded.origin`,
  [JSON.stringify([...unique.values()].map(record => ({ id: record.id, data: record }))), origin]);
}

export class PostgresStore implements ExecutionStore {
  constructor(private readonly db: SqlDatabase) {}

  async initialize(): Promise<void> {
    await this.db.transaction(async db => {
      // Serialize initialization across cold starts sharing the same database.
      await db.query('SELECT pg_advisory_xact_lock(22453, 1)');
      await db.query(schema);
    });
  }

  async upsert(records: ExecutionRecord[], origin = 'api'): Promise<void> {
    await upsertRecords(this.db, records, origin);
  }

  async replaceOrigin(origin: string, result: ImportResult): Promise<void> {
    await this.db.transaction(async db => {
      // A second snapshot of the same origin must wait before deleting rows;
      // otherwise two concurrent replacements could leave a merged snapshot.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [origin]);
      await db.query('DELETE FROM cu_records WHERE origin=$1', [origin]);
      await db.query('DELETE FROM cu_sources WHERE origin=$1', [origin]);
      await upsertRecords(db, result.records, origin);
      if (result.sources.length) {
        const unique = new Map(result.sources.map(source => [source.path, source]));
        await db.query(`
          INSERT INTO cu_sources(origin, path, data)
          SELECT $2, incoming.path, incoming.data
          FROM jsonb_to_recordset($1::jsonb) AS incoming(path TEXT, data JSONB)
          ON CONFLICT(origin,path) DO UPDATE SET data=excluded.data`,
        [JSON.stringify([...unique.values()].map(source => ({ path: source.path, data: source }))), origin]);
      }
    });
  }

  async records(): Promise<ExecutionRecord[]> {
    return (await this.db.query<{ data: ExecutionRecord }>('SELECT data FROM cu_records')).rows.map(row => row.data);
  }

  async sources(): Promise<SourceReport[]> {
    return (await this.db.query<{ data: SourceReport }>('SELECT data FROM cu_sources')).rows.map(row => row.data);
  }

  async record(id: string): Promise<ExecutionRecord | undefined> {
    return (await this.db.query<{ data: ExecutionRecord }>('SELECT data FROM cu_records WHERE id=$1', [id])).rows[0]?.data;
  }

  async cached(key: string): Promise<unknown> {
    return (await this.db.query<{ data: unknown }>('SELECT data FROM cu_analysis_cache WHERE key=$1', [key])).rows[0]?.data;
  }

  async cache(key: string, data: unknown): Promise<void> {
    await this.db.query('INSERT INTO cu_analysis_cache(key,data) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET data=excluded.data', [key, JSON.stringify(data)]);
  }

  async calls(day: string): Promise<number> {
    return Number((await this.db.query<{ calls: number }>('SELECT calls FROM cu_usage WHERE day=$1', [day])).rows[0]?.calls ?? 0);
  }

  async reserveCall(day: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const result = await this.db.query(`
      INSERT INTO cu_usage(day,calls) VALUES($1,1)
      ON CONFLICT(day) DO UPDATE SET calls=cu_usage.calls+1
      WHERE cu_usage.calls < $2
      RETURNING calls`, [day, limit]);
    return result.rows.length === 1;
  }

  async close(): Promise<void> { await this.db.close(); }
}
