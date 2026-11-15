import { existsSync, realpathSync, statSync, accessSync, constants } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { DashboardData, ExecutionRecord, SourceReport, Kpi } from '../shared/types.js';
import { validTimestamp } from './model.js';
import { STAGES, normalizeStage, applyActionFloor, type Stage } from '../shared/stages.js';

export function dayKey(timestamp: string, timezone = 'Asia/Karachi'): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const instant = (value: unknown) => validTimestamp(value) ? Date.parse(value) : -Infinity;
const newest = (a: ExecutionRecord, b: ExecutionRecord) => (instant(b.timestamp) - instant(a.timestamp) || 0) || Number(Boolean(b.source.excerpt)) - Number(Boolean(a.source.excerpt)) || a.id.localeCompare(b.id);
const stateNewest = (a: ExecutionRecord, b: ExecutionRecord) => (instant(validTimestamp(b.metadata.updatedAt) ? b.metadata.updatedAt : b.timestamp) - instant(validTimestamp(a.metadata.updatedAt) ? a.metadata.updatedAt : a.timestamp) || 0) || newest(a, b);
const terminal = (r: ExecutionRecord) => /^(closed|rejected|withdrawn|declined|completed|complete|hired|won|lost|sold|sale|published|archived|cancelled|canceled)$/i.test(String(r.metadata.stage || '')) || r.status === 'published' || normalizeStage(r.metadata.stage, 'Applied') === 'Closed';
const completed = (r: ExecutionRecord) => r.status === 'success' || r.status === 'published';
export function latestEntities(records: ExecutionRecord[]): ExecutionRecord[] {
  const seen = new Set<string>();
  return [...records].sort(stateNewest).filter(r => { const key = `${r.agent}|${r.actionType}|${norm(r.entityKey)}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
export function uniqueEvents(records: ExecutionRecord[]): ExecutionRecord[] {
  const seen = new Set<string>(); const occurrences = new Map<string, number>(); const retained = new Map<string, number>();
  return [...records].sort(newest).filter(r => {
    const external = r.metadata.eventId || r.metadata.externalId;
    if (external) { const key = JSON.stringify([r.agent, r.actionType, external]); if (seen.has(key)) return false; seen.add(key); return true; }
    // Distinct evidence within one source remains distinct. Only pair matching
    // normalized event assertions across overlapping source files.
    const key = JSON.stringify([r.agent, r.actionType, norm(r.entityKey), r.timestamp, norm(r.metadata.type || r.metadata.touchType || ''), norm(r.detail)]);
    const sourceKey = `${key}|${r.source.path}`;
    const occurrence = (occurrences.get(sourceKey) || 0) + 1; occurrences.set(sourceKey, occurrence);
    if (occurrence <= (retained.get(key) || 0)) return false;
    retained.set(key, occurrence); return true;
  });
}
function readableArtifact(link: string | null, roots: string[]): boolean {
  if (!link || !roots.length || /^https?:/i.test(link)) return false;
  try {
    const path = realpathSync(resolve(link.startsWith('file://') ? new URL(link).pathname : link));
    const allowed = roots.some(root => { if (!existsSync(root)) return false; const rel = relative(realpathSync(root), path); return rel === '' || !rel.startsWith('..') && !isAbsolute(rel); });
    if (!allowed || !statSync(path).isFile() || statSync(path).size === 0) return false;
    accessSync(path, constants.R_OK); return true;
  } catch { return false; }
}
export function verificationFlags(records: ExecutionRecord[], allowedRoots: string[] = []): DashboardData['verification'] {
  const flags: DashboardData['verification'] = [];
  for (const record of records) {
    if (!completed(record)) continue;
    const embeddedOutput = record.actionType === 'output' && typeof record.metadata.content === 'string' && Boolean(record.metadata.content.trim());
    const matching = records.some(out => out.agent === record.agent && out.actionType === 'output' && completed(out) &&
      (out.metadata.runId === record.id || record.metadata.externalId != null && out.metadata.runId === record.metadata.externalId) &&
      (typeof out.metadata.content === 'string' && Boolean(out.metadata.content.trim()) || readableArtifact(out.outputLink, allowedRoots)));
    if (!embeddedOutput && !matching && !readableArtifact(record.outputLink, allowedRoots)) flags.push({ recordId: record.id, reason: 'Reported success without a matching output record containing delivered content or a readable local artifact. A log assertion or URL alone is unverified.' });
  }
  return flags;
}
const NOT_DONE = new Set(['planned', 'pending', 'blocked']);
/** A dated application record counts as applied unless it is planned/blocked or explicitly negated. "Pending"/"awaiting reply" means submitted and waiting, so it still counts. */
const wasApplied = (r: ExecutionRecord) => {
  if (r.status === 'planned' || r.status === 'blocked') return false;
  if (r.status === 'pending') return !/\b(?:not|never|no)\s+(?:yet\s+)?(?:submitted|applied|sent)\b|\b(?:unsent|unsubmitted|to apply|todo|to do|draft|queued)\b/i.test(`${r.detail} ${r.metadata.stage || ''}`);
  return true;
};
const stageOf = (r: ExecutionRecord): Stage => {
  const fallback: Stage = r.actionType === 'interview' ? 'Interview' : r.actionType === 'assessment' ? 'Assessment' : 'Applied';
  const stage = applyActionFloor(normalizeStage(r.metadata.stage, fallback), r.actionType);
  return stage === fallback && r.status === 'failed' && !String(r.metadata.stage || '').trim() ? 'Closed' : stage;
};
const stageBuckets = (rows: ExecutionRecord[]) => STAGES.map(stage => { const group = rows.filter(r => stageOf(r) === stage); return { stage: stage as string, count: group.length, recordIds: group.map(r => r.id) }; });
const parseDay = (value: string) => Date.parse(`${value}T00:00:00Z`);
export function buildDashboard(records: ExecutionRecord[], sources: SourceReport[], options: { now?: Date; timezone?: string; allowedRoots?: string[]; configured?: boolean; model?: string; callsToday?: number; dailyLimit?: number } = {}): DashboardData {
  const now = options.now || new Date(); const timezone = options.timezone || 'Asia/Karachi';
  const today = dayKey(now.toISOString(), timezone);
  const utcToday = new Date(`${today}T00:00:00Z`); const weekday = (utcToday.getUTCDay() + 6) % 7;
  const weekStart = new Date(utcToday.getTime() - weekday * 86400000).toISOString().slice(0, 10);
  const sorted = [...records].sort(newest);
  const facts = sorted.filter(r => r.recordKind !== 'summary' && r.actionType !== 'summary');
  const events = uniqueEvents(facts.filter(r => r.recordKind === 'execution'));
  const dayOf = (r: ExecutionRecord) => r.timestamp ? dayKey(r.timestamp, timezone) : null;
  const lastDays = (n: number, rows: ExecutionRecord[]) => Array.from({ length: n }, (_, i) => { const date = new Date(utcToday.getTime() - (n - 1 - i) * 86400000).toISOString().slice(0, 10); const group = rows.filter(r => dayOf(r) === date); return { date, count: group.length, recordIds: group.map(r => r.id) }; });
  // One concept: an application is a distinct company + role with any application record. Dated events feed the day series.
  const opportunityFacts = facts.filter(r => ['job_application', 'interview', 'assessment'].includes(r.actionType));
  const applicationEntities = latestEntities(opportunityFacts.filter(r => r.actionType === 'job_application'));
  const appliedEvents = (() => { const seen = new Set<string>(); return events.filter(r => r.actionType === 'job_application' && wasApplied(r) && dayOf(r)).filter(r => { const key = `${norm(r.entityKey)}|${dayOf(r)}`; if (seen.has(key)) return false; seen.add(key); return true; }); })();
  const linkedin = events.filter(r => r.actionType === 'linkedin_touch' && !NOT_DONE.has(r.status) && r.status !== 'failed');
  const opportunityStates = new Map<string, ExecutionRecord>();
  for (const r of [...opportunityFacts].sort(stateNewest)) { const key = `${r.agent}|${norm(r.entityKey)}`; if (!opportunityStates.has(key)) opportunityStates.set(key, r); }
  const pipeline = (action: string) => latestEntities(opportunityFacts.filter(r => r.actionType === action)).map(r => opportunityStates.get(`${r.agent}|${norm(r.entityKey)}`)!).sort(stateNewest);
  const interviews = pipeline('interview');
  const assessments = pipeline('assessment');
  const dental = latestEntities(facts.filter(r => r.actionType === 'dental_lead'));
  const social = latestEntities(facts.filter(r => r.actionType === 'social_post'));
  const onDay = (r: ExecutionRecord) => dayOf(r) === today;
  const thisWeek = (r: ExecutionRecord) => { const d = dayOf(r); return d ? d >= weekStart && d <= today : false; };
  const kpis: Kpi[] = [];
  const add = (id: string, label: string, rows: ExecutionRecord[], available: boolean, description: string) => kpis.push({ id, label, value: available ? rows.length : null, recordIds: rows.map(r => r.id), description });
  add('applications-total', 'Applications', applicationEntities, applicationEntities.length > 0, 'Distinct company + role with a recorded application, latest state each.');
  add('applications-week', 'Applications this week', appliedEvents.filter(thisWeek), applicationEntities.length > 0, `Dated applications, Monday ${weekStart} through ${today}, ${timezone}. Undated records excluded.`);
  add('interviews', 'Interviews in motion', interviews.filter(r => !terminal(r) && r.status !== 'failed'), interviews.length > 0, 'Latest recorded stage per interview; closed/rejected/withdrawn excluded.');
  add('assessments', 'Assessments pending', assessments.filter(r => r.actionType === 'assessment' && !terminal(r) && !completed(r) && r.status !== 'failed'), assessments.length > 0, 'Latest open assessment states; completed, closed or progressed assessments excluded.');
  add('linkedin-total', 'LinkedIn touches', linkedin, linkedin.length > 0, 'Every recorded LinkedIn touch (not planned or failed), counted once.');
  add('linkedin-today', 'LinkedIn today', linkedin.filter(onDay), linkedin.length > 0, `Touches dated ${today}, ${timezone}.`);
  add('dental-total', 'Dental leads', dental, dental.length > 0, 'Unique recorded leads at their latest stage.');
  // Social: headline numbers cover recent days only; older history stays reachable through the platform's records.
  const recentFrom = new Date(utcToday.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const inWindow = (r: ExecutionRecord) => { const d = dayOf(r); return d ? d >= recentFrom : false; };
  const publishedRecent = social.filter(r => r.status === 'published' && inWindow(r) && dayOf(r)! <= today);
  add('posts-week', 'Posts published (7 days)', publishedRecent, social.length > 0, `Published per-platform records dated ${recentFrom} through ${today}.`);
  const dentalStages = [...new Set(dental.map(r => String(r.metadata.stage || r.status)))].sort().map(stage => {
    const rows = dental.filter(r => String(r.metadata.stage || r.status) === stage); return { stage, count: rows.length, recordIds: rows.map(r => r.id) };
  });
  const socialPlatforms = [...new Set(social.map(r => String(r.metadata.platform || 'Unspecified')))].sort().map(platform => {
    const rows = social.filter(r => String(r.metadata.platform || 'Unspecified') === platform);
    const planned = rows.filter(r => ['planned', 'pending', 'in_progress'].includes(r.status) && dayOf(r) !== null && dayOf(r)! >= today);
    const published = rows.filter(r => r.status === 'published' && inWindow(r) && dayOf(r)! <= today);
    const blocked = rows.filter(r => r.status === 'blocked' && inWindow(r));
    const shown = new Set([...planned, ...published, ...blocked].map(r => r.id));
    return { platform, planned: planned.length, published: published.length, blocked: blocked.length, older: rows.length - shown.size, recordIds: rows.map(r => r.id), plannedIds: planned.map(r => r.id), publishedIds: published.map(r => r.id), blockedIds: blocked.map(r => r.id) };
  });
  // Staleness applies to open interviews, assessments and dental leads only.
  const stale = latestEntities([...interviews, ...assessments, ...dental])
    .filter(r => !terminal(r) && r.status !== 'failed' && !(r.actionType === 'assessment' && completed(r)))
    .flatMap(r => { const timestamp = validTimestamp(r.metadata.updatedAt) ? r.metadata.updatedAt : r.timestamp;
      if (!timestamp) return []; const daysWaiting = daysBetween(today, dayKey(timestamp, timezone));
      return daysWaiting >= 3 ? [{ recordId: r.id, daysWaiting, waitingOn: String(r.metadata.waitingOn || 'Not recorded') }] : []; }).sort((a,b) => b.daysWaiting-a.daysWaiting);
  const names = [...new Set(['Rio', ...sorted.map(r => r.agent)])];
  const agents = names.map(name => { const rows = sorted.filter(r => r.agent === name); const current = latestEntities(rows.filter(r => r.recordKind !== 'summary'));
    return { name, lastRun: rows.find(r => r.timestamp)?.timestamp || null, latestOutput: rows.find(r => r.actionType === 'output' || completed(r) && r.recordKind !== 'summary' && r.actionType !== 'run') || null,
      failed: current.filter(r => r.status === 'failed').map(r => r.id), blocked: current.filter(r => r.status === 'blocked').map(r => r.id), recordIds: rows.map(r => r.id) }; });
  // Global attention = genuinely actionable: stale open work, today's blocked social slots, failed runs. Verification stays on the Agents page.
  const attention: DashboardData['attention'] = [
    ...stale.map(item => ({ kind: 'stale' as const, recordId: item.recordId, days: item.daysWaiting, waitingOn: item.waitingOn })),
    ...social.filter(r => r.status === 'blocked' && onDay(r)).map(r => ({ kind: 'blocked' as const, recordId: r.id })),
    ...latestEntities(facts.filter(r => ['run', 'task'].includes(r.actionType) && r.status === 'failed')).map(r => ({ kind: 'failed' as const, recordId: r.id })),
  ];
  const todayRows = (match: (r: ExecutionRecord) => boolean) => facts.filter(r => onDay(r) && match(r));
  const todayItems = [
    { key: 'applications', label: 'Applications sent', rows: appliedEvents.filter(onDay) },
    { key: 'linkedin', label: 'LinkedIn touches', rows: linkedin.filter(onDay) },
    { key: 'posts', label: 'Posts published', rows: todayRows(r => r.actionType === 'social_post' && r.status === 'published') },
    { key: 'blocked', label: 'Slots blocked', rows: todayRows(r => r.actionType === 'social_post' && r.status === 'blocked') },
    { key: 'pipeline', label: 'Interview / assessment updates', rows: todayRows(r => r.actionType === 'interview' || r.actionType === 'assessment') },
    { key: 'leads', label: 'Dental lead updates', rows: todayRows(r => r.actionType === 'dental_lead') },
    { key: 'other', label: 'Other agent output', rows: todayRows(r => ['output', 'run', 'task'].includes(r.actionType)) },
  ].map(i => ({ key: i.key, label: i.label, count: i.rows.length, recordIds: i.rows.map(r => r.id) }));
  const dentalDaily = (() => {
    const byDay = new Map<string, { date: string; sent: number; replies: number; calls: number; sales: number; recordIds: string[] }>();
    const seen = new Set<string>();
    for (const r of sorted.filter(r => r.actionType === 'summary' && typeof r.metadata.metric === 'string' && r.timestamp)) {
      const date = dayOf(r)!, metric = String(r.metadata.metric), key = `${date}|${metric}`;
      if (seen.has(key) || !['sent', 'replies', 'calls', 'sales'].includes(metric)) continue; seen.add(key);
      const row = byDay.get(date) || { date, sent: 0, replies: 0, calls: 0, sales: 0, recordIds: [] };
      row[metric as 'sent' | 'replies' | 'calls' | 'sales'] += Number(r.metadata.count) || 0; row.recordIds.push(r.id); byDay.set(date, row);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  })();
  return { generatedAt: now.toISOString(), timezone, records: sorted, sources, kpis, agents,
    applicationsDaily: lastDays(14, appliedEvents),
    applicationStages: stageBuckets(applicationEntities),
    pipelineStages: stageBuckets([...interviews, ...assessments]),
    attention, today: { date: today, items: todayItems }, dentalDaily,
    linkedinDaily: lastDays(14, linkedin),
    dentalStages, socialPlatforms, entities: { applications: applicationEntities, interviews, assessments, dental, social }, stale,
    verification: verificationFlags(sorted, options.allowedRoots), analysis: { configured: options.configured || false, model: options.model || 'gpt-4.1-mini', callsToday: options.callsToday || 0, dailyLimit: options.dailyLimit ?? 20 } };
}
