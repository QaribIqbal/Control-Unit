import { describe, expect, it } from 'vitest';
import { buildDashboard } from '../server/dashboard.js';
import { normalizeStage } from '../shared/stages.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importRio } from '../server/importers.js';
import { validateSnapshot } from '../server/sync.js';
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

describe('interview/assessment records keep their stage floor', () => {
  it('does not show loose status text as Applied in the pipeline funnel', () => {
    const data = buildDashboard([
      rec({ actionType: 'interview', recordKind: 'snapshot', metadata: { stage: 'Waiting' }, entityKey: 'application:a' }),
      rec({ actionType: 'assessment', recordKind: 'snapshot', metadata: { stage: 'pending' }, entityKey: 'application:b' }),
      rec({ actionType: 'job_application', recordKind: 'snapshot', metadata: { stage: 'Watching (submitted)' }, entityKey: 'application:c' }),
    ], [], { now });
    const count = (stage: string) => data.pipelineStages.find(s => s.stage === stage)?.count;
    expect([count('Interview'), count('Assessment'), count('Applied')]).toEqual([1, 1, 0]);
    expect(data.entities.interviews).toHaveLength(1); // the watching row is an application, not an interview
  });
});

describe('regression: dated applications reach the daily series end to end', () => {
  it('buckets every dated row of a multi-day log, including pending/awaiting statuses, after a sync round trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apps-log-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, `# Applied log\n| Date | Company | Role | Platform | Status |\n|---|---|---|---|---|\n` + [
        ['2026-11-15', 'Acme', 'Engineer', 'Applied'], ['2026-11-15', 'Acme2', 'Engineer', 'Pending'],
        ['2026-11-14', 'Beta', 'Designer', 'Submitted — awaiting response'], ['2026-11-13', 'Gamma', 'PM', 'Applied, no reply yet'],
        ['2026-11-12', 'Delta', 'Dev', 'Applied (confirmation email)'], ['2026-11-11', 'Eps', 'QA', ''],
        ['2026-11-11', 'Zed', 'QA', 'Not submitted yet'], ['2026-10-01', 'Old', 'Ops', 'Applied'],
      ].map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | Site | ${r[3]} |`).join('\n') + '\n');
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      const snapshot = validateSnapshot({ collectorId: 'rio-test', records: imported.records, sources: imported.sources.filter(s => s.kind === 'applications') });
      const data = buildDashboard(snapshot.records, snapshot.sources, { now });
      const byDate = Object.fromEntries(data.applicationsDaily.filter(d => d.count).map(d => [d.date, d.count]));
      expect(byDate).toEqual({ '2026-11-11': 1, '2026-11-12': 1, '2026-11-13': 1, '2026-11-14': 1, '2026-11-15': 2 });
      expect(data.kpis.find(k => k.id === 'applications-week')?.value).toBe(6);
      expect(data.kpis.find(k => k.id === 'applications-total')?.value).toBe(8);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('regression: applied-log blocks after blank lines are read', () => {
  it('keeps the active header across blank lines so later November rows reach the day series', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apps-blocks-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, [
        '# Applied log', '', 'Notes before the table.',
        '| Date | Job | Company | Source | Status | Notes |', '|---|---|---|---|---|---|',
        '| 2026-10-05 | Engineer | Early Co | LinkedIn | Applied | |',
        '| 2026-10-06 | Analyst | Second Co | Site | Applied | |',
        '',
        '| 2026-11-13 | Designer | Later Co | Site | Applied | |',
        '| 2026-11-14 | PM | Latest Co | Site | Submitted | |',
        '',
        '## Week of Nov 15',
        '| 2026-11-15 | QA | Today Co | Site | Applied | |',
      ].join('\n'));
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      const report = imported.sources.find(s => s.kind === 'applications')!;
      expect(report.records).toBe(5);
      expect(report.skipped).toBe(0);
      expect(imported.records.find(r => r.metadata.company === 'Later Co')).toMatchObject({ timestamp: '2026-11-13', metadata: { role: 'Designer' } });
      const data = buildDashboard(imported.records, imported.sources, { now });
      const byDate = Object.fromEntries(data.applicationsDaily.filter(d => d.count).map(d => [d.date, d.count]));
      expect(byDate).toEqual({ '2026-11-13': 1, '2026-11-14': 1, '2026-11-15': 1 });
      expect(data.kpis.find(k => k.id === 'applications-total')?.value).toBe(5);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('reports pipe rows with no header above them instead of silently dropping them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apps-orphan-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, '# Log\n| 2026-11-13 | Designer | Orphan Co | Site | Applied | |\n');
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      const report = imported.sources.find(s => s.kind === 'applications')!;
      expect(report.skipped).toBe(1);
      expect(report.message).toContain('no header row above it');
      expect(report.message).toContain('Orphan Co');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('does not reinterpret timed LinkedIn bullets as rows of an earlier table', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'li-table-'));
    try {
      const path = join(dir, 'log.md');
      await writeFile(path, '| Week | Total |\n|---|---|\n| 46 | 3 |\n\n## 2026-11-14\n- 08:04 PKT | Ana Lee (CEO, Acme) | Post: "x" | thoughtful | liked + commented | n/a\n');
      const imported = await importRio({ home: dir, paths: { linkedin: path }, now });
      expect(imported.records.filter(r => r.actionType === 'linkedin_touch').map(r => r.target)).toEqual(['Ana Lee']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
