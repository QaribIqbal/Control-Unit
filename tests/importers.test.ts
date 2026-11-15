import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { importInbox, importRio } from '../server/importers.js';
import { normalizeExecution } from '../server/model.js';

let home: string;
const now = new Date('2026-11-15T12:00:00Z');
async function file(path: string, text: string | Uint8Array) {
  const full = join(home, path); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, text); return full;
}
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'rio-import-test-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe('read-only Rio imports', () => {
  it('names the file and quotes the line for each skipped entry in a multi-file source', async () => {
    await file('d/2026-11-01/PLAN.md', '# Plan\n- some stray note about nothing\n');
    await file('d/2026-11-02/PLAN.md', '# Plan\n- another stray note\n');
    const result = await importRio({ home, paths: { social: join(home, 'd/*/PLAN.md') }, now });
    const message = result.sources.find(s => s.kind === 'social')!.message;
    expect(message).toContain('2026-11-01/PLAN.md line 2');
    expect(message).toContain('"- some stray note about nothing"');
    expect(message).toContain('2026-11-02/PLAN.md line 2');
  });

  it('truncates oversized daily memory summaries so snapshots stay valid', async () => {
    const path = await file('memory/2026-11-14.md', `# Daily\n${'x'.repeat(170000)}\n`);
    const result = await importRio({ home, paths: { memory: path }, now });
    expect(result.records).toHaveLength(1);
    const rec = result.records[0];
    expect(rec.detail.length).toBeLessThan(5000);
    expect(rec.detail).toContain('truncated');
    expect((rec.source.excerpt || '').length).toBeLessThan(5000);
    expect(() => normalizeExecution(rec)).not.toThrow();
  });

  it('reports every absent path without fabricating records', async () => {
    const result = await importRio({ home, now });
    expect(result.records).toEqual([]);
    expect(result.sources).toHaveLength(7);
    expect(result.sources.every(s => s.status === 'missing' && s.records === 0)).toBe(true);
  });

  it('parses messy application tables, preserves provenance and never completes planned touches', async () => {
    const path = await file('apps.md', `# Applications\n## 14 November 2026\n| Company | Position | Action | Contact | State | Output |\n| --- | --- | --- | --- | --- | --- |\n| Acme | Engineer | Applied | | Submitted | [proof](https://example.test/a) |\n| Acme | Engineer | LinkedIn outreach | Ana | Planned | |\n| Broken | too few |\n| Total | 14 applications | | | | |\n\n- Sent LinkedIn message to Ben — company: Beta\n- Plan LinkedIn message to Cara\n- Total: 24 contacts sent\n`);
    const result = await importRio({ home, paths: { applications: path }, now });
    const app = result.records.find(r => r.actionType === 'job_application');
    expect(app).toMatchObject({ target: 'Acme — Engineer', timestamp: '2026-11-14', status: 'success', source: { path, line: 5 }, metadata: { company: 'Acme', role: 'Engineer' } });
    expect(app?.outputLink).toBe('https://example.test/a');
    const touches = result.records.filter(r => r.actionType === 'linkedin_touch');
    expect(touches).toHaveLength(3);
    expect(touches.find(r => r.target === 'Ana')?.status).toBe('planned');
    expect(touches.find(r => r.target === 'Ben')?.status).toBe('success');
    expect(touches.find(r => r.target === 'Cara')?.status).toBe('planned');
    expect(result.records.filter(r => r.recordKind === 'summary')).toHaveLength(1);
    expect(result.sources.find(s => s.path === path)?.skipped).toBeGreaterThan(0);
    expect(result.sources.find(s => s.path === path)?.message).toContain('line 7');
    expect(result.records.map(r => r.id)).toEqual((await importRio({ home, paths: { applications: path }, now: new Date('2026-11-16') })).records.map(r => r.id));
  });

  it('keeps missing and impossible dates unknown, including in memory summaries', async () => {
    const log = await file('linkedin.md', `| Person | Action | Date |\n| --- | --- | --- |\n| Alice | Sent message | 2026-02-30 |\n| Bob | Pending message | 03/04/2026 |\n| Cara | Sent connection | |\n`);
    await file('memory/2026-11-13.md', '# Daily memory\nSent 42 messages.\nApplied to 9 jobs.\n');
    const result = await importRio({ home, paths: { linkedin: log }, now });
    expect(result.records.filter(r => r.actionType === 'linkedin_touch')).toHaveLength(3);
    expect(result.records.filter(r => r.actionType === 'linkedin_touch').every(r => r.timestamp === null)).toBe(true);
    expect(result.records.find(r => r.target === 'Bob')?.status).toBe('pending');
    expect(result.records.find(r => r.actionType === 'summary')).toMatchObject({ timestamp: '2026-11-13', recordKind: 'summary' });
  });

  it('imports actual XLSX snapshots and shares opportunity entity keys across sources without source writes', async () => {
    const ledger = await file('ledger.md', '| Company | Role | Stage | Updated | Waiting on |\n| --- | --- | --- | --- | --- |\n| Acme | Engineer | Interview scheduled | 2026-11-12 | Recruiter |\n');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Opportunities');
    sheet.addRow(['Company', 'Position', 'Stage', 'Updated at', 'Assessment link']);
    sheet.addRow(['Acme', 'Engineer', 'Interview scheduled', new Date('2026-11-14T00:00:00Z'), '']);
    sheet.addRow(['Beta', 'Developer', 'Assessment pending', null, { text: 'Take-home', hyperlink: 'https://example.test/test' }]);
    sheet.addRow(['Total', 2, '', '', '']);
    sheet.addRow(['', '', 'bad row']);
    const xlsx = await file('tracker.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()));
    const before = createHash('sha256').update(await readFile(xlsx)).update(await readFile(ledger)).digest('hex');
    const result = await importRio({ home, paths: { opportunities: ledger, workbook: xlsx }, now });
    const acme = result.records.filter(r => r.metadata.company === 'Acme');
    expect(acme).toHaveLength(2);
    expect(new Set(acme.map(r => r.entityKey)).size).toBe(1);
    expect(acme.every(r => r.recordKind === 'snapshot' && r.actionType === 'interview')).toBe(true);
    expect(acme.find(r => r.source.sheet)?.source).toMatchObject({ path: xlsx, sheet: 'Opportunities', row: 2 });
    expect(result.records.find(r => r.metadata.company === 'Beta')).toMatchObject({ actionType: 'assessment', status: 'pending', timestamp: null, outputLink: 'https://example.test/test' });
    expect(createHash('sha256').update(await readFile(xlsx)).update(await readFile(ledger)).digest('hex')).toBe(before);
  });

  it('keeps dental and per-platform post states conservative', async () => {
    const dental = await file('dental.md', '| Practice | Stage | Waiting for | Date |\n| --- | --- | --- | --- |\n| Bright Dental | Awaiting response | Owner | 2026-11-10 |\n| Total leads | 12 | | |\n');
    await file('deliveries/batch/PLAN.md', '# Content plan\n## 2026-11-14\n| Title | Platform | Status | URL |\n| --- | --- | --- | --- |\n| Useful tips | LinkedIn | Planned | |\n| Useful tips | Instagram | Published | https://example.test/post |\n\n- 8 posts published this week\n');
    const result = await importRio({ home, paths: { dental, social: join(home, 'deliveries/*/PLAN.md') }, now });
    expect(result.records.find(r => r.actionType === 'dental_lead')).toMatchObject({ target: 'Bright Dental', metadata: { stage: 'Awaiting response', waitingFor: 'Owner' } });
    const posts = result.records.filter(r => r.actionType === 'social_post');
    expect(posts).toHaveLength(2);
    expect(posts.map(r => [r.metadata.platform, r.status])).toEqual([['LinkedIn', 'planned'], ['Instagram', 'published']]);
  });

  it('imports Rio opportunity-ledger rows with an explicit opportunity and next move', async () => {
    const path = await file('OPPORTUNITY-LEDGER.md', `# Opportunity ledger\n## Employer in motion (highest value, act first)\n| Opportunity | Value | Next step | Owner | Deadline / status |\n|---|---|---|---|---|\n| WarriorBabe — AI Specialist | Remote role, pay unstated | Survey + intro video SUBMITTED Nov 11; awaiting outcome | Rio (watch) | Submitted Nov 11; invited Nov 6 |\n`);
    const result = await importRio({ home, paths: { opportunities: path }, now });
    const assessments = result.records.filter(r => r.actionType === 'assessment');
    expect(assessments).toHaveLength(1);
    expect(assessments[0]).toMatchObject({ target: 'WarriorBabe — AI Specialist', timestamp: null, recordKind: 'snapshot', source: { path, line: 5 }, metadata: { company: 'WarriorBabe', role: 'AI Specialist', waitingOn: 'Rio (watch)', waitingFor: 'Survey + intro video SUBMITTED Nov 11; awaiting outcome' } });
    expect(result.sources.find(s => s.path === path)?.records).toBe(1);
  });

  it('imports Rio tracker rows after a title line and its real header', async () => {
    const workbook = new ExcelJS.Workbook();
    for (const name of ['Live priorities', 'Watching (submitted)', 'Other gates', 'Closed']) workbook.addWorksheet(name);
    const sheet = workbook.getWorksheet('Live priorities')!;
    sheet.addRow(['LIVE — sorted by priority. Score = stage']);
    sheet.addRow(['Priority', 'Score', 'Opportunity', 'Stage', 'Salary (as stated)', 'Hire likelihood', 'Deadline', 'Next step', 'Owner']);
    sheet.addRow([1, 100, 'IZ Global — AI Voice Dialer', 'INTERVIEW HELD Fri Nov 13, 18:30 PKT', 'Ask PKR 140,000/mo, floor 120,000', 'High', 'Held Nov 13', 'Watch inbox for follow-up', 'Qarib']);
    const path = await file('opportunity-tracker.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()));
    const result = await importRio({ home, paths: { workbook: path }, now });
    const interviews = result.records.filter(r => r.actionType === 'interview');
    expect(interviews).toHaveLength(1);
    expect(interviews[0]).toMatchObject({ target: 'IZ Global — AI Voice Dialer', timestamp: null, recordKind: 'snapshot', source: { path, sheet: 'Live priorities', row: 3 }, metadata: { company: 'IZ Global', role: 'AI Voice Dialer', stage: 'INTERVIEW HELD Fri Nov 13, 18:30 PKT', waitingOn: 'Qarib', waitingFor: 'Watch inbox for follow-up' } });
    expect(result.sources.find(s => s.path === path)?.records).toBe(1);
  });

  it('imports timed LinkedIn activity bullets but not sweep notes', async () => {
    const path = await file('linkedin/log.md', `# LinkedIn log\n## 2026-10-09 — 3 posted\n- 08:08 PKT | Stephen McGhee (Founder, company) | Post: "post summary" — detail | thoughtful (type 4) | liked + commented | https://www.linkedin.com/feed/update/example\n- Sweep notes (nothing sent)\n`);
    const result = await importRio({ home, paths: { linkedin: path }, now });
    const touches = result.records.filter(r => r.actionType === 'linkedin_touch');
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ target: 'Stephen McGhee', timestamp: '2026-10-09', status: 'success', outputLink: 'https://www.linkedin.com/feed/update/example', source: { path, line: 3 }, metadata: { person: 'Stephen McGhee' } });
    expect(result.sources.find(s => s.path === path)?.records).toBe(1);
  });

  it('imports Rio daily PLAN slots as per-platform planned, blocked, and published posts', async () => {
    const path = await file('deliveries/2026-11-15/PLAN.md', `# PLAN\nStatus: one ready, one blocked, one published.\n## 07:00 — IG-1115-0700 (Instagram reel) — BLOCKED\nAwaiting approval from Qarib.\n## 12:00 — LI-1115-1200 (LinkedIn post) — READY\nCaption ready for review.\n## 18:00 — IG-1115-1800 (Instagram carousel) — PUBLISHED\nPublished at https://example.test/post\n`);
    const result = await importRio({ home, paths: { social: join(home, 'deliveries/*/PLAN.md') }, now });
    const posts = result.records.filter(r => r.actionType === 'social_post');
    expect(posts).toHaveLength(3);
    expect(posts.map(r => [r.metadata.platform, r.status])).toEqual([['Instagram', 'blocked'], ['LinkedIn', 'planned'], ['Instagram', 'published']]);
    expect(posts.every(r => r.timestamp === '2026-11-15')).toBe(true);
    expect(posts[0]).toMatchObject({ source: { path, line: 3 } });
    expect(posts[0].detail).toContain('Awaiting approval from Qarib');
    expect(posts[2].outputLink).toBe('https://example.test/post');
    expect(result.sources.find(s => s.kind === 'social')?.records).toBe(3);
  });

  it('does not treat a weekly PLAN directory date as the slot publication date', async () => {
    await file('deliveries/week-2026-10-06/PLAN.md', '## 07:00 — IG-week-0700 (Instagram reel) — PUBLISHED\nPublished at https://example.test/post\n');
    const result = await importRio({ home, paths: { social: join(home, 'deliveries/*/PLAN.md') }, now });
    expect(result.records.find(r => r.actionType === 'social_post')?.timestamp).toBeNull();
  });

  it('derives dental stages only from affirmative table cells, not daily aggregate bullets', async () => {
    const path = await file('cash-track/log.md', `# Cash track\n| Date | Channel | Clinic | Sent | Reply | Call booked | Sale |\n|---|---|---|---|---|---|---|\n| Thu Oct 8 | IG DM | Northside Clinic | yes | | | |\n| Fri Oct 9 | Email | Hill Dental | yes | replied | booked | |\n## Daily summary\n### Thu Oct 8\n- Sent: 5 IG DMs — clinic names...\n`);
    const result = await importRio({ home, paths: { dental: path }, now });
    const leads = result.records.filter(r => r.actionType === 'dental_lead');
    expect(leads).toHaveLength(2);
    expect(leads.map(r => [r.target, r.metadata.stage])).toEqual([['Northside Clinic', 'Sent'], ['Hill Dental', 'Call booked']]);
    expect(leads.every(r => r.timestamp === null)).toBe(true);
    expect(result.sources.find(s => s.path === path)?.records).toBe(2);
  });

  it('does not promote negated dental milestones or a waiting stage to success', async () => {
    const path = await file('cash-track/negated.md', `| Date | Channel | Clinic | Sent | Reply | Call booked | Sale |\n|---|---|---|---|---|---|---|\n| Thu Oct 8 | Email | Not Yet Clinic | yes | no reply | not booked | No sale |\n| Fri Oct 9 | Email | Placeholder Clinic | yes | unknown | ? | TBD |\n`);
    const waiting = await file('cash-track/waiting.md', `| Practice | Stage |\n|---|---|\n| Pending Clinic | Awaiting response |\n`);
    const result = await importRio({ home, paths: { dental: path }, now });
    const lead = result.records.find(r => r.target === 'Not Yet Clinic');
    expect(lead?.metadata.stage).toBe('Sent');
    expect(lead?.status).not.toBe('success');
    expect(result.records.find(r => r.target === 'Placeholder Clinic')?.metadata.stage).toBe('Sent');
    const waitingResult = await importRio({ home, paths: { dental: waiting }, now });
    expect(waitingResult.records.find(r => r.target === 'Pending Clinic')?.status).not.toBe('success');
  });

  it('prioritizes an explicit opportunity stage over future next-step verbs', async () => {
    const path = await file('OPPORTUNITY-LEDGER.md', `| Opportunity | Stage | Next step |\n|---|---|---|\n| Acme — Engineer | Interview scheduled | Complete take-home assessment later |\n| Beta — Analyst | Rejected | Submit a different application later |\n`);
    const result = await importRio({ home, paths: { opportunities: path }, now });
    const interview = result.records.find(r => r.target === 'Acme — Engineer');
    expect(interview?.actionType).toBe('interview');
    expect(interview?.metadata.stage).toBe('Interview scheduled');
    expect(result.records.find(r => r.target === 'Beta — Analyst')?.status).not.toBe('success');
  });

  it('keeps a rejected ledger deadline status failed despite a future next step', async () => {
    const path = await file('OPPORTUNITY-LEDGER.md', '| Opportunity | Next step | Deadline / status |\n|---|---|---|\n| Beta — Analyst | Follow up next week | Rejected |\n');
    const result = await importRio({ home, paths: { opportunities: path }, now });
    expect(result.records[0]).toMatchObject({ target: 'Beta — Analyst', status: 'failed' });
  });

  it('keeps the full role when an opportunity has multiple em dashes', async () => {
    const path = await file('OPPORTUNITY-LEDGER.md', `| Opportunity | Stage |\n|---|---|\n| Acme — Head of AI — Voice | Interview scheduled |\n`);
    const result = await importRio({ home, paths: { opportunities: path }, now });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ target: 'Acme — Head of AI — Voice', metadata: { company: 'Acme', role: 'Head of AI — Voice' } });
  });

  it('extracts the company from a timed LinkedIn entry parenthetical', async () => {
    const path = await file('linkedin/log.md', `## 2026-10-09\n- 08:08 PKT | Stephen McGhee (Founder, Acme) | Post: "summary" | thoughtful (type 4) | liked + commented | https://www.linkedin.com/feed/update/example\n`);
    const result = await importRio({ home, paths: { linkedin: path }, now });
    const touch = result.records.find(r => r.actionType === 'linkedin_touch');
    expect(touch).toMatchObject({ target: 'Stephen McGhee', metadata: { person: 'Stephen McGhee', company: 'Acme' } });
  });

  it('keeps the action and link when a LinkedIn post excerpt contains a pipe', async () => {
    const path = await file('linkedin/log.md', '## 2026-10-09\n- 08:08 PKT | Stephen McGhee (Founder, Acme) | Post: "A | B" — detail | thoughtful (type 4) | liked + commented | https://example.test/post\n');
    const result = await importRio({ home, paths: { linkedin: path }, now });
    expect(result.records.find(r => r.actionType === 'linkedin_touch')).toMatchObject({ status: 'success', outputLink: 'https://example.test/post', metadata: { touchType: 'comment' } });
  });

  it('counts a timed LinkedIn touch with an explicit missing URL cell', async () => {
    const path = await file('linkedin/log.md', '## 2026-10-09\n- 08:08 PKT | Stephen McGhee (Founder, Acme) | Post: summary | thoughtful (type 4) | liked + commented | N/A\n');
    const result = await importRio({ home, paths: { linkedin: path }, now });
    expect(result.records.find(r => r.actionType === 'linkedin_touch')).toMatchObject({ status: 'success', outputLink: null, metadata: { touchType: 'comment' } });
  });

  it('surfaces corrupted workbooks and unparseable source contents', async () => {
    const workbook = await file('bad.xlsx', 'not a zip');
    const applications = await file('empty.md', '# Not parseable\nStrange unstructured content.\n');
    const result = await importRio({ home, paths: { workbook, applications }, now });
    expect(result.sources.find(s => s.path === workbook)?.status).toBe('error');
    expect(result.sources.find(s => s.path === applications)?.message).toMatch(/no recognized|unparseable/i);
    expect(result.records).toEqual([]);
  });

  it('does not infer successful outreach from a channel, negative statement, or summary', async () => {
    const applications = await file('apps.md', '| Company | Role | Method | Status |\n| --- | --- | --- | --- |\n| Acme | Engineer | LinkedIn | Applied |\n');
    const linkedin = await file('li.md', '| Person | Action | Status |\n| --- | --- | --- |\n| Ana | Message | Not contacted |\n| Ben | Connection | Not completed |\n| Cara | Message | Sent |\n');
    const result = await importRio({ home, paths: { applications, linkedin }, now });
    expect(result.records.filter(r => r.actionType === 'job_application')).toHaveLength(1);
    expect(result.records.find(r => r.target === 'Ana')?.status).not.toBe('success');
    expect(result.records.find(r => r.target === 'Ben')?.status).not.toBe('success');
    expect(result.records.find(r => r.target === 'Cara')?.metadata.touchType).toBe('message');
  });

  it('only imports dated daily-memory files and evaluates no workbook formulas', async () => {
    await file('memory/README.md', 'Project instructions, not daily memory');
    await file('memory/2026-11-12.md', 'Daily notes');
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Tracker');
    sheet.addRow(['Company', 'Role', 'Stage', 'Updated']);
    sheet.addRow(['Cached', 'Engineer', { formula: '"Interview scheduled"', result: 'Interview scheduled' }, '2026-11-12']);
    sheet.addRow(['Uncached', 'Engineer', { formula: 'NOW()' }, null]);
    const path = await file('cached.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()));
    const result = await importRio({ home, paths: { workbook: path }, now });
    expect(result.records.filter(r => r.actionType === 'summary')).toHaveLength(1);
    expect(result.records.find(r => r.metadata.company === 'Cached')?.actionType).toBe('interview');
    expect(result.records.find(r => r.metadata.company === 'Uncached')).toMatchObject({ timestamp: null, status: 'unknown' });
  });

  it('follows dated memory file symlinks in a glob and ignores broken links', async () => {
    const original = await file('memory/2026-11-14.md', '# Daily summary\nCompleted research.');
    await mkdir(join(home, 'rio-view/memory'), { recursive: true });
    await symlink(original, join(home, 'rio-view/memory/2026-11-14.md'));
    await symlink(join(home, 'memory/missing.md'), join(home, 'rio-view/memory/2026-11-13.md'));
    const result = await importRio({ home, paths: { memory: join(home, 'rio-view/memory/????-??-??.md') }, now });
    const summaries = result.records.filter(r => r.actionType === 'summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ timestamp: '2026-11-14', source: { path: join(home, 'rio-view/memory/2026-11-14.md') } });
    expect(result.sources.find(s => s.kind === 'memory')).toMatchObject({ status: 'ok', records: 1 });
    expect(await readFile(original, 'utf8')).toContain('Completed research.');
  });

  it('follows a glob-matched directory symlink to daily memory', async () => {
    await file('memory/2026-11-15.md', '# Daily summary\nSent a report.');
    await mkdir(join(home, 'views'), { recursive: true });
    await symlink(join(home, 'memory'), join(home, 'views/current'));
    const result = await importRio({ home, paths: { memory: join(home, 'views/*/2026-11-15.md') }, now });
    expect(result.records.filter(r => r.actionType === 'summary')).toHaveLength(1);
    expect(result.sources.find(s => s.kind === 'memory')).toMatchObject({ status: 'ok', records: 1 });
  });

  it('surfaces unreadable source paths and imports explicitly labelled bullet activities', async () => {
    await mkdir(join(home, 'not-a-file'));
    const linkedin = await file('li.md', '# LinkedIn\n2026-11-12\n- Person: Dana; Action: Sent connection; Status: Sent\n');
    const result = await importRio({ home, paths: { applications: join(home, 'not-a-file'), linkedin }, now });
    expect(result.sources.find(s => s.kind === 'applications')?.status).toBe('error');
    expect(result.records.find(r => r.target === 'Dana')).toMatchObject({ actionType: 'linkedin_touch', status: 'success', timestamp: '2026-11-12', source: { line: 3 } });
  });

  it('preserves explicit local output references and explicit event IDs', async () => {
    const linkedin = await file('li.md', '| Person | Action | Status | Output | Event ID |\n| --- | --- | --- | --- | --- |\n| Dana | Sent message | Sent | ./outputs/message.txt | touch-17 |\n| Ben | Connection | Pending | N/A | touch-18 |\n');
    const result = await importRio({ home, paths: { linkedin }, now });
    expect(result.records[0]).toMatchObject({ outputLink: './outputs/message.txt', metadata: { eventId: 'touch-17', touchType: 'message' } });
    expect(result.records[1].outputLink).toBeNull();
  });

  it.each([
    ['Not submitted', 'pending'], ['Not accepted', 'pending'], ['Not replied', 'pending'], ['Not received', 'pending'],
    ['Not completed', 'pending'], ['Not successful', 'failed'], ['Unsuccessful', 'failed'], ['Unsent', 'pending'],
    ['Unsubmitted', 'pending'], ['Unpublished', 'pending'], ['Incomplete', 'pending'], ["Hasn't been submitted", 'pending'],
    ['Never successfully sent', 'pending'], ['Not only submitted but accepted', 'success'],
    ['Not blocked; submitted', 'success'], ['No errors; sent', 'success'], ['Submitted successfully', 'success'],
    ['Accepted', 'success'], ['Replied', 'success'], ['Received', 'success'], ['Completed', 'success'], ['Published', 'published'],
    ['Not marked as completed', 'pending'], ['Cannot be submitted', 'pending'], ['No replies received', 'pending'],
  ])('interprets status %s conservatively as %s', async (status, expected) => {
    const applications = await file('status.md', `| Company | Role | Status |\n| --- | --- | --- |\n| Acme | Engineer | ${status} |\n`);
    const result = await importRio({ home, paths: { applications }, now });
    expect(result.records[0].status).toBe(expected);
  });

  it('never promotes an Updated field to an application execution date', async () => {
    const applications = await file('apps.md', '| Company | Role | Action | Applied date | Updated | Status |\n| --- | --- | --- | --- | --- | --- |\n| Acme | Engineer | Applied | 2026-11-01 | 2026-11-14 | Submitted |\n| Beta | Engineer | Applied | | 2026-11-14 | Submitted |\n');
    const opportunities = await file('ledger.md', '| Company | Role | Stage | Applied date | Updated |\n| --- | --- | --- | --- | --- |\n| Acme | Engineer | Interview scheduled | 2026-11-01 | 2026-11-14 |\n');
    const result = await importRio({ home, paths: { applications, opportunities }, now });
    expect(result.records.find(r => r.target === 'Acme — Engineer' && r.recordKind === 'execution')).toMatchObject({ timestamp: '2026-11-01', metadata: { appliedAt: '2026-11-01', updatedAt: '2026-11-14' } });
    expect(result.records.find(r => r.target === 'Beta — Engineer')).toMatchObject({ timestamp: null, metadata: { updatedAt: '2026-11-14' } });
    expect(result.records.find(r => r.recordKind === 'snapshot')).toMatchObject({ timestamp: '2026-11-14', metadata: { appliedAt: '2026-11-01', updatedAt: '2026-11-14' } });
  });
});

describe('inbox validation', () => {
  it('validates individual JSONL rows, overrides untrusted provenance, and remains read-only', async () => {
    const valid = { agent: 'Rio', timestamp: null, actionType: 'task', target: 'Review', detail: 'Review copy', status: 'pending', source: { path: '/fake', line: 99 } };
    const path = await file('inbox/events.jsonl', `${JSON.stringify(valid)}\nnot JSON\n${JSON.stringify({ ...valid, target: 'Invalid', status: 'magic' })}\n${JSON.stringify({ ...valid, target: 'Other', timestamp: '2026-11-12', metadata: { waitingOn: 'Qarib' } })}\n`);
    const before = await readFile(path, 'utf8');
    const result = await importInbox(join(home, 'inbox'), now);
    expect(result.records).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({ records: 2, skipped: 2 });
    expect(result.sources[0].message).toContain('line 2');
    expect(result.records[0].source).toMatchObject({ path, line: 1 });
    expect(result.records[1].metadata.waitingOn).toBe('Qarib');
    expect(result.records.map(r => r.id)).toEqual((await importInbox(join(home, 'inbox'), now)).records.map(r => r.id));
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('supports JSON record arrays and rejects missing targets and impossible dates', async () => {
    await file('inbox/batch.json', JSON.stringify([{ agent: 'Rio', actionType: 'run', target: 'Morning', detail: '', status: 'success' }, { agent: 'Rio', actionType: 'task', target: '', status: 'pending' }, { agent: 'Rio', actionType: 'task', target: 'Date', timestamp: '2026-02-30', status: 'pending' }]));
    const result = await importInbox(join(home, 'inbox'), now);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ timestamp: null, recordKind: 'execution' });
    expect(result.sources[0].skipped).toBe(2);
    expect((await importInbox(join(home, 'missing'), now)).sources[0].status).toBe('missing');
  });

  it('rejects non-ISO inbox timestamps and namespaces external IDs by agent', async () => {
    const row = { id: 'same', agent: 'Rio', actionType: 'task', target: 'Review', detail: 'Review', status: 'pending', timestamp: null };
    await file('inbox/events.json', JSON.stringify([row, { ...row, agent: 'Other' }, { ...row, id: 'bad', timestamp: 'Nov 12 2026' }, { ...row, id: 'bad2', timestamp: 'garbage 2026-11-12' }]));
    const result = await importInbox(join(home, 'inbox'), now);
    expect(result.records).toHaveLength(2);
    expect(new Set(result.records.map(r => r.id)).size).toBe(2);
    expect(result.records[0].metadata.externalId).toBe('same');
    expect(result.sources[0].skipped).toBe(2);
  });

  it('records actual source lines in pretty JSON arrays and rejects rolled-over clock dates', async () => {
    const row = { agent: 'Rio', actionType: 'task', target: 'First', detail: 'Review', status: 'pending', timestamp: null };
    const path = await file('inbox/pretty.json', `[\n  ${JSON.stringify(row)},\n  ${JSON.stringify({ ...row, target: 'Second' })},\n  ${JSON.stringify({ ...row, target: 'Bad', timestamp: '2026-11-12T24:00:00Z' })}\n]\n`);
    const result = await importInbox(join(home, 'inbox'), now);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(r => r.source.line)).toEqual([2, 3]);
    expect(result.records.every(r => r.source.path === path)).toBe(true);
    expect(result.sources[0].message).toContain('line 4');
  });

  it('accepts explicit output records with the same ID as API normalization', async () => {
    const row = { id: 'output-17', agent: 'Rio', actionType: 'output', target: 'Campaign', detail: 'Draft output', timestamp: '2026-11-14', status: 'success', metadata: { runId: 'morning-17', content: 'Actual prepared message' } };
    await file('inbox/output.json', JSON.stringify(row));
    const result = await importInbox(join(home, 'inbox'), now);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ id: normalizeExecution(row).id, actionType: 'output', metadata: { runId: 'morning-17', content: 'Actual prepared message', externalId: 'output-17' } });
  });
});
