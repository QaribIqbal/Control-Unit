import type { ExecutionRecord, ImportResult, SourceReport } from '../shared/types.js';
export type Awaitable<T> = T | Promise<T>;
export interface ExecutionStore {
  upsert(records: ExecutionRecord[], origin?: string): Awaitable<void>;
  replaceOrigin(origin: string, result: ImportResult): Awaitable<void>;
  records(): Awaitable<ExecutionRecord[]>;
  sources(): Awaitable<SourceReport[]>;
  record(id: string): Awaitable<ExecutionRecord | undefined>;
  cached(key: string): Awaitable<unknown>;
  cache(key: string, data: unknown): Awaitable<void>;
  calls(day: string): Awaitable<number>;
  reserveCall(day: string, limit: number): Awaitable<boolean>;
  close(): Awaitable<void>;
}
