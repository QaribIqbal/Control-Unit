import { hostname } from 'node:os';
import { loadConfig } from './config.js';
import { stableId } from './model.js';
import { collectOnce } from './collector.js';

const config = loadConfig('local');
const collectorId = process.env.COLLECTOR_ID || `rio-${stableId(hostname()).slice(0,12)}`;
const options = { home: config.home, paths: config.paths, inbox: config.inbox,
  siteUrl: process.env.CONTROL_UNIT_URL || '', token: config.ingestionToken, collectorId };
const watch = process.argv.includes('--watch');
let stopped = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => { stopped = true; });
do {
  try {
    const result = await collectOnce(options);
    console.log(`Collector ${collectorId}: synchronized ${result.records} records from ${result.sources.length} source reports at ${new Date().toISOString()}.`);
    for (const source of result.sources) console.log(`[${source.status}] ${source.path}: ${source.records} records, ${source.skipped} skipped.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Collector sync failed');
    if (!watch) process.exitCode = 1;
  }
  if (!watch || stopped) break;
  // An unref-free timer intentionally keeps only the explicit collector process alive.
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); process.off('SIGINT',finish); process.off('SIGTERM',finish); resolve(); };
    const timer = setTimeout(finish, config.importIntervalMs);
    process.once('SIGINT',finish); process.once('SIGTERM',finish);
  });
} while (!stopped);
