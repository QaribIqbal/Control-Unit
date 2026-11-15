import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSnapshot, createSyncHandler, SnapshotValidationError } from '../server/sync';
import { sendSnapshot, collectOnce } from '../server/collector';
import { Store } from '../server/store';
import type { ExecutionRecord, SourceReport } from '../shared/types';

const record: ExecutionRecord = { id: 'rio-row', agent: 'Rio', timestamp: '2026-11-15', actionType: 'linkedin_touch', target: 'Test contact', detail: 'Sent message', status: 'success', outputLink: null, source: { path: '/rio/log.md', line: 3, excerpt: '| Test contact | sent |' }, entityKey: 'linkedin:contact', recordKind: 'execution', metadata: {} };
const source: SourceReport = { path: '/rio/log.md', kind: 'linkedin', status: 'ok', records: 1, skipped: 0, message: 'Imported one row', importedAt: '2026-11-15T10:00:00Z' };
const payload = { collectorId: 'rio-main', records: [record], sources: [source] };
describe('authenticated collector snapshot contract', () => {
  it('validates and scopes stable identities without losing provenance or external run identity', () => {
    const first = validateSnapshot(payload); const second = validateSnapshot(payload);
    expect(first.records[0].id).toBe(second.records[0].id); expect(first.records[0].id).not.toBe(record.id);
    expect(first.records[0].source).toEqual(record.source);
    expect(validateSnapshot({ ...payload, collectorId: 'other' }).records[0].id).not.toBe(first.records[0].id);
    const run = { ...record, id: 'run-internal', actionType: 'run', metadata: { externalId: 'run-original' } };
    const output = { ...record, id: 'output-internal', actionType: 'output', metadata: { runId: 'run-internal', content: 'Delivered output' } };
    const linked = validateSnapshot({ ...payload, records: [run, output], sources: [{ ...source, records: 2 }] });
    expect(linked.records[0].metadata.externalId).toBe('run-original');
    expect(linked.records[1].metadata.runId).toBe(linked.records[0].id);
  });
  it('rejects invalid source fields and oversized payload before storing anything', () => {
    expect(() => validateSnapshot({ ...payload, collectorId: '../another' })).toThrow(/collectorId/);
    expect(() => validateSnapshot({ ...payload, records: [{ ...record, source: { path: '/rio/log.md', line: -1 } }] })).toThrow(/source/i);
    try { validateSnapshot({ ...payload, records: [{ ...record, timestamp: 'invalid date' }] }); throw new Error('expected validation failure'); }
    catch (error) { expect((error as {status?:number}).status).toBe(400); }
    expect(() => validateSnapshot({ ...payload, sources: [{ ...source, records: 9000 }] })).toThrow(/count/i);
    expect(() => validateSnapshot({ ...payload, junk: 'x'.repeat(3*1024*1024) })).toThrow(/3 MB/);
  });
  it('rejects a missing source that claims records', () => {
    let failure: unknown;
    try {
      validateSnapshot({ ...payload, sources: [{ ...source, status: 'missing', records: 1 }] });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SnapshotValidationError);
    expect(failure).toHaveProperty('status', 400);
  });
  it('replaces one collector atomically while preserving API and other collector data', async () => {
    const store = new Store(':memory:'); const sync = createSyncHandler(store);
    try {
      store.upsert([{ ...record, id: 'api-id' }]);
      await sync(payload); await sync({ ...payload, collectorId: 'other' });
      expect(store.records()).toHaveLength(3);
      await expect(sync({ ...payload, records: [{ invalid: true }] })).rejects.toThrow();
      expect(store.records()).toHaveLength(3);
      await sync({ collectorId: 'rio-main', records: [], sources: [{ ...source, status: 'missing', records: 0 }] });
      expect(store.records()).toHaveLength(2); expect(store.record('api-id')).toBeDefined();
    } finally { store.close(); }
  });
});
describe('collector transport', () => {
  it('uses HTTPS, rejects redirects and does not expose a bearer key in errors', async () => {
    let calls = 0;
    const transport: typeof fetch = async (url, init) => { calls++; expect(String(url)).toBe('https://control.example/api/sync'); expect(init?.redirect).toBe('error'); expect((init?.headers as Record<string,string>).Authorization).toBe('Bearer test-only-collector-token'); return new Response(JSON.stringify({ records: 1, sources: [source] })); };
    await sendSnapshot('https://control.example', 'test-only-collector-token', payload, transport); expect(calls).toBe(1);
    await expect(sendSnapshot('http://control.example', 'test-only-collector-token', payload, transport)).rejects.toThrow(/HTTPS/);
    await expect(sendSnapshot('https://control.example', 'test-only-collector-token', payload, async () => new Response('test-only-collector-token private error', { status: 401 }))).rejects.not.toThrow(/test-only-collector-token/);
  });
  it('reads real temporary files without mutation and never needs local SQLite', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cu-collector-'));
    try {
      const folder = join(home, 'workspace/job-hunt-2026-10-10'); await mkdir(folder, { recursive: true });
      const file = join(folder, 'applied-log.md'); const content = '# 2026-11-15\n| Company | Role | Status |\n| --- | --- | --- |\n| Test clinic | Analyst | Applied |\n'; await writeFile(file, content);
      let body: { records: ExecutionRecord[]; sources: SourceReport[] } | undefined;
      const transport: typeof fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ records: body!.records.length, sources: body!.sources })); };
      await collectOnce({ home, inbox: join(home, 'missing-inbox'), paths: {}, siteUrl: 'https://control.example', token: 'test-only-token', collectorId: 'fixture-collector' }, transport);
      expect(body!.records).toHaveLength(1); expect(body!.sources.some(s => s.status === 'missing')).toBe(true);
      expect(await readFile(file,'utf8')).toBe(content);
      await expect(readFile(join(home,'data/control-unit.sqlite'))).rejects.toThrow();
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
