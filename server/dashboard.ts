import { existsSync, realpathSync, statSync, accessSync, constants } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { DashboardData, ExecutionRecord, SourceReport, Kpi } from '../shared/types.js';
import { validTimestamp } from './model.js';

export function dayKey(timestamp: string, timezone = 'Asia/Karachi'): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const instant = (value: unknown) => validTimestamp(value) ? Date.parse(value) : -Infinity;
const newest = (a: ExecutionRecord, b: ExecutionRecord) => (instant(b.timestamp) - instant(a.timestamp) || 0) || Number(Boolean(b.source.excerpt)) - Number(Boolean(a.source.excerpt)) || a.id.localeCompare(b.id);
const stateNewest = (a: ExecutionRecord, b: ExecutionRecord) => (instant(validTimestamp(b.metadata.updatedAt) ? b.metadata.updatedAt : b.timestamp) - instant(validTimestamp(a.metadata.updatedAt) ? a.metadata.updatedAt : a.timestamp) || 0) || newest(a, b);
const terminal = (r: ExecutionRecord) => /^(closed|rejected|withdrawn|declined|completed|complete|hired|won|lost|sold|published|archived|cancelled|canceled)$/i.test(String(r.metadata.stage || '')) || r.status === 'published';
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
export function buildDashboard(records: ExecutionRecord[], sources: SourceReport[], options: { now?: Date; timezone?: string; allowedRoots?: string[]; configured?: boolean; model?: string; callsToday?: number; dailyLimit?: number } = {}): DashboardData {
  const now = options.now || new Date(); const timezone = options.timezone || 'Asia/Karachi';
  const today = dayKey(now.toISOString(), timezone);
  const utcToday = new Date(`${today}T00:00:00Z`); const weekday = (utcToday.getUTCDay() + 6) % 7;
  const weekStart = new Date(utcToday.getTime() - weekday * 86400000).toISOString().slice(0, 10);
  const sorted = [...records].sort(newest);
  const facts = sorted.filter(r => r.recordKind !== 'summary' && r.actionType !== 'summary');
  const events = uniqueEvents(facts.filter(r => r.recordKind === 'execution'));
  const apps = events.filter(r => r.actionType === 'job_application' && completed(r));
  const linkedin = events.filter(r => r.actionType === 'linkedin_touch' && completed(r));
  const opportunityFacts = facts.filter(r => ['job_application', 'interview', 'assessment'].includes(r.actionType));
  const opportunityStates = new Map<string, ExecutionRecord>();
  for (const r of [...opportunityFacts].sort(stateNewest)) { const key = `${r.agent}|${norm(r.entityKey)}`; if (!opportunityStates.has(key)) opportunityStates.set(key, r); }
  const pipeline = (action: string) => latestEntities(opportunityFacts.filter(r => r.actionType === action)).map(r => {
    const state = opportunityStates.get(`${r.agent}|${norm(r.entityKey)}`)!;
    return state;
  }).sort(stateNewest);
  const interviews = pipeline('interview');
  const assessments = pipeline('assessment');
  const dental = latestEntities(facts.filter(r => r.actionType === 'dental_lead'));
  const social = latestEntities(facts.filter(r => r.actionType === 'social_post'));
  const onDay = (r: ExecutionRecord) => r.timestamp ? dayKey(r.timestamp, timezone) === today : false;
  const thisWeek = (r: ExecutionRecord) => r.timestamp ? dayKey(r.timestamp, timezone) >= weekStart && dayKey(r.timestamp, timezone) <= today : false;
  const kpis: Kpi[] = [];
  const add = (id: string, label: string, rows: ExecutionRecord[], available: boolean, description: string) => kpis.push({ id, label, value: available ? rows.length : null, recordIds: rows.map(r => r.id), description });
  add('applications-total', 'Applications', apps, apps.length > 0, 'Recorded completed job applications; overlapping source rows counted once.');
  add('applications-week', 'Applications this week', apps.filter(thisWeek), apps.length > 0, `Monday ${weekStart} through ${today}, ${timezone}. Undated records excluded.`);
  add('interviews', 'Interviews in motion', interviews.filter(r => !terminal(r) && r.status !== 'failed'), interviews.length > 0, 'Latest recorded stage per interview; closed/rejected/withdrawn excluded.');
  add('assessments', 'Assessments pending', assessments.filter(r => r.actionType === 'assessment' && !terminal(r) && !completed(r) && r.status !== 'failed'), assessments.length > 0, 'Latest open assessment states; completed, closed or progressed assessments excluded.');
  add('linkedin-total', 'LinkedIn touches', linkedin, linkedin.length > 0, 'Completed individually recorded touches. Summary quantities are never expanded.');
  add('linkedin-today', 'LinkedIn today', linkedin.filter(onDay), linkedin.length > 0, `Individually dated touches on ${today}, ${timezone}.`);
  add('dental-total', 'Dental leads', dental, dental.length > 0, 'Unique recorded leads at their latest stage.');
  add('posts-week', 'Posts this week', social.filter(r => r.status === 'published' && thisWeek(r)), social.length > 0, 'Latest published social records dated this calendar week.');
  const dentalStages = [...new Set(dental.map(r => String(r.metadata.stage || r.status)))].sort().map(stage => {
    const rows = dental.filter(r => String(r.metadata.stage || r.status) === stage); return { stage, count: rows.length, recordIds: rows.map(r => r.id) };
  });
  const socialPlatforms = [...new Set(social.map(r => String(r.metadata.platform || 'Unspecified')))].sort().map(platform => {
    const rows = social.filter(r => String(r.metadata.platform || 'Unspecified') === platform);
    const planned = rows.filter(r => ['planned', 'pending', 'in_progress', 'blocked'].includes(r.status));
    const published = rows.filter(r => r.status === 'published' && thisWeek(r));
    return { platform, planned: planned.length, published: published.length, blocked: rows.filter(r => r.status === 'blocked').length, recordIds: rows.map(r => r.id), plannedIds: planned.map(r => r.id), publishedIds: published.map(r => r.id) };
  });
  const stale = latestEntities([...interviews, ...assessments, ...dental, ...social, ...facts.filter(r => r.actionType === 'task')])
    .filter(r => !terminal(r) && r.status !== 'failed' && !(r.actionType === 'assessment' && completed(r)))
    .flatMap(r => { const timestamp = validTimestamp(r.metadata.updatedAt) ? r.metadata.updatedAt : r.timestamp;
      if (!timestamp) return []; const daysWaiting = daysBetween(today, dayKey(timestamp, timezone));
      return daysWaiting >= 3 ? [{ recordId: r.id, daysWaiting, waitingOn: String(r.metadata.waitingOn || 'Not recorded') }] : []; }).sort((a,b) => b.daysWaiting-a.daysWaiting);
  const names = [...new Set(['Rio', ...sorted.map(r => r.agent)])];
  return { generatedAt: now.toISOString(), timezone, records: sorted, sources, kpis,
    agents: names.map(name => { const rows = sorted.filter(r => r.agent === name); const current = latestEntities(rows.filter(r => r.recordKind !== 'summary'));
      return { name, lastRun: rows.find(r => r.timestamp)?.timestamp || null, latestOutput: rows.find(r => r.actionType === 'output' || completed(r) && r.recordKind !== 'summary' && r.actionType !== 'run') || null,
        failed: current.filter(r => r.status === 'failed').map(r => r.id), blocked: current.filter(r => r.status === 'blocked').map(r => r.id), recordIds: rows.map(r => r.id) }; }),
    linkedinDaily: Array.from({ length: 14 }, (_, i) => { const date = new Date(utcToday.getTime() - (13-i)*86400000).toISOString().slice(0, 10); const rows = linkedin.filter(r => r.timestamp && dayKey(r.timestamp, timezone) === date); return { date, count: rows.length, recordIds: rows.map(r => r.id) }; }),
    dentalStages, socialPlatforms, entities: { interviews, assessments, dental, social }, stale,
    verification: verificationFlags(sorted, options.allowedRoots), analysis: { configured: options.configured || false, model: options.model || 'gpt-4.1-mini', callsToday: options.callsToday || 0, dailyLimit: options.dailyLimit ?? 20 } };
}
