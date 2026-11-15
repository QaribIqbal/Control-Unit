import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PostgresStore, type SqlDatabase } from '../server/postgres-store';
import type { ExecutionRecord, SourceReport } from '../shared/types';

// Execute every statement on PostgreSQL. The queue models a single checked-out
// connection, so unrelated queries cannot accidentally enter a transaction.
function database(engine: PGlite): SqlDatabase {
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn);
    queue = next.catch(() => undefined);
    return next;
  }
  const connection: SqlDatabase = {
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]) {
      if (params) return engine.query<T>(text, params);
      const results = await engine.exec(text);
      return { rows: (results.at(-1)?.rows ?? []) as T[] };
    },
    async transaction<T>(fn: (db: SqlDatabase) => Promise<T>) {
      await engine.query('BEGIN');
      try {
        const value = await fn(connection);
        await engine.query('COMMIT');
        return value;
      } catch (error) {
        await engine.query('ROLLBACK');
        throw error;
      }
    },
    async close() { await engine.close(); },
  };
  return {
    query: (text, params) => exclusive(() => connection.query(text, params)),
    transaction: fn => exclusive(() => connection.transaction(fn)),
    close: () => exclusive(() => connection.close()),
  };
}

const record = (id: string, detail = 'Sent message'): ExecutionRecord => ({
  id, agent: 'Rio', timestamp: '2026-11-15', actionType: 'linkedin_touch',
  target: 'Clinic', detail, status: 'success', outputLink: null,
  source: { path: '/logs/linkedin.md', line: 3 }, entityKey: `linkedin:${id}`,
  recordKind: 'execution', metadata: { delivered: true },
});
const source = (path: string, records = 1): SourceReport => ({
  path, kind: 'linkedin', status: 'ok', records, skipped: 0,
  message: '', importedAt: '2026-11-15T00:00:00Z',
});

describe('durable PostgreSQL store', () => {
  let db: SqlDatabase;
  let store: PostgresStore;
  beforeEach(async () => {
    db = database(new PGlite());
    store = new PostgresStore(db);
    await store.initialize();
  });
  afterEach(async () => { await store.close(); });

  it('persists records and reports across store instances and repeated initialization', async () => {
    await store.replaceOrigin('collector:a', { records: [record('a')], sources: [source('/a')] });
    const reopened = new PostgresStore(db);
    await reopened.initialize();
    expect(await reopened.records()).toEqual([record('a')]);
    expect(await reopened.sources()).toEqual([source('/a')]);
    expect(await reopened.record('absent')).toBeUndefined();
  });

  it('updates an existing ID only for its owning origin', async () => {
    await store.upsert([record('shared')]);
    await store.upsert([record('shared', 'foreign update')], 'collector:a');
    expect((await store.record('shared'))?.detail).toBe('Sent message');
    await store.upsert([record('shared', 'owner update')]);
    expect((await store.record('shared'))?.detail).toBe('owner update');
    expect(await store.records()).toHaveLength(1);
  });

  it('replaces only the selected origin, including reports with overlapping paths', async () => {
    await store.upsert([record('api')]);
    await store.replaceOrigin('a', { records: [record('a')], sources: [source('/same')] });
    await store.replaceOrigin('b', { records: [record('b')], sources: [source('/same', 2)] });
    await store.replaceOrigin('a', { records: [record('new-a'), record('api', 'hijack')], sources: [source('/new')] });
    expect((await store.records()).map(row => row.id).sort()).toEqual(['api', 'b', 'new-a']);
    expect((await store.record('api'))?.detail).toBe('Sent message');
    expect((await store.sources()).map(row => [row.path, row.records])).toEqual(expect.arrayContaining([['/same', 2], ['/new', 1]]));
    await store.replaceOrigin('a', { records: [], sources: [] });
    expect((await store.records()).map(row => row.id).sort()).toEqual(['api', 'b']);
    expect(await store.sources()).toEqual([source('/same', 2)]);
  });

  it('rolls back deleted records and reports when replacement fails in SQL', async () => {
    await store.replaceOrigin('a', { records: [record('old')], sources: [source('/old')] });
    const invalid = { ...source('/invalid'), path: null } as unknown as SourceReport;
    await expect(store.replaceOrigin('a', { records: [record('new')], sources: [invalid] })).rejects.toThrow();
    expect(await store.records()).toEqual([record('old')]);
    expect(await store.sources()).toEqual([source('/old')]);
  });

  it('ingests 5,000 records in a batch with last duplicate winning', async () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => record(`batch-${index}`));
    await store.upsert([...rows, record('batch-0', "Latest ' quoted $1 detail")], 'a');
    expect(await store.records()).toHaveLength(5_000);
    expect((await store.record('batch-0'))?.detail).toBe("Latest ' quoted $1 detail");
    await store.replaceOrigin('a', { records: [], sources: [source('/a'), source('/a', 3)] });
    expect(await store.sources()).toEqual([source('/a', 3)]);
  });

  it('persists and overwrites structured cache values independently of origins', async () => {
    expect(await store.cached('missing')).toBeUndefined();
    await store.cache('analysis', { text: 'Grounded', citations: ['a'] });
    const reopened = new PostgresStore(db);
    expect(await reopened.cached('analysis')).toEqual({ text: 'Grounded', citations: ['a'] });
    await store.cache('analysis', null);
    await store.replaceOrigin('a', { records: [], sources: [] });
    expect(await reopened.cached('analysis')).toBeNull();
  });

  it('atomically enforces a shared daily call cap across concurrent store instances', async () => {
    const another = new PostgresStore(db);
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 ? store : another).reserveCall('2026-11-15', 7)));
    expect(results.filter(Boolean)).toHaveLength(7);
    expect(await store.calls('2026-11-15')).toBe(7);
    expect(await another.reserveCall('2026-11-16', 1)).toBe(true);
    expect(await store.calls('2026-11-16')).toBe(1);
  });

  it('never creates a paid reservation when the cap is zero', async () => {
    expect(await store.reserveCall('zero', 0)).toBe(false);
    expect(await store.calls('zero')).toBe(0);
    expect((await db.query('SELECT day FROM cu_usage WHERE day=$1', ['zero'])).rows).toEqual([]);
    await store.reserveCall('used', 1);
    expect(await store.reserveCall('used', 0)).toBe(false);
    expect(await store.calls('used')).toBe(1);
  });
});
