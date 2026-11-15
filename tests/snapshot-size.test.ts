import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importRio } from '../server/importers.js';
import { MAX_SYNC_BYTES, validateSnapshot } from '../server/sync.js';

let home: string;
const now = new Date('2026-11-15T12:00:00Z');
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'rio-snapshot-size-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

it('keeps a full Rio-sized snapshot under the 3 MB cap without dropping records', async () => {
  const dir = join(home, 'workspace/job-hunt-2026-10-10');
  await mkdir(dir, { recursive: true });
  await mkdir(join(home, 'memory'), { recursive: true });
  const note = (i: number) => `Applied via the company careers portal; tailored CV v${i % 7} emphasising AI agents — ` + 'cover letter referenced the role’s focus on evaluation pipelines and production LLM tooling. '.repeat(8);
  const rows: string[] = [];
  for (let i = 0; i < 3256; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0'), month = i % 3 === 0 ? '10' : '11';
    rows.push(`| 2026-${month}-${day} | Senior AI Engineer ${i} | Company Number ${i} Ltd | LinkedIn | Applied | ${note(i)} |`);
    if (i % 500 === 499) rows.push('');
  }
  await writeFile(join(dir, 'applied-log.md'), `# Applied log\n\n| Date | Job | Company | Source | Status | Notes |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
  for (let d = 1; d <= 40; d++) await writeFile(join(home, `memory/2026-10-${String(1 + (d % 28)).padStart(2, '0')}${d > 28 ? 'x' : ''}.md`), `# Day ${d}\n${'Summary text about the day. '.repeat(6000)}`);

  const imported = await importRio({ home, now });
  const applications = imported.records.filter(r => r.actionType === 'job_application');
  expect(applications).toHaveLength(3256);
  expect(imported.records.length).toBe(imported.sources.reduce((n, s) => n + s.records, 0));

  const payload = { collectorId: 'rio-test', records: imported.records, sources: imported.sources };
  // Measure with a real-length home directory: the temp dir prefix is far longer than Rio's and is repeated in every record's source path.
  const bytes = Buffer.byteLength(JSON.stringify(payload).split(home).join('/Users/rio'));
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(MAX_SYNC_BYTES); // under the cap even with the long temp path
  console.log(`snapshot: ${imported.records.length} records, ${(bytes / 1048576).toFixed(2)} MB`);
  expect(bytes).toBeLessThan(MAX_SYNC_BYTES * 0.8); // comfortably under the cap
  const snapshot = validateSnapshot(payload);
  expect(snapshot.records).toHaveLength(imported.records.length);

  const sample = applications[0];
  expect(sample.detail.length).toBeLessThan(95);
  expect(sample.detail).toContain('…');
  expect(sample.detail).toContain('Company Number 0 Ltd');
  expect(sample.source.excerpt!.length).toBeLessThan(150);
  expect(sample.source.excerpt).toContain('[truncated;');
  expect(sample.metadata.company).toBe('Company Number 0 Ltd');
  expect(new Set(applications.map(r => r.id)).size).toBe(3256); // identities stay distinct after trimming
});
