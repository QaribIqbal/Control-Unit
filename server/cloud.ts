import express from 'express';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createPostgresDatabase } from './postgres-driver.js';
import { PostgresStore } from './postgres-store.js';
import { createSyncHandler } from './sync.js';

let boot: Promise<express.Express> | undefined;
export function getHostedApp(): Promise<express.Express> {
  if (!boot) boot = (async () => {
    const config = loadConfig('hosted');
    const connection = new URL(config.databaseUrl);
    if (connection.searchParams.get('sslmode') === 'disable') throw new Error('Hosted PostgreSQL requires verified TLS');
    connection.searchParams.set('sslmode','verify-full');
    const store = new PostgresStore(createPostgresDatabase(connection.toString()));
    try { await store.initialize(); }
    catch { await store.close(); throw new Error('Hosted database unavailable'); }
    const refresh = async () => ({ records: (await store.records()).length, sources: await store.sources() });
    return createApp(store, config, refresh, createSyncHandler(store));
  })().catch(error => { boot = undefined; throw error; });
  return boot;
}
export function unavailableApp() {
  const app = express();
  app.use((_req,res) => { res.setHeader('Cache-Control','no-store'); res.status(503).json({ error: 'Hosted configuration or database is unavailable. Complete the server environment setup in docs/deployment.md.' }); });
  return app;
}
