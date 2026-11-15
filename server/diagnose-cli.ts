import { loadConfig } from './config.js';
import { importRio } from './importers.js';

// Read-only: prints what each source produced and why lines were skipped. Sends nothing anywhere.
const config = loadConfig('local');
const result = await importRio({ home: config.home, paths: config.paths });
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.slice(8)) || 25;
for (const source of result.sources.filter(s => s.kind !== 'inbox')) {
  console.log(`\n=== [${source.status}] ${source.kind}  ${source.path}\n    ${source.records} records, ${source.skipped} skipped`);
  const lines = source.message.split('\n').filter(Boolean);
  for (const line of lines.slice(0, limit)) console.log(`    ${line}`);
  if (lines.length > limit) console.log(`    … ${lines.length - limit} more (use --limit=N)`);
}
