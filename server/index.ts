import express from 'express';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createApp } from './app.js';
import { createImporter } from './import-service.js';

const config = loadConfig('local');
mkdirSync(config.inbox, { recursive: true });
const store = new Store(config.database); const refresh = createImporter(store, config);
await refresh();
const app = createApp(store, config, refresh);
const production = process.argv.includes('--production');
let vite: import('vite').ViteDevServer | undefined;
if (production) {
  const dist = resolve(config.root, 'dist');
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Run npm run build before npm start');
  app.use(express.static(dist, { dotfiles: 'deny' }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(config.port, '127.0.0.1', () => console.log(`Control Unit: http://127.0.0.1:${config.port} (${production ? 'production' : 'development'})`));
server.on('error', () => { console.error('Could not start the local server. Check PORT and whether another instance is running.'); process.exitCode = 1; clearInterval(timer); store.close(); void vite?.close(); });
const timer = setInterval(() => { void refresh().catch(() => console.error('Automatic import failed. Refresh the dashboard to retry.')); }, config.importIntervalMs);
timer.unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { clearInterval(timer); server.close(() => { store.close(); void vite?.close().then(() => process.exit(0)); if (!vite) process.exit(0); }); });
