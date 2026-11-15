import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionRecord, ImportResult, SourceReport } from '../shared/types.js';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, origin TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (origin TEXT NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(origin,path));
      CREATE TABLE IF NOT EXISTS analysis_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);`);
  }
  upsert(records: ExecutionRecord[], origin = 'api') {
    const stmt = this.db.prepare('INSERT INTO records(id,origin,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE records.origin=excluded.origin');
    for (const record of records) stmt.run(record.id, origin, JSON.stringify(record));
  }
  replaceOrigin(origin: string, result: ImportResult) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM records WHERE origin=?').run(origin);
      this.db.prepare('DELETE FROM sources WHERE origin=?').run(origin);
      this.upsert(result.records, origin);
      const stmt = this.db.prepare('INSERT OR REPLACE INTO sources(origin,path,data) VALUES(?,?,?)');
      for (const source of result.sources) stmt.run(origin, source.path, JSON.stringify(source));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  records(): ExecutionRecord[] { return (this.db.prepare('SELECT data FROM records').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  sources(): SourceReport[] { return (this.db.prepare('SELECT data FROM sources').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  record(id: string): ExecutionRecord | undefined { const r = this.db.prepare('SELECT data FROM records WHERE id=?').get(id) as { data: string } | undefined; return r ? JSON.parse(r.data) : undefined; }
  cached(key: string): unknown { const row = this.db.prepare('SELECT data FROM analysis_cache WHERE key=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) : undefined; }
  cache(key: string, data: unknown) { this.db.prepare('INSERT OR REPLACE INTO analysis_cache(key,data) VALUES(?,?)').run(key, JSON.stringify(data)); }
  calls(day: string) { return Number((this.db.prepare('SELECT calls FROM usage WHERE day=?').get(day) as { calls: number } | undefined)?.calls || 0); }
  reserveCall(day: string, limit: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.calls(day) >= limit) { this.db.exec('ROLLBACK'); return false; }
      this.db.prepare('INSERT INTO usage(day,calls) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
      this.db.exec('COMMIT'); return true;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
