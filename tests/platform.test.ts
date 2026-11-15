import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import express from 'express';
import type { Express } from 'express';
import type { Handler as NetlifyHandler } from 'serverless-http';
import { createApp } from '../server/app';
import { loadConfig, type Config } from '../server/config';
import { Store } from '../server/store';

const cloud = vi.hoisted(() => ({
  getHostedApp: vi.fn<() => Promise<unknown>>(),
  unavailableApp: vi.fn<() => unknown>(),
}));
vi.mock('../server/cloud', () => cloud);

const password = 'fictional-platform-password';
const secret = 'fictional-platform-session-secret-at-least-32-characters';
const token = 'fictional-platform-ingestion-token-at-least-32-characters';
const row = { id: 'platform-row', agent: 'Helper', timestamp: '2026-11-15', actionType: 'run', target: 'Report', detail: 'Completed', status: 'success', outputLink: null };
let store: Store;
let app: Express;
let config: Config;
let server: Server | undefined;
let netlifyHandler: NetlifyHandler;
let vercelHandler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>;

beforeEach(async () => {
  store = new Store(':memory:');
  config = { ...loadConfig('local'), mode: 'hosted', appOrigin: 'https://control.example', databaseUrl: 'postgres://fictional/db', dashboardPassword: password, sessionSecret: secret, ingestionToken: token, allowedRoots: [], apiKey: '' };
  app = createApp(store, config, async () => ({ records: 0, sources: [] }));
  cloud.getHostedApp.mockResolvedValue(app);
  cloud.unavailableApp.mockImplementation(() => {
    const unavailable = express();
    unavailable.use((_req, res) => res.status(503).json({ error: 'Hosted configuration or database is unavailable.' }));
    return unavailable;
  });
  const netlify = await import('../netlify/functions/api');
  netlifyHandler = netlify.handler as NetlifyHandler;
  const vercel = await import('../api/[...path]');
  vercelHandler = vercel.default;
});

afterEach(async () => {
  vi.clearAllMocks();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  store.close();
});

function netlifyEvent(path: string) {
  return { httpMethod: 'GET', path, headers: { host: 'control.example' }, multiValueHeaders: {}, queryStringParameters: null, multiValueQueryStringParameters: null, body: null, isBase64Encoded: false } as Parameters<NetlifyHandler>[0];
}
function netlifyResponse(value: object) { return value as { statusCode: number; body?: string }; }

function startVercel() {
  server = createServer((req, res) => { void vercelHandler(req, res); });
  return new Promise<string>(resolve => server!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`)));
}

function request(base: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(base + path, { method: options.method || 'GET', headers: { Host: 'control.example', Origin: 'https://control.example', ...options.headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('serverless platform adapters', () => {
  it('routes Netlify public and direct-function paths through the hosted Express app', async () => {
    for (const path of ['/api/session', '/.netlify/functions/api/session']) {
      const response = netlifyResponse(await netlifyHandler(netlifyEvent(path), {} as never));
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body || '')).toEqual({ authenticated: false, mode: 'hosted' });
    }
  });

  it('preserves hosted auth boundaries and accepts the collector bearer through Netlify', async () => {
    const denied = netlifyResponse(await netlifyHandler({ ...netlifyEvent('/api/dashboard'), httpMethod: 'GET' }, {} as never));
    expect(denied.statusCode).toBe(401);
    const accepted = netlifyResponse(await netlifyHandler({ ...netlifyEvent('/api/executions'), httpMethod: 'POST', headers: { host: 'control.example', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(row) }, {} as never));
    expect(accepted.statusCode).toBe(201);
  });

  it('routes Vercel requests through Express with authentication intact', async () => {
    const base = await startVercel();
    const session = await request(base, '/api/session');
    expect(session.status).toBe(200);
    expect(JSON.parse(session.body)).toEqual({ authenticated: false, mode: 'hosted' });
    expect((await request(base, '/api/dashboard')).status).toBe(401);
    const accepted = await request(base, '/api/executions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
    expect(accepted.status).toBe(201);
  });

  it('uses the generic unavailable app when hosted boot fails on either platform', async () => {
    cloud.getHostedApp.mockRejectedValue(new Error('private database connection detail'));
    const netlify = netlifyResponse(await netlifyHandler(netlifyEvent('/api/session'), {} as never));
    expect(netlify.statusCode).toBe(503);
    expect(netlify.body).not.toContain('private database');

    const base = await startVercel();
    const vercel = await request(base, '/api/session');
    expect(vercel.status).toBe(503);
    expect(vercel.body).not.toContain('private database');
  });
});
