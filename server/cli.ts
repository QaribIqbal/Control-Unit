import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createImporter } from './import-service.js';

const config = loadConfig('local'); const store = new Store(config.database);
try {
  const result = await createImporter(store, config)();
  console.log(`Imported ${result.records} individually recorded rows.`);
  for (const source of result.sources) console.log(`[${source.status}] ${source.path}: ${source.records} records, ${source.skipped} skipped. ${source.message}`);
} finally { store.close(); }
