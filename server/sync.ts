import type { ExecutionRecord, ImportResult, SourceRef, SourceReport } from '../shared/types.js';
import type { ExecutionStore } from './store-contract.js';
import { normalizeExecution, stableId, validTimestamp } from './model.js';

export const MAX_SYNC_BYTES = 3 * 1024 * 1024;
export class SnapshotValidationError extends Error { readonly status = 400; }
const kinds = new Set(['applications', 'opportunities', 'linkedin', 'dental', 'social', 'memory', 'inbox']);
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SnapshotValidationError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new SnapshotValidationError(`${name} must be a bounded nonempty string`);
  return value;
}
function sourceRef(value: unknown): SourceRef {
  const raw = object(value, 'source'); const source: SourceRef = { path: text(raw.path, 'source.path', 4096) };
  for (const key of ['line', 'row'] as const) if (raw[key] !== undefined) {
    if (!Number.isInteger(raw[key]) || Number(raw[key]) <= 0) throw new SnapshotValidationError(`source.${key} must be a positive integer`);
    source[key] = Number(raw[key]);
  }
  if (raw.sheet !== undefined) source.sheet = text(raw.sheet, 'source.sheet', 300);
  if (raw.excerpt !== undefined) { if (typeof raw.excerpt !== 'string' || raw.excerpt.length > 64000) throw new SnapshotValidationError('source.excerpt is too large'); source.excerpt = raw.excerpt; }
  return source;
}
export function validateSnapshot(payload: unknown): ImportResult & { collectorId: string } {
  if (Buffer.byteLength(JSON.stringify(payload) || '') > MAX_SYNC_BYTES) throw new SnapshotValidationError('Snapshot exceeds the 3 MB sync limit; no records were replaced');
  const raw = object(payload, 'snapshot');
  if (typeof raw.collectorId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(raw.collectorId)) throw new SnapshotValidationError('collectorId must contain 1–64 letters, digits, dots, underscores or hyphens');
  const collectorId = raw.collectorId;
  if (!Array.isArray(raw.records) || raw.records.length > 5000) throw new SnapshotValidationError('Snapshot must have at most 5000 records');
  if (!Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 128) throw new SnapshotValidationError('Snapshot requires between 1 and 128 source reports');
  const ids = new Map<string,string>();
  const records = raw.records.map(value => {
    const input = object(value, 'record'); const original = text(input.id, 'record.id', 128);
    if (ids.has(original)) throw new SnapshotValidationError('Duplicate record ID in snapshot');
    const id = stableId(JSON.stringify(['collector',collectorId,original])); ids.set(original,id);
    if (!['execution','snapshot','summary'].includes(String(input.recordKind))) throw new SnapshotValidationError('Invalid recordKind in snapshot');
    let normalized: ExecutionRecord;
    try { normalized = normalizeExecution({ ...input, id: undefined }); }
    catch { throw new SnapshotValidationError('Invalid execution record in collector snapshot'); }
    return { ...normalized, id, source: sourceRef(input.source) };
  });
  for (const record of records) if (typeof record.metadata.runId === 'string' && ids.has(record.metadata.runId)) record.metadata.runId = ids.get(record.metadata.runId)!;
  const paths = new Set<string>();
  const sources = raw.sources.map(value => {
    const input = object(value, 'source report'); const path = text(input.path, 'source path', 4096);
    if (paths.has(path)) throw new SnapshotValidationError('Duplicate source path in snapshot'); paths.add(path);
    if (!kinds.has(String(input.kind)) || !['ok','missing','error'].includes(String(input.status))) throw new SnapshotValidationError('Invalid source kind or status');
    for (const field of ['records','skipped']) if (!Number.isInteger(input[field]) || Number(input[field]) < 0) throw new SnapshotValidationError('Invalid source count');
    if (input.status === 'missing' && input.records !== 0) throw new SnapshotValidationError('A missing source cannot contain records');
    if (!validTimestamp(input.importedAt)) throw new SnapshotValidationError('Source importedAt must be an ISO date');
    if (typeof input.message !== 'string' || input.message.length > 64000) throw new SnapshotValidationError('Invalid source message');
    return { path, kind: input.kind, status: input.status, records: input.records, skipped: input.skipped, message: input.message, importedAt: input.importedAt } as SourceReport;
  });
  if (sources.reduce((sum, source) => sum+source.records,0) !== records.length) throw new SnapshotValidationError('Source record count does not match snapshot records');
  return { collectorId, records, sources };
}
export function createSyncHandler(store: ExecutionStore) {
  return async (payload: unknown) => {
    const { collectorId, records, sources } = validateSnapshot(payload);
    await store.replaceOrigin(`collector:${collectorId}`, { records, sources });
    return { records: records.length, sources };
  };
}
