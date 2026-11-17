import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildDashboard } from '../server/dashboard.js';
import { Applications, applicationRows, applicationStatus } from '../src/pages/Applications.js';
import { Overview } from '../src/pages/Overview.js';
import { moduleSummaries } from '../src/modules.js';
import type { ExecutionRecord } from '../shared/types.js';

function record(id: string): ExecutionRecord {
  return { id, agent: 'Rio', timestamp: '2026-11-14', actionType: 'job_application', target: `${id} — Role`, detail: '', status: 'success', outputLink: null, source: { path: '/applied-log.md', line: 1 }, entityKey: `application:${id}`, recordKind: 'execution', metadata: {} };
}

function fixture() {
  const data = buildDashboard([{ ...record('submitted'), metadata: { appStatus: 'SUBMITTED' } }, { ...record('skipped'), metadata: { appStatus: 'SKIPPED' } }], [], { now: new Date('2026-11-16T12:00:00Z') });
  data.kpis = data.kpis.filter(k => k.id !== 'applications-clean');
  data.kpis.push({ id: 'applications-clean', label: 'Clean submissions', value: 1, recordIds: ['submitted'], description: 'Confirmed submissions' });
  return data;
}

describe('applications UI', () => {
  it('labels tracked roles separately from submitted applications and provides an accessible filter', () => {
    const data = fixture();
    const html = renderToStaticMarkup(<Applications data={data} open={() => {}} timezone="UTC" hosted={false} />);
    expect(html).toContain('Roles tracked');
    expect(html).toContain('Clean submissions');
    expect(html).toContain('Reconciled total');
    expect(html).toContain('Stated in log');
    expect(html).toContain('Submissions only');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('SKIPPED');
    expect(html).toContain('SUBMITTED');
    expect(html).toContain('Tracked / applied');
    expect(moduleSummaries(data).find(s => s.id === 'applications')?.caption).toBe('roles tracked');
  });

  it('shows the separate clean submissions metric on the overview', () => {
    const data = fixture();
    const html = renderToStaticMarkup(<Overview data={data} open={() => {}} timezone="UTC" hosted={false} />);
    expect(html).toContain('Clean submissions');
    expect(html).toContain('roles tracked');
  });

  it('does not turn a legacy success into an assumed submission', () => {
    expect(applicationStatus(record('legacy'))).toBe('Status not recorded');
    expect(applicationStatus({ ...record('staged'), metadata: { stage: 'Interview' } })).toBe('Interview');
  });

  it('shows unavailable rather than zero and disables the filter without status evidence', () => {
    const data = fixture();
    const clean = data.kpis.find(k => k.id === 'applications-clean')!;
    clean.value = null;
    clean.recordIds = [];
    const html = renderToStaticMarkup(<Applications data={data} open={() => {}} timezone="UTC" hosted={false} />);
    expect(html).toContain('Submission status is not available yet.');
    expect(html).toMatch(/class="submissions-filter" aria-pressed="false" disabled=""/);
    const overview = renderToStaticMarkup(<Overview data={data} open={() => {}} timezone="UTC" hosted={false} />);
    expect(overview).toContain('Clean submissions</span><strong>No data recorded</strong>');
  });

  it('shows every matching submission even when multiple records share one role', () => {
    const a = { ...record('first'), entityKey: 'application:shared' };
    const b = { ...record('second'), entityKey: 'application:shared' };
    const data = buildDashboard([a, b], [], { now: new Date('2026-11-16T12:00:00Z') });
    data.kpis = data.kpis.filter(k => k.id !== 'applications-clean');
    data.kpis.push({ id: 'applications-clean', label: 'Clean submissions', value: 2, recordIds: ['first', 'second'], description: '' });
    expect(data.entities.applications).toHaveLength(1);
    expect(applicationRows(data, true).map(r => r.id).sort()).toEqual(['first', 'second']);
  });

  it('uses the exact clean KPI records for the submissions-only list', () => {
    const data = fixture();
    expect(applicationRows(data, false).map(r => r.id).sort()).toEqual(['skipped', 'submitted']);
    expect(applicationRows(data, true).map(r => r.id)).toEqual(['submitted']);
  });
});
