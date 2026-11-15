import { createHash } from 'node:crypto';
import type { ExecutionRecord, Status } from '../shared/types.js';

const statuses = new Set<Status>(['success', 'failed', 'blocked', 'pending', 'in_progress', 'planned', 'published', 'unknown']);
export const stableId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value.slice(0, 10) || (value.includes('T') && new Date(value.slice(0, 10)).getUTCDate() === Number(value.slice(8, 10)));
}
function field(input: Record<string, unknown>, name: string, max = 2000): string {
  const value = input[name];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be a nonempty string (max ${max} characters)`);
  return value.trim();
}
export function normalizeExecution(raw: unknown, sourcePath?: string): ExecutionRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Execution must be an object');
  const input = raw as Record<string, unknown>;
  const agent = field(input, 'agent', 100);
  const actionType = field(input, 'actionType', 80);
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(actionType)) throw new Error('actionType must be a simple action identifier');
  const target = field(input, 'target', 1000); const detail = field(input, 'detail', 16000);
  if (input.timestamp !== null && !validTimestamp(input.timestamp)) throw new Error('timestamp must be ISO 8601 with timezone, YYYY-MM-DD, or null');
  if (!statuses.has(input.status as Status)) throw new Error('status must be success, failed, blocked, pending, in_progress, planned, published, or unknown');
  if (input.outputLink != null && (typeof input.outputLink !== 'string' || input.outputLink.length > 4000)) throw new Error('outputLink must be a string or null');
  if (input.id != null && (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 128)) throw new Error('id must be a nonempty string, max 128 characters');
  const metadata: ExecutionRecord['metadata'] = {};
  if (input.metadata != null) {
    if (typeof input.metadata !== 'object' || Array.isArray(input.metadata)) throw new Error('metadata must be an object of primitive values');
    for (const [key, value] of Object.entries(input.metadata)) {
      if (key.length > 100 || !['string', 'number', 'boolean'].includes(typeof value) && value !== null || typeof value === 'number' && !Number.isFinite(value) || typeof value === 'string' && value.length > 4000) throw new Error('metadata values must be bounded strings, finite numbers, booleans, or null');
      metadata[key] = value as string | number | boolean | null;
    }
  }
  if (input.id) metadata.externalId = input.id as string;
  const timestamp = input.timestamp as string | null;
  const id = stableId(JSON.stringify([agent, input.id || [timestamp, actionType, target, detail, input.status, input.outputLink || null]]));
  return { id, agent, timestamp, actionType, target, detail, status: input.status as Status, outputLink: input.outputLink as string || null,
    source: { path: sourcePath || `api:${agent}` }, entityKey: typeof input.entityKey === 'string' && input.entityKey.length <= 1000 ? input.entityKey : `${actionType}:${target.toLowerCase().replace(/\W+/g, '-')}`,
    recordKind: input.recordKind === 'snapshot' || input.recordKind === 'summary' ? input.recordKind : 'execution', metadata };
}
