import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { importRio } from '../server/importers.js';
import { buildDashboard } from '../server/dashboard.js';

let home: string;
const now = new Date('2026-11-15T12:00:00Z');

async function fixture(path: string, content: string | Uint8Array) {
  const absolute = join(home, path);
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, content);
  return absolute;
}

beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'rio-dashboard-integration-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

it('projects Rio-format source rows into traceable dashboard sections', async () => {
  const ledger = await fixture('job-hunt/OPPORTUNITY-LEDGER.md',
    '## Employer in motion\n| Opportunity | Value | Next step | Owner | Deadline / status |\n|---|---|---|---|---|\n| WarriorBabe — AI Specialist | Remote role | Survey + intro video SUBMITTED Nov 11; awaiting outcome | Rio (watch) | Submitted Nov 11 |\n');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Live priorities');
  sheet.addRow(['LIVE — sorted by priority. Score = stage']);
  sheet.addRow(['Priority', 'Score', 'Opportunity', 'Stage', 'Salary (as stated)', 'Hire likelihood', 'Deadline', 'Next step', 'Owner']);
  sheet.addRow([1, 100, 'IZ Global — AI Voice Dialer', 'INTERVIEW HELD Fri Nov 13, 18:30 PKT', 'Ask PKR 140,000/mo', 'High', 'Held Nov 13', 'Watch inbox for follow-up', 'Qarib']);
  const tracker = await fixture('job-hunt/opportunity-tracker.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()));

  const linkedin = await fixture('linkedin/log.md',
    '## 2026-10-09 — 3 posted\n- 08:08 PKT | Stephen McGhee (Founder, Acme) | Post: "summary" — detail | thoughtful (type 4) | liked + commented | https://www.linkedin.com/feed/update/example\n- Sweep notes (nothing sent)\n');
  await fixture('deliveries/2026-11-15/PLAN.md',
    '# PLAN\n## 07:00 — IG-1115-0700 (Instagram reel) — BLOCKED\nAwaiting approval.\n## 12:00 — LI-1115-1200 (LinkedIn post) — READY\nCaption ready.\n## 18:00 — IG-1115-1800 (Instagram carousel) — PUBLISHED\nPublished at https://example.test/post\n');
  const actualMemory = await fixture('memory/2026-11-15.md', '# Daily summary\nCompleted a review.\n');
  await mkdir(join(home, 'rio-view/memory'), { recursive: true });
  const memory = join(home, 'rio-view/memory/2026-11-15.md');
  await symlink(actualMemory, memory);

  const imported = await importRio({ home, now, paths: {
    opportunities: ledger,
    workbook: tracker,
    linkedin,
    social: join(home, 'deliveries/*/PLAN.md'),
    memory: join(home, 'rio-view/memory/????-??-??.md'),
  } });
  const dashboard = buildDashboard(imported.records, imported.sources, { now });

  expect(dashboard.entities.assessments.some(r => r.target === 'WarriorBabe — AI Specialist' && r.source.path === ledger && r.timestamp === null)).toBe(true);
  expect(dashboard.entities.interviews.some(r => r.target === 'IZ Global — AI Voice Dialer' && r.source.path === tracker && r.timestamp === null)).toBe(true);
  expect(dashboard.kpis.find(k => k.id === 'linkedin-total')?.value).toBe(1);
  expect(dashboard.records.find(r => r.actionType === 'linkedin_touch')).toMatchObject({ target: 'Stephen McGhee', source: { path: linkedin, line: 2 } });
  expect(dashboard.entities.social).toHaveLength(3);
  expect(dashboard.socialPlatforms.find(p => p.platform === 'Instagram')).toMatchObject({ planned: 0, published: 1, blocked: 1 });
  expect(dashboard.socialPlatforms.find(p => p.platform === 'LinkedIn')).toMatchObject({ planned: 1, published: 0, blocked: 0 });
  expect(dashboard.records.find(r => r.actionType === 'summary' && r.source.path === memory)).toMatchObject({ timestamp: '2026-11-15', source: { path: memory } });
  expect(imported.sources.find(s => s.kind === 'social')).toMatchObject({ path: join(home, 'deliveries/*/PLAN.md'), status: 'ok', records: 3 });
});
