import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../server/dashboard.js';
import { moduleSummaries, parseRoute, routeHref, staleIn } from '../src/modules.js';
import type { ExecutionRecord } from '../shared/types.js';

const now = new Date('2026-11-15T12:00:00Z');
let n = 0;
function rec(p: Partial<ExecutionRecord>): ExecutionRecord {
  n++;
  return { id: `r${n}`, agent: 'Rio', timestamp: '2026-11-14', actionType: 'job_application', target: `Co${n} — Role`, detail: `d${n}`, status: 'success', outputLink: null, source: { path: '/x.md', line: n, excerpt: `e${n}` }, entityKey: `application:co${n}`, recordKind: 'execution', metadata: {}, ...p };
}

describe('routes', () => {
  it('resolves hash routes, legacy anchors and unknown values', () => {
    expect(parseRoute('#/applications')).toBe('applications');
    expect(parseRoute('#linkedin')).toBe('linkedin');
    expect(parseRoute('#pipelines')).toBe('interviews');
    expect(parseRoute('#activity')).toBe('agents');
    expect(parseRoute('')).toBe('overview');
    expect(parseRoute('#/nonsense')).toBe('overview');
    expect(routeHref('dental')).toBe('#/dental');
  });
});

describe('module summaries', () => {
  it('never invents data: every module is empty for an empty workspace', () => {
    const summaries = moduleSummaries(buildDashboard([], [], { now }));
    for (const s of summaries) expect(s.tone === 'empty' || s.id === 'agents').toBe(true);
    expect(summaries.filter(s => s.id !== 'agents').every(s => s.value === null && s.detail === 'No data recorded')).toBe(true);
  });

  it('builds per-day application bars and stage funnel from recorded applications only', () => {
    const data = buildDashboard([
      rec({ timestamp: '2026-11-14' }), rec({ timestamp: '2026-11-14' }), rec({ timestamp: '2026-11-13' }),
      rec({ timestamp: null }),
      rec({ actionType: 'interview', recordKind: 'snapshot', timestamp: '2026-11-01', metadata: { stage: 'Interview scheduled' }, entityKey: 'application:acme — eng', target: 'Acme — Eng' }),
    ], [], { now });
    const byDate = Object.fromEntries(data.applicationsDaily.map(d => [d.date, d.count]));
    expect(byDate['2026-11-14']).toBe(2); expect(byDate['2026-11-13']).toBe(1);
    expect(data.applicationsDaily).toHaveLength(14);
    expect(data.applicationStages.map(s => [s.stage, s.count])).toEqual([['Applied', 4], ['Screening', 0], ['Assessment', 0], ['Interview', 0], ['Offer', 0], ['Closed', 0]]);
    const apps = moduleSummaries(data).find(s => s.id === 'applications')!;
    expect(apps.value).toBe(4);
  });

  it('flags stale interviews in red-tone and counts alerts', () => {
    const data = buildDashboard([
      rec({ actionType: 'interview', recordKind: 'snapshot', timestamp: '2026-11-01', metadata: { stage: 'Interview', waitingOn: 'Recruiter' }, target: 'Acme — Eng', entityKey: 'interview:acme' }),
    ], [], { now });
    const s = moduleSummaries(data).find(m => m.id === 'interviews')!;
    expect(s.alerts).toBe(1); expect(s.tone).toBe('alert');
    expect(staleIn(data, data.entities.interviews.map(r => r.id))[0].waitingOn).toBe('Recruiter');
  });

  it('shows social only when per-platform records exist', () => {
    const data = buildDashboard([rec({ actionType: 'social_post', recordKind: 'snapshot', status: 'blocked', metadata: { platform: 'Instagram' }, target: 'Post', entityKey: 'social:instagram:post' })], [], { now });
    const s = moduleSummaries(data).find(m => m.id === 'social')!;
    expect(s.value).toBe(0); expect(s.alerts).toBe(1); expect(s.detail).toContain('1 blocked');
  });
});
