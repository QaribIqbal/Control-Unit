import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importRio } from '../server/importers.js';
import { buildDashboard } from '../server/dashboard.js';
import { validateSnapshot } from '../server/sync.js';

const now = new Date('2026-11-16T12:00:00Z');

describe('clean application submissions', () => {
  it('counts only explicit submitted status cells in the applied log, one record per row', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clean-submissions-'));
    try {
      const path = join(dir, 'custom-application-log.md');
      const statuses = ['SUBMITTED', 'Submitted — awaiting response', 'APPLIED', 'Application sent', 'SKIPPED', 'BOARD SCAN', 'HR EMAILED', 'Pending', 'Not submitted', 'Unsubmitted', 'Submission pending', ''];
      await writeFile(path, '| Date | Company | Role | Status |\n|---|---|---|---|\n' + statuses.map((status, i) => `| 2026-11-16 | ${i < 2 ? 'Same Co' : `Company ${i}`} | Engineer | ${status} |`).join('\n'));
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      const snapshot = validateSnapshot({ collectorId: 'rio-test', records: imported.records, sources: imported.sources });
      const otherSource = { ...snapshot.records[0], id: 'other-source', source: { path: '/other/log.md' }, metadata: { ...snapshot.records[0].metadata, appStatus: 'SUBMITTED' } };
      const data = buildDashboard([...snapshot.records, otherSource], snapshot.sources, { now });
      expect(data.today.items.find(item => item.key === 'applications')?.label).toBe('Application activity');
      const kpi = data.kpis.find(k => k.id === 'applications-clean')!;
      expect(kpi.value).toBe(4);
      expect(kpi.recordIds).toHaveLength(4);
      expect(snapshot.records.filter(r => kpi.recordIds.includes(r.id)).map(r => r.metadata.appStatus)).toEqual(statuses.slice(0, 4));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('reports no data when the source is missing or any old record lacks status evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clean-submissions-old-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, '| Company | Role | Status |\n|---|---|---|\n| Co | Engineer | SUBMITTED |\n');
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      const legacy = imported.records.map(r => { const metadata = { ...r.metadata }; delete metadata.appStatus; return { ...r, metadata }; });
      const absentStatuses = imported.records.map(r => ({ ...r, metadata: { ...r.metadata, appStatus: '' } }));
      expect(buildDashboard(legacy, imported.sources, { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBeNull();
      expect(buildDashboard(absentStatuses, imported.sources, { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBeNull();
      expect(buildDashboard([...legacy, ...imported.records], imported.sources, { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBeNull();
      expect(buildDashboard(imported.records, [], { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('supports application source globs and reports missing status headers as unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clean-submissions-glob-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, '| Company | Role | Status |\n|---|---|---|\n| Co | Engineer | SUBMITTED |\n');
      const imported = await importRio({ home: dir, paths: { applications: join(dir, '*.md') }, now });
      expect(buildDashboard(imported.records, imported.sources, { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBe(1);
      await writeFile(path, '| Company | Role |\n|---|---|\n| Co | Engineer |\n');
      const missing = await importRio({ home: dir, paths: { applications: join(dir, '*.md') }, now });
      expect(buildDashboard(missing.records, missing.sources, { now }).kpis.find(k => k.id === 'applications-clean')?.value).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('counts explicit submitted table rows when other parsed rows have no status field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clean-submissions-mixed-'));
    try {
      const path = join(dir, 'applied-log.md');
      await writeFile(path, '| Company | Role | Status |\n|---|---|---|\n| Co | Engineer | SUBMITTED |\n\n- Applied to Other Co\n\n| Company | Role |\n|---|---|\n| Third Co | Analyst |\n');
      const imported = await importRio({ home: dir, paths: { applications: path }, now });
      expect(imported.records.filter(r => r.actionType === 'job_application')).toHaveLength(3);
      const kpi = buildDashboard(imported.records, imported.sources, { now }).kpis.find(k => k.id === 'applications-clean')!;
      expect(kpi.value).toBe(1);
      expect(kpi.recordIds).toEqual([imported.records[0].id]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
