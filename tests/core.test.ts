import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeExecution } from '../server/model';
import { Store } from '../server/store';
import { buildDashboard, dayKey, verificationFlags } from '../server/dashboard';
import type { ExecutionRecord } from '../shared/types';

const record = (overrides: Partial<ExecutionRecord> = {}): ExecutionRecord => ({
  id: 'r1', agent: 'Rio', timestamp: '2026-11-15', actionType: 'linkedin_touch', target: 'Amina at Clinic',
  detail: 'Sent LinkedIn message', status: 'success', outputLink: null, entityKey: 'linkedin:amina', recordKind: 'execution',
  source: { path: '/logs/linkedin.md', line: 3, excerpt: '| 2026-11-15 | Amina | sent |' }, metadata: { person: 'Amina', company: 'Clinic', type: 'message' }, ...overrides,
});
const now = new Date('2026-11-15T12:00:00+05:00');

describe('validated common execution schema', () => {
  it('rejects invalid timestamps rather than fabricating the import time', () => {
    expect(() => normalizeExecution({ agent: 'Rio', timestamp: 'yesterday-ish', actionType: 'task', target: 'x', detail: 'x', status: 'success' })).toThrow(/timestamp/i);
  });
  it('keeps unknown dates null and stable IDs idempotent', () => {
    const input = { agent: 'New agent', timestamp: null, actionType: 'task', target: 'Report', detail: 'Waiting', status: 'pending' };
    expect(normalizeExecution(input).timestamp).toBeNull();
    expect(normalizeExecution(input).id).toBe(normalizeExecution(input).id);
    expect(normalizeExecution(input).source.path).toBe('api:New agent');
  });
  it('does not accept a caller-supplied provenance path', () => {
    expect(normalizeExecution({ ...record(), source: { path: '/private/secret' } }).source.path).toBe('api:Rio');
  });
});

describe('durable store', () => {
  it('persists, deduplicates and replaces only imported records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'control-store-')); const path = join(dir, 'test.sqlite');
    try {
      const store = new Store(path);
      store.upsert([record()], 'api'); store.upsert([record()], 'api');
      store.replaceOrigin('rio', { records: [record({ id: 'rio1' })], sources: [] });
      expect(store.records()).toHaveLength(2);
      store.replaceOrigin('rio', { records: [], sources: [] });
      store.close(); const reopened = new Store(path);
      expect(reopened.records().map(r => r.id)).toEqual(['r1']); reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('traceable metrics and time windows', () => {
  it('shows missing categories as unknown, not fabricated zero totals', () => {
    const data = buildDashboard([], [], { now });
    expect(data.kpis.every(k => k.value === null)).toBe(true);
    expect(data.agents[0].name).toBe('Rio');
    expect(data.linkedinDaily).toHaveLength(14);
    expect(data.linkedinDaily.every(d => d.count === 0 && d.recordIds.length === 0)).toBe(true);
  });
  it('deduplicates overlap and excludes summaries, pending touches and unknown dates from today', () => {
    const records = [record(), record({ id: 'duplicate', source: { path: '/applied.md', line: 9 } }),
      record({ id: 'summary', recordKind: 'summary', actionType: 'summary', detail: 'Sent 500 messages' }),
      record({ id: 'unknown-date', target: 'Ali', entityKey: 'linkedin:ali', timestamp: null }),
      record({ id: 'pending', target: 'Sam', entityKey: 'linkedin:sam', status: 'pending' })];
    const data = buildDashboard(records, [], { now });
    expect(data.kpis.find(k => k.id === 'linkedin-total')?.value).toBe(2);
    expect(data.kpis.find(k => k.id === 'linkedin-today')?.value).toBe(1);
    expect(data.kpis.find(k => k.id === 'linkedin-today')?.recordIds).toEqual(['r1']);
  });
  it('uses Pakistan calendar day and Monday-based weeks', () => {
    expect(dayKey('2026-11-15T20:30:00Z', 'Asia/Karachi')).toBe('2026-11-16');
    const data = buildDashboard([record({ actionType: 'job_application', timestamp: '2026-11-09' }), record({ id: 'old', actionType: 'job_application', timestamp: '2026-11-08', entityKey: 'application:other' })], [], { now });
    expect(data.kpis.find(k => k.id === 'applications-week')?.value).toBe(1);
  });
  it('uses latest pipeline state and only marks active items stale after three days', () => {
    const old = record({ actionType: 'interview', status: 'pending', timestamp: '2026-11-10', metadata: { stage: 'Interview', waitingOn: 'Recruiter' } });
    const fresh = record({ ...old, id: 'new', timestamp: '2026-11-14', status: 'success', metadata: { stage: 'Rejected' } });
    const stale = record({ id: 'lead', actionType: 'dental_lead', entityKey: 'dental:clinic', timestamp: '2026-11-12', status: 'pending', metadata: { stage: 'Contacted', waitingOn: 'Clinic owner' } });
    const undated = record({ id: 'undated', actionType: 'task', timestamp: null, status: 'blocked' });
    const data = buildDashboard([old, fresh, stale, undated], [], { now });
    expect(data.entities.interviews).toHaveLength(1);
    expect(data.kpis.find(k => k.id === 'interviews')?.value).toBe(0);
    expect(data.stale).toEqual([{ recordId: 'lead', daysWaiting: 3, waitingOn: 'Clinic owner' }]);
  });
  it('retains separately identified real touches and does not count updated snapshots as new applications', () => {
    const first = record({ id: 'first', metadata: { externalId: 'message1' } });
    const second = record({ id: 'second', metadata: { externalId: 'message2' } });
    const app = record({ id: 'app', actionType: 'job_application', entityKey: 'application:clinic:engineer', timestamp: '2026-11-10' });
    const snapshot = record({ ...app, id: 'snapshot', recordKind: 'snapshot', timestamp: '2026-11-12' });
    const data = buildDashboard([first, second, app, snapshot], [], { now });
    expect(data.kpis.find(k => k.id === 'linkedin-total')?.value).toBe(2);
    expect(data.kpis.find(k => k.id === 'applications-total')?.value).toBe(1);
  });
  it('closes an interview when a newer generic application state says rejected', () => {
    const interview = record({ id: 'interview', actionType: 'interview', entityKey: 'application:clinic:engineer', timestamp: '2026-11-10', status: 'pending', metadata: { stage: 'Interview scheduled' } });
    const closed = record({ ...interview, id: 'closed', actionType: 'job_application', timestamp: '2026-11-14', status: 'failed', recordKind: 'snapshot', metadata: { stage: 'Rejected' } });
    const data = buildDashboard([interview, closed], [], { now });
    expect(data.kpis.find(k => k.id === 'interviews')?.value).toBe(0);
    expect(data.entities.interviews[0].id).toBe('closed'); expect(data.stale).toEqual([]);
  });
  it('orders real instants and explicit movement dates instead of ISO strings', () => {
    const earlier = record({ id: 'earlier', actionType: 'dental_lead', status: 'pending', timestamp: '2026-11-15T14:00:00+05:00', metadata: { stage: 'Contacted' } });
    const later = record({ ...earlier, id: 'later', timestamp: '2026-11-15T10:00:00Z', metadata: { stage: 'Replied' } });
    expect(buildDashboard([earlier, later], [], { now }).entities.dental[0].id).toBe('later');
    const updated = record({ ...earlier, id: 'updated', timestamp: '2026-11-10', metadata: { updatedAt: '2026-11-15', stage: 'Meeting' } });
    expect(buildDashboard([{ ...earlier, timestamp: '2026-11-14' }, updated], [], { now }).entities.dental[0].id).toBe('updated');
  });
  it('uses the latest movement when an assessment progresses to an interview', () => {
    const assessment = record({ id: 'assessment', actionType: 'assessment', entityKey: 'application:clinic:engineer', recordKind: 'snapshot', timestamp: '2026-11-10', status: 'pending', metadata: { stage: 'Assessment pending' } });
    const interview = record({ ...assessment, id: 'interview', actionType: 'interview', timestamp: '2026-11-15', metadata: { stage: 'Interview scheduled' } });
    const data = buildDashboard([assessment, interview], [], { now });
    expect(data.kpis.find(k => k.id === 'assessments')?.value).toBe(0);
    expect(data.stale).toEqual([]);
    expect(data.entities.assessments[0].id).toBe('interview');
  });
});

describe('output verification', () => {
  it('red-flags successful run claims without matching output, including URL-only claims', () => {
    const run = record({ actionType: 'run', outputLink: 'https://example.com/report', source: { path: 'api:Rio' } });
    expect(verificationFlags([run])).toHaveLength(1);
    expect(verificationFlags([record({ actionType: 'summary', recordKind: 'summary', status: 'success' })])).toHaveLength(1);
  });
  it('matches explicit output records to the same agent run', () => {
    const run = record({ id: 'run', actionType: 'run', source: { path: 'api:Rio' } });
    const output = record({ id: 'out', actionType: 'output', metadata: { runId: 'run', content: 'Delivered contact sheet: Amina at Clinic.' }, source: { path: 'api:Rio' } });
    expect(verificationFlags([run, output])).toEqual([]);
    expect(verificationFlags([run, { ...output, agent: 'Other' }]).some(v => v.recordId === 'run')).toBe(true);
  });
  it('does not accept a success assertion in a source excerpt or an empty output claim as proof', () => {
    expect(verificationFlags([record()])).toHaveLength(1);
    const run = record({ id: 'run', actionType: 'run' });
    const output = record({ id: 'out', actionType: 'output', metadata: { runId: 'run' } });
    expect(verificationFlags([run, output]).some(v => v.recordId === 'run')).toBe(true);
    expect(verificationFlags([output]).some(v => v.recordId === 'out')).toBe(true);
  });
  it('accepts an existing readable artifact within allowed roots, rejects missing paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'control-proof-')); const file = join(dir, 'proof.txt'); writeFileSync(file, 'output');
    try {
      expect(verificationFlags([record({ actionType: 'run', outputLink: file })], [dir])).toEqual([]);
      expect(verificationFlags([record({ actionType: 'run', outputLink: join(dir, 'gone.txt') })], [dir])).toHaveLength(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
