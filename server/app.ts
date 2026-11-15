import express from 'express';
import { buildDashboard, dayKey } from './dashboard.js';
import { normalizeExecution } from './model.js';
import { AnalysisService } from './analysis.js';
import { validateHostedConfig, type Config } from './config.js';
import { authenticated, clearSessionCookie, sessionCookie, validBearer, validPassword } from './auth.js';
import type { SourceReport } from '../shared/types.js';
import type { ExecutionStore } from './store-contract.js';
import { SnapshotValidationError } from './sync.js';

type ImportResponse = { records: number; sources: SourceReport[] };
// Express routes are case insensitive and accept a trailing slash by default.
const routePath = (path: string) => path.toLowerCase().replace(/\/+$/, '');
export function createApp(store: ExecutionStore, config: Config, refresh: () => Promise<ImportResponse>, sync?: (payload: unknown) => Promise<ImportResponse>) {
  validateHostedConfig(config);
  const hosted = config.mode === 'hosted';
  const canonical = hosted ? new URL(config.appOrigin) : undefined;
  const app = express(); app.disable('x-powered-by');
  const analysis = new AnalysisService(store, config);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (hosted) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const rawHost = req.headers.host || '';
      const host = new URL(`http://${rawHost}`);
      if (!rawHost || host.host.toLowerCase() !== rawHost.toLowerCase() || host.username || host.password) throw new Error();
      if (hosted) {
        if (host.host !== canonical!.host) return void res.status(403).json({ error: 'Invalid request host or origin' });
        if (req.headers.origin && req.headers.origin !== canonical!.origin) return void res.status(403).json({ error: 'Invalid request host or origin' });
      } else {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return void res.status(403).json({ error: 'Only loopback hosts are allowed' });
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (origin.origin !== `http://${host.host}`) return void res.status(403).json({ error: 'Cross-origin access is not allowed' });
        }
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return void res.status(403).json({ error: 'Cross-site access is not allowed' });
    } catch { return void res.status(403).json({ error: 'Invalid request host or origin' }); }
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Authenticate before parsing bodies or touching storage. Ingestion never accepts a browser cookie.
  app.use('/api', (req, res, next) => {
    const path = routePath(req.path);
    if (['/session', '/login', '/logout'].includes(path)) return next();
    if (path === '/executions' || path === '/sync') {
      if ((hosted || config.ingestionToken) && !validBearer(req.headers.authorization, config.ingestionToken)) return void res.status(401).json({ error: 'A valid ingestion bearer token is required' });
    } else if (hosted && !authenticated(req.headers.cookie, config.sessionSecret)) return void res.status(401).json({ error: 'Authentication required' });
    next();
  });
  const defaultJson = express.json({ limit: '1mb', strict: true });
  const syncJson = express.json({ limit: '3mb', strict: true });
  app.use((req, res, next) => (routePath(req.path) === '/api/sync' ? syncJson : defaultJson)(req, res, next));
  app.get('/api/session', (req, res) => res.json({ authenticated: !hosted || authenticated(req.headers.cookie, config.sessionSecret), mode: config.mode }));
  app.post('/api/login', (req, res) => {
    if (!hosted) return void res.json({ authenticated: true, mode: config.mode });
    if (!validPassword(req.body?.password, config.dashboardPassword)) return void res.status(401).json({ error: 'Invalid credentials' });
    res.setHeader('Set-Cookie', sessionCookie(config.sessionSecret)); res.json({ authenticated: true, mode: config.mode });
  });
  app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', clearSessionCookie()); res.json({ authenticated: !hosted, mode: config.mode }); });
  app.get('/api/dashboard', async (_req, res) => {
    const [records, sources, callsToday] = await Promise.all([store.records(), store.sources(), store.calls(dayKey(new Date().toISOString(), config.timezone))]);
    const data = buildDashboard(records, sources, { timezone: config.timezone, allowedRoots: hosted ? [] : config.allowedRoots, configured: Boolean(config.apiKey), model: config.model, callsToday, dailyLimit: config.dailyLimit });
    const lastSyncAt = sources.map(source => source.importedAt).filter(value => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
    data.runtime = { mode: config.mode, ingestionEndpoint: `${hosted ? canonical!.origin : config.appOrigin}/api/executions`, collectorRequired: hosted, lastSyncAt };
    res.json(data);
  });
  app.get('/api/records/:id', async (req, res) => { const record = await store.record(req.params.id); if (!record) return void res.status(404).json({ error: 'Record not found' }); res.json(record); });
  app.post('/api/import', async (_req, res) => {
    if (hosted) { const [records, sources] = await Promise.all([store.records(), store.sources()]); return void res.json({ records: records.length, sources }); }
    try { res.json(await refresh()); } catch { res.status(500).json({ error: 'Import failed; check source diagnostics and local directory permissions.' }); }
  });
  app.post('/api/executions', async (req, res) => {
    let records;
    try {
      const input = Array.isArray(req.body) ? req.body : [req.body];
      if (!input.length || input.length > 500) throw new Error('Provide between 1 and 500 execution records');
      records = input.map(raw => normalizeExecution(raw));
    } catch (error) { return void res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid execution record' }); }
    await store.upsert(records, 'api'); res.status(201).json({ accepted: records.length, ids: records.map(r => r.id) });
  });
  app.post('/api/sync', async (req, res) => {
    if (!sync) return void res.status(503).json({ error: 'Collector sync is unavailable' });
    res.json(await sync(req.body));
  });
  app.post('/api/digest', async (_req, res) => { try { res.json(await analysis.digest(await store.records())); } catch { res.status(500).json({ error: 'Could not generate digest' }); } });
  app.post('/api/ask', async (req, res) => {
    const question: unknown = req.body?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > 2000) return void res.status(400).json({ error: 'question must be a nonempty string of at most 2000 characters' });
    try { res.json(await analysis.ask(question.trim(), await store.records())); } catch { res.status(500).json({ error: 'Could not analyze records' }); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));
  app.use((error: { type?: string; status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error.type === 'entity.too.large') return void res.status(413).json({ error: `Request exceeds the ${routePath(req.path) === '/api/sync' ? '3' : '1'} MB limit` });
    if (error instanceof SnapshotValidationError) return void res.status(400).json({ error: 'Invalid collector snapshot' });
    if (error.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON request' });
    res.status(500).json({ error: 'Request could not be completed' });
  });
  return app;
}
