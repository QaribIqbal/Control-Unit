import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { loadConfig } from '../server/config';

let server: Server; let store: Store; let base: string;
beforeEach(async () => {
  store = new Store(':memory:');
  const app = createApp(store, { ...loadConfig('local'), ingestionToken: 'local-test', apiKey: '' }, async () => ({ records: 0, sources: [] }));
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
const record = { id: 'one', agent: 'Helper', timestamp: '2026-11-15T08:00:00+05:00', actionType: 'run', target: 'Report', detail: 'Reported done', status: 'success', outputLink: null };
describe('local HTTP boundary', () => {
  it('imports validated executions idempotently and exposes provenance without the key', async () => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer local-test' };
    expect((await fetch(base+'/api/executions', { method: 'POST', headers, body: JSON.stringify(record) })).status).toBe(201);
    await fetch(base+'/api/executions', { method: 'POST', headers, body: JSON.stringify(record) });
    const data = await (await fetch(base+'/api/dashboard')).json();
    expect(data.records).toHaveLength(1); expect(data.agents.map((a: { name: string }) => a.name)).toContain('Helper');
    expect(data.verification).toHaveLength(1); expect(JSON.stringify(data)).not.toContain('local-test');
  });
  it('rejects missing token, hostile Origin and invalid batches without partial writes', async () => {
    expect((await fetch(base+'/api/executions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })).status).toBe(401);
    expect((await fetch(base+'/api/import', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(base+'/api/executions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-test' }, body: JSON.stringify([record, { bad: true }]) })).status).toBe(400);
    expect(store.records()).toHaveLength(0);
  });
  it('rejects oversized/invalid questions and uses local no-data response', async () => {
    expect((await fetch(base+'/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '' }) })).status).toBe(400);
    const response = await fetch(base+'/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'LinkedIn today' }) });
    expect((await response.json()).text).toContain('No data recorded');
  });
});
