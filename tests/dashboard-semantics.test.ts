import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../server/dashboard.js';
import { normalizeStage } from '../shared/stages.js';
import type { ExecutionRecord } from '../shared/types.js';

const now = new Date('2026-11-15T12:00:00Z');
let n = 0;
function rec(p: Partial<ExecutionRecord>): ExecutionRecord {
  n++;
  return { id: `s${n}`, agent: 'Rio', timestamp: '2026-11-14', actionType: 'job_application', target: `Co${n} — Role`, detail: `d${n}`, status: 'unknown', outputLink: null, source: { path: '/x.md', line: n, excerpt: `e${n}` }, entityKey: `application:co${n}`, recordKind: 'execution', metadata: {}, ...p };
}

describe('stage normalisation', () => {
  it.each([
    ['Applied Nov 12', 'Applied'], ['Watching (submitted)', 'Applied'], ['', 'Applied'],
    ['INTERVIEW HELD Fri Nov 13, 18:30 PKT', 'Interview'], ['Survey + intro video SUBMITTED', 'Assessment'], ['Take-home test', 'Assessment'],
    ['Recruiter screen', 'Screening'], ['Offer received', 'Offer'], ['Rejected after interview', 'Closed'], ['Withdrawn', 'Closed'],
    ['no offer yet, applied', 'Applied'],
  ])('%s -> %s', (text, stage) => expect(normalizeStage(text)).toBe(stage));
  it('falls back to the given stage for unrecognised text', () => expect(normalizeStage('???', 'Interview')).toBe('Interview'));
});

describe('applications are one concept with a real date series', () => {
  it('counts distinct companies once and charts unknown-status dated rows', () => {
    const data = buildDashboard([
      rec({ timestamp: '2026-11-15', entityKey: 'application:a' }), rec({ timestamp: '2026-11-15', entityKey: 'application:a', detail: 'dup' }),
      rec({ timestamp: '2026-11-14' }), rec({ timestamp: '2026-11-13', metadata: { stage: 'Applied Nov 13' } }), rec({ timestamp: '2026-11-12' }), rec({ timestamp: null }),
    ], [], { now });
    expect(data.kpis.find(k => k.id === 'applications-total')?.value).toBe(5);
    expect(data.kpis.find(k => k.id === 'applications-week')?.value).toBe(4);
    expect(data.applicationsDaily.filter(d => d.count).map(d => [d.date, d.count])).toEqual([['2026-11-12', 1], ['2026-11-13', 1], ['2026-11-14', 1], ['2026-11-15', 1]]);
    expect(data.applicationStages.find(s => s.stage === 'Applied')?.count).toBe(5);
    expect(data.applicationStages.some(s => /unknown/i.test(s.stage))).toBe(false);
  });
});

describe('attention counts only actionable items', () => {
  it('ignores verification flags, old social history and closed work', () => {
    const records = [
      ...Array.from({ length: 20 }, () => rec({ status: 'success' })), // unverified successes
      rec({ actionType: 'social_post', recordKind: 'snapshot', status: 'blocked', timestamp: '2026-10-01', metadata: { platform: 'Instagram' }, entityKey: 'social:ig:old' }),
      rec({ actionType: 'social_post', recordKind: 'snapshot', status: 'blocked', timestamp: '2026-11-15', metadata: { platform: 'Instagram' }, entityKey: 'social:ig:today' }),
      rec({ actionType: 'interview', recordKind: 'snapshot', timestamp: '2026-11-01', metadata: { stage: 'Interview' }, entityKey: 'application:open' }),
      rec({ actionType: 'interview', recordKind: 'snapshot', timestamp: '2026-11-01', metadata: { stage: 'Rejected' }, entityKey: 'application:closed' }),
      rec({ actionType: 'run', status: 'failed', entityKey: 'run:1' }),
    ];
    const data = buildDashboard(records, [], { now });
    expect(data.verification.length).toBeGreaterThan(10);
    expect(data.attention.map(a => a.kind).sort()).toEqual(['blocked', 'failed', 'stale']);
  });
});

describe('social windows, linkedin counting, today strip', () => {
  it('only counts recent social days in headline numbers and keeps history reachable', () => {
    const slot = (timestamp: string, status: ExecutionRecord['status'], key: string) => rec({ actionType: 'social_post', recordKind: 'snapshot', status, timestamp, metadata: { platform: 'Instagram' }, entityKey: `social:ig:${key}` });
    const data = buildDashboard([slot('2026-11-13', 'published', 'a'), slot('2026-11-16', 'planned', 'b'), slot('2026-10-01', 'blocked', 'c'), slot('2026-10-02', 'planned', 'd')], [], { now });
    const ig = data.socialPlatforms[0];
    expect([ig.published, ig.planned, ig.blocked, ig.older]).toEqual([1, 1, 0, 2]);
    expect(ig.recordIds).toHaveLength(4);
  });
  it('counts every parsed LinkedIn touch except planned or failed ones, and feeds Today', () => {
    const li = (id: string, status: ExecutionRecord['status'], ts = '2026-11-15') => rec({ actionType: 'linkedin_touch', status, timestamp: ts, entityKey: `linkedin:${id}`, metadata: { touchType: 'comment' }, detail: id });
    const data = buildDashboard([li('a', 'success'), li('b', 'unknown'), li('c', 'planned'), li('d', 'failed'), li('e', 'success', '2026-11-10')], [], { now });
    expect(data.kpis.find(k => k.id === 'linkedin-total')?.value).toBe(3);
    expect(data.today.items.find(i => i.key === 'linkedin')?.count).toBe(2);
  });
});
