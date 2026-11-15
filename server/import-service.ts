import { importRio, importInbox } from './importers.js';
import { Store } from './store.js';
import type { Config } from './config.js';
import type { SourceReport } from '../shared/types.js';

export function createImporter(store: Store, config: Config) {
  let running: Promise<{ records: number; sources: SourceReport[] }> | null = null;
  const run = async () => {
    const rio = await importRio({ home: config.home, paths: config.paths });
    const inbox = await importInbox(config.inbox);
    store.replaceOrigin('rio', rio); store.replaceOrigin('inbox', inbox);
    return { records: rio.records.length + inbox.records.length, sources: [...rio.sources, ...inbox.sources] };
  };
  return () => running || (running = run().finally(() => { running = null; }));
}
