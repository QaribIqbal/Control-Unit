import { importRio, importInbox } from './importers.js';
import { MAX_SYNC_BYTES, validateSnapshot } from './sync.js';
import type { ImportResult, SourceReport } from '../shared/types.js';
import type { SourceKind } from '../shared/types.js';

export interface CollectorOptions {
  home: string; inbox: string; paths: Partial<Record<SourceKind | 'workbook', string>>;
  siteUrl: string; token: string; collectorId: string;
}
export async function sendSnapshot(siteUrl: string, token: string, snapshot: ImportResult & { collectorId: string }, transport: typeof fetch = fetch): Promise<{ records: number; sources: SourceReport[] }> {
  let site: URL; try { site = new URL(siteUrl); } catch { throw new Error('CONTROL_UNIT_URL must be a valid HTTPS site origin'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/' && site.pathname !== '') throw new Error('CONTROL_UNIT_URL must be an HTTPS site origin without credentials or paths');
  if (!token.trim()) throw new Error('INGESTION_TOKEN is required for collector sync');
  const body = JSON.stringify(snapshot);
  if (Buffer.byteLength(body) > MAX_SYNC_BYTES) throw new Error('Snapshot exceeds 3 MB; no data was sent');
  validateSnapshot(snapshot);
  let response: Response;
  try { response = await transport(new URL('/api/sync',site), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body }); }
  catch { throw new Error('Collector sync was not confirmed. Check the hosted dashboard before retrying.'); }
  if (!response.ok) throw new Error(`Collector sync rejected (HTTP ${response.status}). Check hosted configuration and ingestion authorization. Previous snapshot is retained on rejected requests.`);
  try {
    const result = await response.json() as { records?: unknown; sources?: unknown };
    if (result.records !== snapshot.records.length || !Array.isArray(result.sources)) throw new Error();
    return result as { records: number; sources: SourceReport[] };
  } catch { throw new Error('Collector returned an invalid acknowledgement; refresh the hosted dashboard to check whether sync completed'); }
}
export async function collectOnce(options: CollectorOptions, transport: typeof fetch = fetch) {
  const [rio,inbox] = await Promise.all([importRio({ home: options.home, paths: options.paths }), importInbox(options.inbox)]);
  return sendSnapshot(options.siteUrl, options.token, { collectorId: options.collectorId, records: [...rio.records,...inbox.records], sources: [...rio.sources,...inbox.sources] }, transport);
}
