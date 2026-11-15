import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { createApp } from '../server/app';
import { loadConfig, type Config } from '../server/config';
import { Store } from '../server/store';
import type { ExecutionStore } from '../server/store-contract';
import { AnalysisService } from '../server/analysis';
import { createSyncHandler } from '../server/sync';
import type { SourceReport } from '../shared/types';

const password = 'fictional-password-for-tests';
const secret = 'fictional-session-secret-at-least-32-characters';
const token = 'fictional-ingestion-token-at-least-32-characters';
const row = { id: 'one', agent: 'Helper', timestamp: '2026-11-15', actionType: 'run', target: 'Report', detail: 'Completed', status: 'success', outputLink: null };
let store: Store; let server: Server | undefined; let base: string; let config: Config;
beforeEach(() => {
  store = new Store(':memory:');
  config = { ...loadConfig('local'), mode: 'hosted', appOrigin: 'https://control.example', databaseUrl: 'postgres://fictional/db', dashboardPassword: password, sessionSecret: secret, ingestionToken: token, allowedRoots: [], apiKey: '' };
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (server) { await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  store.close();
});
async function start(backing: ExecutionStore = store, sync?: (payload: unknown) => Promise<{ records: number; sources: SourceReport[] }>, refresh = async () => ({ records: 0, sources: [] })) {
  const app = createApp(backing, config, refresh, sync);
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
function request(path: string, init: RequestInit = {}) {
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(base + path, { method: init.method || 'GET', headers: { Host: 'control.example', Origin: 'https://control.example', ...init.headers } as Record<string, string> }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const headers = new Headers(); for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value); resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers })); });
    }); req.on('error', reject); req.end(init.body);
  });
}
async function login() {
  const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!;
}
describe('hosted configuration', () => {
  it('fails closed before touching storage when required config is absent or weak', () => {
    for (const patch of [{ appOrigin: 'http://control.example' }, { appOrigin: 'https://control.example/path' }, { databaseUrl: '' }, { dashboardPassword: 'short' }, { sessionSecret: 'short' }, { ingestionToken: '' }]) {
      expect(() => createApp(store, { ...config, ...patch }, async () => ({ records: 0, sources: [] }))).toThrow(/configuration/i);
    }
  });
  it('detects hosted platforms but honors explicit local mode and erases hosted roots', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('CONTROL_UNIT_MODE', '');
    expect(() => loadConfig()).toThrow(/configuration/i);
    vi.stubEnv('CONTROL_UNIT_MODE', 'local'); expect(loadConfig().mode).toBe('local');
    vi.stubEnv('APP_ORIGIN', config.appOrigin); vi.stubEnv('DATABASE_URL', config.databaseUrl); vi.stubEnv('DASHBOARD_PASSWORD', password); vi.stubEnv('SESSION_SECRET', secret); vi.stubEnv('INGESTION_TOKEN', token);
    expect(loadConfig('hosted').allowedRoots).toEqual([]);
  });
});
describe('hosted sessions and boundaries', () => {
  it('requires sessions for every private endpoint, with bearer insufficient for reads', async () => {
    await start();
    expect(await (await request('/api/session')).json()).toEqual({ authenticated: false, mode: 'hosted' });
    for (const [path, method] of [['/api/dashboard', 'GET'], ['/api/records/one', 'GET'], ['/api/import', 'POST'], ['/api/digest', 'POST'], ['/api/ask', 'POST']]) expect((await request(path, { method })).status).toBe(401);
    expect((await request('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });
  it('issues bounded secure cookies, rejects forged/expired sessions and clears logout', async () => {
    await start(); const cookie = await login();
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Path=/'); expect(cookie).toContain('Max-Age=43200'); expect(cookie).not.toContain(secret); expect(cookie).not.toContain(password);
    const pair = cookie.split(';')[0];
    expect(await (await request('/api/session', { headers: { Cookie: pair } })).json()).toEqual({ authenticated: true, mode: 'hosted' });
    expect((await request('/api/dashboard', { headers: { Cookie: pair } })).status).toBe(200);
    expect((await request('/api/dashboard', { headers: { Cookie: pair + 'x' } })).status).toBe(401);
    const realNow = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(realNow + 43201_000);
    expect((await request('/api/dashboard', { headers: { Cookie: pair } })).status).toBe(401);
    const logout = await request('/api/logout', { method: 'POST' }); expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('gives generic login errors for bad and oversized passwords', async () => {
    await start();
    for (const value of ['wrong', 'x'.repeat(5000), null]) {
      const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value }) });
      expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'Invalid credentials' });
    }
  });
  it('rejects foreign hosts and origins without trusting forwarded headers', async () => {
    await start();
    const rejectedHeaders: Record<string, string>[] = [{ Host: 'evil.example', 'X-Forwarded-Host': 'control.example' }, { Origin: 'https://evil.example' }, { Origin: 'http://control.example' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of rejectedHeaders) expect((await request('/api/session', { headers })).status).toBe(403);
  });
  it('keeps cookie authorization separate from collector authorization', async () => {
    let syncCalls = 0; await start(store, async () => { syncCalls++; return { records: 1, sources: [] }; });
    const cookie = (await login()).split(';')[0];
    for (const endpoint of ['/api/executions', '/api/sync', '/api/executions/', '/api/sync/', '/api/EXECUTIONS', '/api/SYNC']) {
      expect((await request(endpoint, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(row) })).status).toBe(401);
    }
    expect(syncCalls).toBe(0);
    expect((await request('/api/executions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(row) })).status).toBe(201);
    expect((await request('/api/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200); expect(syncCalls).toBe(1);
  });
  it('awaits asynchronous reads and writes; hosted refresh never invokes local import', async () => {
    let imported = false; let wrote = false;
    const backing: ExecutionStore = { upsert: async records => { await Promise.resolve(); store.upsert(records); wrote = true; }, replaceOrigin: (...args) => store.replaceOrigin(...args), records: async () => store.records(), sources: async () => store.sources(), record: async id => store.record(id), cached: async key => store.cached(key), cache: async (key, data) => store.cache(key, data), calls: async day => store.calls(day), reserveCall: async (day, limit) => store.reserveCall(day, limit), close: () => {} };
    await start(backing, undefined, async () => { imported = true; return { records: 0, sources: [] }; }); const cookie = (await login()).split(';')[0];
    expect((await request('/api/executions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(row) })).status).toBe(201); expect(wrote).toBe(true);
    const dashboard = await (await request('/api/dashboard', { headers: { Cookie: cookie } })).json(); expect(dashboard.records).toHaveLength(1); expect(dashboard.runtime).toEqual({ mode: 'hosted', ingestionEndpoint: 'https://control.example/api/executions', collectorRequired: true, lastSyncAt: null });
    expect(await (await request('/api/import', { method: 'POST', headers: { Cookie: cookie } })).json()).toEqual({ records: 1, sources: [] }); expect(imported).toBe(false);
  });
  it('distinguishes malformed JSON, oversized payloads and operational failures without leaking details', async () => {
    const backing = new Proxy(store, { get(target, key) { if (key === 'records' || key === 'upsert') return async () => { throw new Error('postgres://private:secret@example/db'); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    await start(backing); const cookie = (await login()).split(';')[0];
    const response = await request('/api/dashboard', { headers: { Cookie: cookie } }); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('private');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await request('/api/executions', { method: 'POST', headers, body: JSON.stringify(row) })).status).toBe(500);
    expect((await request('/api/executions', { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await request('/api/executions', { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(1024 * 1024) }) })).status).toBe(413);
  });
  it('returns safe validation errors for malformed sync and 500 for persistence failures', async () => {
    const backing = new Proxy(store, { get(target, key) { if (key === 'replaceOrigin') return async () => { throw new Error('postgres://private:secret@example/db'); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    await start(backing, createSyncHandler(backing)); const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const invalid = await request('/api/sync', { method: 'POST', headers, body: '{}' });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toEqual({ error: 'Invalid collector snapshot' });
    const valid = { collectorId: 'device', records: [], sources: [{ path: 'source', kind: 'inbox', status: 'missing', records: 0, skipped: 0, message: 'Missing', importedAt: '2026-11-15' }] };
    const failure = await request('/api/sync', { method: 'POST', headers, body: JSON.stringify(valid) });
    expect(failure.status).toBe(500); const body = JSON.stringify(await failure.json()); expect(body).not.toContain('private'); expect(body).not.toContain('secret');
  });
  it('permits a 2 MB authenticated sync while capping it at 3 MB', async () => {
    await start(store, async () => ({ records: 0, sources: [] })); const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await request('/api/sync', { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }) })).status).toBe(200);
    expect((await request('/api/sync', { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(3 * 1024 * 1024) }) })).status).toBe(413);
  });
});
describe('asynchronous analysis persistence', () => {
  it('awaits quota denial and durable cache writes before returning', async () => {
    let cached = false; let providerCalls = 0;
    const backing = new Proxy(store, { get(target, key) { if (key === 'cached') return async () => undefined; if (key === 'reserveCall') return async () => false; if (key === 'cache') return async () => { await new Promise(resolve => setTimeout(resolve, 15)); cached = true; }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    const rows = [{ ...row, status: 'success' as const, source: { path: 'source' }, entityKey: 'report', recordKind: 'execution' as const, metadata: {} }];
    const denied = new AnalysisService(backing, { ...config, apiKey: 'fictional-provider-key' }, async () => { providerCalls++; return new Response('{}'); });
    const result = await denied.ask('all executions', rows); expect(providerCalls).toBe(0); expect(result.scope).toContain('limit reached');
    const local = new AnalysisService(backing, { ...config, apiKey: '' }); await local.ask('all executions', rows); expect(cached).toBe(true);
  });
});
