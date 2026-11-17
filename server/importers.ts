import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { ExecutionRecord, ImportResult, SourceKind, SourceRef, SourceReport, Status } from '../shared/types.js';

type Fields = Record<string, string>;
type Diagnostics = { skipped: number; warnings: string[] };
const actionTypes = new Set(['job_application', 'linkedin_touch', 'interview', 'assessment', 'dental_lead', 'social_post', 'summary', 'run', 'task', 'output']);
const statuses = new Set<Status>(['success', 'failed', 'blocked', 'pending', 'in_progress', 'planned', 'published', 'unknown']);
const clean = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`_]/g, '').trim();
const normalize = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const get = (f: Fields, ...keys: string[]) => keys.map(k => f[k]).find(v => v?.trim())?.trim() || '';
const aliases: Record<string, string> = {
  employer: 'company', organisation: 'company', organization: 'company', practice: 'company', clinic: 'company', client: 'company',
  position: 'role', job: 'role', 'job title': 'role', 'job role': 'role', 'contact name': 'person', contact: 'person', name: 'person',
  state: 'status', outcome: 'status', 'current stage': 'stage', 'pipeline stage': 'stage',
  'applied': 'appliedAt', 'applied on': 'appliedAt', 'applied date': 'appliedAt', 'application date': 'appliedAt', 'date applied': 'appliedAt', 'sent on': 'date', day: 'date',
  'updated at': 'updated', 'last updated': 'updated', 'last activity': 'updated', timestamp: 'date',
  output: 'link', url: 'link', proof: 'link', 'output link': 'link', 'post url': 'link', 'assessment link': 'link',
  activity: 'action', type: 'action', 'action type': 'action', channel: 'platform',
  'post title': 'title', post: 'title', content: 'title', 'waiting on': 'waitingOn', 'waiting for': 'waitingFor',
  'blocked since': 'blockedSince', 'response received': 'reply', response: 'reply',
  'touch type': 'touchType', 'event id': 'eventId',
};
const header = (s: string) => { const key = normalize(s); return aliases[key] || key; };
const cells = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());

/** Year context for year-less dates ("Nov 12", "Thu Oct 8"): a 20xx year in the file path wins, otherwise the most recent past occurrence relative to `now`. Set synchronously around each parse. */
let dateContext: { year?: number; now: Date } = { now: new Date() };
function withDateContext<T>(path: string, now: Date, run: () => T): T {
  const previous = dateContext;
  dateContext = { year: Number(path.match(/(?:^|[^0-9])(20\d{2})(?![0-9])/)?.[1]) || undefined, now };
  try { return run(); } finally { dateContext = previous; }
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const monthIndex = (name: string) => MONTHS.findIndex(v => v === name.toLowerCase() || (name.length >= 3 && v.slice(0, 3) === name.slice(0, 3).toLowerCase() && v.startsWith(name.toLowerCase())));
function yearlessDate(text: string): string | null {
  const match = text.match(/(?:\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+)?(?<![0-9A-Za-z])(?:(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]{2,8})|([A-Z][a-z]{2,8})\.?\s+(\d{1,2})(?:st|nd|rd|th)?)(?![0-9])(?!\s*,?\s*\d{4})/);
  if (!match) return null;
  const monthName = match[3] || match[4], day = Number(match[2] || match[5]), m = monthIndex(monthName) + 1;
  if (m < 1 || monthName.length < 3 || (monthName.length > 3 && MONTHS[m - 1] !== monthName.toLowerCase())) return null;
  const valid = (y: number) => { const d = new Date(Date.UTC(y, m - 1, day)); return d.getUTCFullYear() === y && d.getUTCMonth() === m - 1 && d.getUTCDate() === day ? d : null; };
  const weekday = match[1] ? WEEKDAYS.indexOf(match[1].toLowerCase()) : -1;
  const nowYear = dateContext.now.getUTCFullYear();
  let candidates = dateContext.year ? [dateContext.year] : [nowYear, nowYear - 1];
  if (weekday >= 0 && !dateContext.year) candidates = [nowYear, nowYear - 1, nowYear - 2];
  const horizon = dateContext.now.getTime() + 2 * 86400000;
  for (const y of candidates) {
    const d = valid(y); if (!d) continue;
    if (weekday >= 0 && d.getUTCDay() !== weekday) continue;
    if (!dateContext.year && d.getTime() > horizon) continue;
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
/** Calendar dates only; file mtimes are never event dates. Year-less dates infer the year from context (see dateContext). */
function parseDate(raw: string): string | null {
  const text = clean(raw);
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/);
  let y: number, m: number, d: number;
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else {
    const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*,?\s*(\d{4})\b/) || text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/);
    if (!named) return yearlessDate(text);
    const dayFirst = /^\d/.test(named[1]);
    d = Number(named[dayFirst ? 1 : 2]); y = Number(named[3]);
    m = monthIndex(named[dayFirst ? 2 : 1]) + 1;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (iso?.[0].includes('T')) {
    const time = iso[0].match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59) return null;
    const dt = new Date(iso[0]); return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function statusOf(value: string): Status {
  // Preserve the scope of common contractions before punctuation normalization.
  let text = normalize(value.replace(/n['’]t\b/gi, ' not').replace(/\bcannot\b/gi, 'can not'));
  // A negated failure/blocked statement is not itself evidence of that state.
  text = text.replace(/\b(?:not|never|no)\s+(?:(?:yet|been|ever)\s+)*(?:blocked|stuck|on hold|failed|errors?|rejected|declined|bounced)\b/g, ' ');
  if (/\bunsuccessful\b|\b(?:not|never)\s+(?:a\s+)?success(?:ful)?\b/.test(text)) return 'failed';
  if (/\b(blocked|stuck|on hold)\b/.test(text)) return 'blocked';
  if (/\b(failed|error|rejected|declined|bounced)\b/.test(text)) return 'failed';
  if (/\b(?:not|never)\s+(?:(?:a|an|be|being|marked|as|considered|confirmed|yet|been|ever|already|fully|successfully)\s+)*(?:contacted|completed|complete|done|sent|submitted|published|applied|posted|connected|accepted|replied|received|live)\b/.test(text)
      || /\b(?:unsent|unsubmitted|unpublished|unposted|unaccepted|unreceived|unanswered|unconnected|uncompleted|incomplete)\b/.test(text)
      || /\bno\s+(?:repl(?:y|ies)|responses?|submissions?|connections?|publications?|acceptances?)\b/.test(text)) return 'pending';
  if (/\b(planned|plan|draft|scheduled|todo|to do|not sent|not published)\b/.test(text)) return 'planned';
  if (/\b(pending|awaiting|waiting|not yet)\b/.test(text)) return 'pending';
  if (/\b(in progress|working|started)\b/.test(text)) return 'in_progress';
  if (/\b(published|posted|live)\b/.test(text)) return 'published';
  if (/\b(success|successful|completed|complete|done|sent|submitted|applied|connected|accepted|replied|received)\b/.test(text)) return 'success';
  return 'unknown';
}
function linkOf(text: string): string | null {
  const markdown = text.match(/\]\(([^)]+)\)/)?.[1];
  return markdown || text.match(/https?:\/\/[^\s<>|)]+/)?.[0] || null;
}
function explicitLink(text: string): string | null {
  const value = text.trim();
  if (!value || /^(?:[-—–]|n\/?a|none|null|not available)$/i.test(value)) return null;
  return linkOf(value) || value;
}
function touchType(text: string): string {
  if (/inmail/i.test(text)) return 'inmail';
  if (/connection|connect(?:ed)?\b/i.test(text)) return 'connection';
  if (/reply|replied/i.test(text)) return 'reply';
  return /message|messaged|outreach/i.test(text) ? 'message' : '';
}
const snippet = (line: string) => JSON.stringify(clean(line).slice(0, 110));
function warn(d: Diagnostics, location: string, message: string) { d.skipped += 1; d.warnings.push(`${location}: ${message}`); }
function entityFor(type: string, target: string, metadata: ExecutionRecord['metadata']): string {
  if (['job_application', 'interview', 'assessment'].includes(type)) return `application:${normalize(String(metadata.company || target))}:${normalize(String(metadata.role || ''))}`;
  if (type === 'linkedin_touch') return `linkedin:${normalize(String(metadata.person || target))}`;
  if (type === 'dental_lead') return `dental:${normalize(String(metadata.company || metadata.person || target))}`;
  if (type === 'social_post') return `social:${normalize(String(metadata.platform || 'unknown'))}:${normalize(target)}`;
  return `${type}:${normalize(target)}`;
}
/** Payload budget per record so a full collector snapshot stays well under the 3 MB sync cap. */
export const RECORD_LIMITS = { detail: 84, cell: 20, longDetail: 600, summaryDetail: 1200, excerpt: 100, metadata: 300 };
export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()} … [truncated; ${text.length} characters in source]`;
}
function record(input: Omit<ExecutionRecord, 'id' | 'entityKey'>, entityKey?: string, id?: string): ExecutionRecord {
  // Identity is computed from the full source content before trimming, so IDs stay stable and distinct.
  const fullId = id || `rio_${hash(JSON.stringify([input.agent, input.source.path, input.source.sheet, input.source.row || input.source.line, input.actionType, input.target, input.detail]))}`;
  const key = entityKey || entityFor(input.actionType, input.target, input.metadata);
  const excerpt = input.source.excerpt;
  // Log rows repeat the source row as detail; keep one short copy as detail and a slightly longer excerpt for the drawer.
  const detailLimit = input.recordKind === 'summary' ? RECORD_LIMITS.summaryDetail : excerpt !== undefined && input.detail === excerpt ? RECORD_LIMITS.detail : RECORD_LIMITS.longDetail;
  const metadata: ExecutionRecord['metadata'] = {};
  for (const [k, v] of Object.entries(input.metadata)) metadata[k] = typeof v === 'string' ? truncateText(v, RECORD_LIMITS.metadata) : v;
  // A table row's detail becomes a compact copy of its cells (each clipped), so the long note text is stored once, in the excerpt.
  const compact = excerpt !== undefined && input.detail === excerpt && excerpt.includes('|') && excerpt.length > detailLimit
    ? `${cells(excerpt).filter(Boolean).map(c => (c.length > RECORD_LIMITS.cell ? `${c.slice(0, RECORD_LIMITS.cell).trimEnd()}…` : c)).join(' | ')}`
    : null;
  // The compact copy marks clipped cells with "…"; the full-length note count is carried once, on the excerpt.
  const detail = compact !== null ? (compact.length > detailLimit ? `${compact.slice(0, detailLimit).trimEnd()}…` : compact) : truncateText(input.detail, detailLimit);
  return { ...input, metadata, detail, target: truncateText(input.target, 300),
    source: excerpt === undefined ? input.source : { ...input.source, excerpt: truncateText(excerpt, RECORD_LIMITS.excerpt) },
    entityKey: key, id: fullId };
}
function isSummary(text: string) {
  return /^(?:total|totals|summary|daily total|weekly total)\b/i.test(clean(text)) || /^\d+\s+(?:posts?|contacts?|messages?|applications?|leads?)\b/i.test(clean(text));
}
function summary(path: string, fullText: string, timestamp: string | null, line = 1): ExecutionRecord {
  return record({ agent: 'Rio', timestamp, actionType: 'summary', target: basename(path), detail: fullText, status: 'unknown', outputLink: null, source: { path, line, excerpt: fullText }, recordKind: 'summary', metadata: {} });
}

function opportunityParts(value: string): { company: string; role: string } {
  const separator = /\s+[—–]\s+/.exec(value);
  if (!separator) return { company: clean(value), role: '' };
  return { company: clean(value.slice(0, separator.index)), role: clean(value.slice(separator.index + separator[0].length)) };
}
function confirmed(value: string, milestone: 'sent' | 'reply' | 'call' | 'sale'): boolean {
  const text = clean(value).toLowerCase();
  if (!text || /^(?:[-—–?]|n\/?a\b|none\b|false\b|0\b)/.test(text) || /\b(?:no|not|never|pending|awaiting|tbd|unknown|maybe)\b|\?/.test(text)) return false;
  if (/^(?:yes|y|true|1|✓|✔|✅)$/.test(text) || parseDate(text)) return true;
  if (milestone === 'sent') return /\b(?:sent|emailed|messaged|contacted)\b/.test(text);
  if (milestone === 'reply') return /\b(?:replied|responded|reply|response)\b/.test(text) || text.length >= 8;
  if (milestone === 'call') return /\b(?:booked|scheduled|confirmed)\b/.test(text);
  return /\b(?:sold|sale|paid|won|closed)\b|(?:\b(?:pkr|usd|eur|gbp)\b|[$£€])\s*\d/.test(text);
}
function dentalStage(fields: Fields): string {
  if (confirmed(get(fields, 'sale'), 'sale')) return 'Sale';
  if (confirmed(get(fields, 'call booked'), 'call')) return 'Call booked';
  if (confirmed(get(fields, 'reply'), 'reply')) return 'Reply';
  if (confirmed(get(fields, 'sent'), 'sent')) return 'Sent';
  return '';
}

function tableRecord(fields: Fields, kind: SourceKind, source: SourceRef, contextDate: string | null, diagnostics: Diagnostics): ExecutionRecord | null {
  const opportunityText = kind === 'opportunities' ? clean(get(fields, 'opportunity')) : '';
  const opportunity = opportunityParts(opportunityText);
  const company = clean(get(fields, 'company') || opportunity.company), role = clean(get(fields, 'role') || opportunity.role), person = clean(get(fields, 'person'));
  const title = clean(get(fields, 'title', 'target', 'topic'));
  const explicitStage = clean(get(fields, 'stage'));
  const derivedDentalStage = kind === 'dental' ? dentalStage(fields) : '';
  const stage = kind === 'dental' ? explicitStage || derivedDentalStage : explicitStage || clean(get(fields, 'deadline status'));
  const nextStep = clean(get(fields, 'next step'));
  const action = clean(get(fields, 'action')), detail = source.excerpt || Object.values(fields).join(' | ');
  if (isSummary(company || person || title)) return null;
  const classify = (value: string) => /assessment|take.home|test task|survey|intro video/i.test(value) ? 'assessment' : /interview/i.test(value) ? 'interview' : '';
  // Anticipated events ("watch for an interview invite") are not interviews; only evidenced ones classify.
  const anticipatory = (value: string) => /\b(?:watch(?:ing)?|await(?:ing)?|waiting|hop(?:e|ing)|possible|potential|chase|if|may|might|invite|invitation)\b/i.test(value);
  const classifyEvidence = (value: string) => anticipatory(value) && !/\b(?:held|scheduled|booked|completed|submitted|done|took|taken|passed)\b/i.test(value) ? '' : classify(value);
  const opportunityAction = classify(explicitStage) || (explicitStage ? '' : classifyEvidence(nextStep) || classifyEvidence(stage)) || classify(action);
  let actionType: string;
  if (kind === 'dental') actionType = 'dental_lead';
  else if (kind === 'social') actionType = 'social_post';
  else if (kind === 'linkedin' || /linkedin|connection|outreach|message|inmail/i.test(action)) actionType = 'linkedin_touch';
  else actionType = opportunityAction || 'job_application';
  const target = actionType === 'social_post' ? title : actionType === 'linkedin_touch' ? person || company : opportunityText || (company ? [company, role].filter(Boolean).join(' — ') : person);
  if (!target) { warn(diagnostics, source.sheet ? `${source.sheet} row ${source.row}` : `line ${source.line}`, 'missing identifiable target'); return null; }
  const snapshot = ['opportunities', 'dental', 'social'].includes(kind);
  const rawDate = snapshot ? get(fields, 'updated', 'date') : actionType === 'job_application' ? get(fields, 'appliedAt', 'date') : get(fields, 'date');
  const timestamp = rawDate ? parseDate(rawDate) : contextDate;
  if (rawDate && !timestamp) diagnostics.warnings.push(`${source.sheet ? `${source.sheet} row ${source.row}` : `line ${source.line}`}: unknown or invalid date ${JSON.stringify(rawDate)}`);
  const metadata: ExecutionRecord['metadata'] = {};
  for (const [key, value] of Object.entries({ company, role, person, stage, platform: clean(get(fields, 'platform')), city: clean(get(fields, 'city', 'location', 'area', 'town')), waitingOn: clean(get(fields, 'waitingOn', 'owner')), waitingFor: clean(get(fields, 'waitingFor', 'next step')), reply: clean(get(fields, 'reply')), blockedSince: parseDate(get(fields, 'blockedSince')), appliedAt: parseDate(get(fields, 'appliedAt')), updatedAt: parseDate(get(fields, 'updated')) })) if (value) metadata[key] = typeof value === 'string' ? value.slice(0, 4000) : value;
  if (actionType === 'linkedin_touch' && (get(fields, 'touchType') || touchType(action))) metadata.touchType = get(fields, 'touchType') || touchType(action);
  if (get(fields, 'eventId')) metadata.eventId = get(fields, 'eventId');
  const explicit = get(fields, 'status');
  const deadlineState = statusOf(get(fields, 'deadline status'));
  let status: Status;
  if (explicit) status = statusOf(explicit);
  else if (kind === 'dental' && !explicitStage && derivedDentalStage) status = derivedDentalStage === 'Sale' ? 'success' : 'pending';
  else if (explicitStage) status = statusOf(explicitStage);
  else if (deadlineState === 'failed' || deadlineState === 'blocked') status = deadlineState;
  else status = statusOf(nextStep || stage || action);
  return record({ agent: clean(get(fields, 'agent')) || 'Rio', timestamp, actionType, target, detail, status, outputLink: explicitLink(get(fields, 'link')) || linkOf(detail), source, metadata, recordKind: ['opportunities', 'dental', 'social'].includes(kind) ? 'snapshot' : 'execution' });
}

function bulletRecord(text: string, kind: SourceKind, source: SourceRef, date: string | null, diagnostics: Diagnostics): ExecutionRecord | null {
  const plain = clean(text.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/^\[[ xX]\]\s*/, ''));
  if (isSummary(plain)) return summary(source.path, source.excerpt || text, date, source.line);
  const fields: Fields = {};
  const labelled = [...plain.matchAll(/(?:^|[;—|]|\s-\s)\s*(company|role|person|platform|stage|status|waiting on|waiting for|date|action|title)\s*:\s*([^;—|]+)/gi)];
  for (const match of labelled) fields[header(match[1])] = match[2].trim();
  if ((fields.person || fields.company || fields.title) && fields.action) return tableRecord(fields, kind, source, date, diagnostics);
  let actionType = '';
  let target = '';
  const linkedin = plain.match(/(?:sent\s+(?:a\s+)?(?:linkedin\s+)?(?:message|connection(?: request)?|inmail)|(?:plan(?:ned)?|pending|draft(?:ed)?|send)\s+(?:a\s+)?(?:linkedin\s+)?(?:message|connection(?: request)?)|connected|messaged|contacted|reached out)\s+(?:to\s+|with\s+)?(.+?)(?=\s+[—|;]|$)/i);
  const application = plain.match(/(?:applied\s+(?:to|for)|application\s+(?:sent\s+to|submitted\s+to))\s+(.+?)(?=\s+[—|;]|$)/i);
  if (linkedin && (kind === 'linkedin' || /linkedin|connection|inmail/i.test(plain))) { actionType = 'linkedin_touch'; target = linkedin[1].trim(); fields.person ||= target; }
  else if (application && ['applications', 'opportunities'].includes(kind)) { actionType = 'job_application'; target = application[1].trim(); fields.company ||= target; }
  else if (kind === 'dental' && /^(?:contacted|emailed|called|lead)\s+/i.test(plain)) { actionType = 'dental_lead'; target = plain.replace(/^(?:contacted|emailed|called|lead)\s+/i, '').split(/\s+[—|;]/)[0]; fields.company ||= target; }
  else if (kind === 'social' && /\b(published|planned|draft|scheduled)\b/i.test(plain) && fields.platform) { actionType = 'social_post'; target = plain.split(/\s+[—|;]/)[0].replace(/^(?:published|planned|draft|scheduled)\s+/i, ''); fields.title = target; }
  if (!actionType || !target || isSummary(target)) return null;
  const timestamp = fields.date ? parseDate(fields.date) : parseDate(plain) || date;
  const metadata: ExecutionRecord['metadata'] = {};
  for (const key of ['company', 'person', 'role', 'stage', 'platform', 'waitingOn', 'waitingFor']) if (fields[key]) metadata[key] = fields[key];
  if (actionType === 'linkedin_touch' && touchType(plain)) metadata.touchType = touchType(plain);
  return record({ agent: 'Rio', actionType, target, timestamp, status: statusOf(fields.status || plain), detail: source.excerpt || text, outputLink: linkOf(text), source, metadata, recordKind: ['dental', 'social', 'opportunities'].includes(kind) ? 'snapshot' : 'execution' });
}

function timedLinkedInRecord(text: string, source: SourceRef, date: string | null): ExecutionRecord | null {
  const values = cells(text.replace(/^\s*[-*+]\s+/, ''));
  if (values.length < 5 || !/^~?\s*\d{1,2}:\d{2}\s*(?:\([^)]*\)\s*)?PKT(?:\s*\([^)]*\))?$/i.test(values[0])) return null;
  const person = clean(values[1].replace(/\s*\([^)]*\)\s*$/, ''));
  const context = values[1].match(/\(([^)]*)\)\s*$/)?.[1] || '';
  const company = clean(context.includes(',') ? context.split(',').slice(1).join(',') : '');
  const lastCell = values.at(-1) || '';
  const hasLinkCell = values.length >= 6 && (Boolean(linkOf(lastCell)) || /^(?:n\/?a|none|[-—–]|)$/i.test(lastCell.trim()));
  const activity = clean(values[values.length - (hasLinkCell ? 2 : 1)]);
  if (!person || !activity) return null;
  const completedTouch = /\b(liked|commented|reposted|shared|messaged|sent|connected)\b/i.test(activity) && !/\b(?:not|never|no)\s+(?:liked|commented|reposted|shared|messaged|sent|connected)\b/i.test(activity);
  const metadata: ExecutionRecord['metadata'] = { person };
  if (company) metadata.company = company.slice(0, 4000);
  const type = /commented/i.test(activity) ? 'comment' : /liked/i.test(activity) ? 'like' : /^post\b/i.test(values[2] || '') ? 'post' : touchType(activity) || 'other';
  metadata.touchType = type;
  const typeCell = values[values.length - (hasLinkCell ? 3 : 2)];
  if (typeCell) metadata.type = clean(typeCell).slice(0, 4000);
  if (values[2] && values.length >= 6) metadata.subject = clean(values[2]).slice(0, 300);
  return record({ agent: 'Rio', timestamp: date, actionType: 'linkedin_touch', target: person, detail: source.excerpt || text,
    status: completedTouch ? 'success' : (['failed', 'blocked', 'pending', 'planned'] as Status[]).includes(statusOf(activity)) ? statusOf(activity) : 'success', outputLink: linkOf(values.at(-1) || '') || linkOf(text), source,
    recordKind: 'execution', metadata });
}

const AGGREGATE_METRICS: [RegExp, string][] = [[/^sent$/i, 'sent'], [/^repl(?:y|ies)$/i, 'replies'], [/^calls?(?:\s+booked)?$/i, 'calls'], [/^sales?$/i, 'sales']];
/** Daily summary bullets ("- Sent: 5 IG DMs — names"). Filled ones become summary records (never leads); empty template ones are ignored. */
function dentalAggregate(line: string, source: SourceRef, date: string | null): ExecutionRecord | 'empty' | null {
  const m = line.trim().replace(/^[-*+]\s+/, '').replace(/\*\*/g, '').match(/^([A-Za-z ]{3,16}):\s*(.*)$/);
  const metric = m && AGGREGATE_METRICS.find(([re]) => re.test(m[1].trim()))?.[1];
  if (!m || !metric) return null;
  const value = clean(m[2]);
  if (!value || /^(?:none(?:\s+yet)?|no(?:ne)?|n\/?a|nil|tbd|0|—|–|-|\?+|_+)\b[\s.]*$/i.test(value)) return 'empty';
  const count = Number(value.match(/^(\d+)\b/)?.[1]);
  if (count === 0) return 'empty';
  const metadata: ExecutionRecord['metadata'] = { metric, ...(Number.isFinite(count) ? { count } : {}) };
  return record({ agent: 'Rio', timestamp: date, actionType: 'summary', target: `${metric} ${date || 'undated'}`, detail: source.excerpt || line, status: 'unknown', outputLink: null, source, recordKind: 'summary', metadata });
}

function planSlotRecord(heading: string, body: string[], source: SourceRef, date: string | null): ExecutionRecord | null {
  const match = heading.match(/^#{2,6}\s+\d{1,2}:\d{2}\s+[—–-]\s+(.+?)\s+\(([^)]+)\)\s+[—–-]\s+(READY|BLOCKED|PUBLISHED)\s*$/i);
  if (!match) return null;
  const target = clean(match[1]);
  if (!target) return null;
  const label = clean(match[2]);
  const platform = /\binstagram\b/i.test(label) ? 'Instagram' : /\blinkedin\b/i.test(label) ? 'LinkedIn' : label.split(/\s+/)[0];
  const liveLink = body.map(line => line.match(/^[-*+]\s*(?:\*\*)?(?:published|live)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(\S*https?:\/\/\S+)/i)?.[1]).find(Boolean);
  const status: Status = liveLink || match[3].toUpperCase() === 'PUBLISHED' ? 'published' : match[3].toUpperCase() === 'BLOCKED' ? 'blocked' : 'planned';
  const detail = [heading, ...body].join('\n').slice(0, 16000);
  const metadata: ExecutionRecord['metadata'] = { platform, stage: status === 'published' ? 'PUBLISHED' : match[3].toUpperCase() };
  if (status === 'blocked' && date) metadata.blockedSince = date;
  return record({ agent: 'Rio', timestamp: date, actionType: 'social_post', target, detail, status,
    outputLink: liveLink ? linkOf(liveLink) : linkOf(detail), source, recordKind: 'snapshot', metadata });
}

function parseMarkdown(text: string, path: string, kind: SourceKind, diagnostics: Diagnostics): ExecutionRecord[] {
  if (kind === 'memory') return text.trim() ? [summary(path, text.trim(), parseDate(basename(path)))] : [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records: ExecutionRecord[] = [];
  let date: string | null = null, headings: string[] | null = null, lastHeadings: string[] | null = null, fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    if (/^```|^~~~/.test(trimmed)) { fenced = !fenced; continue; }
    if (fenced || !trimmed) { if (!trimmed) headings = null; continue; }
    if (kind === 'social' && /^#{2,6}\s+\d{1,2}:\d{2}\s+[—–-]/.test(trimmed)) {
      let end = i + 1;
      while (end < lines.length && !/^#{1,6}\s/.test(lines[end].trim())) end++;
      const source = { path, line: i + 1, excerpt: line };
      const folder = basename(dirname(path));
      const slotDate = /^\d{4}-\d{2}-\d{2}$/.test(folder) ? parseDate(folder) : null;
      const parsed = planSlotRecord(trimmed, lines.slice(i + 1, end).map(value => value.trim()).filter(Boolean), source, slotDate);
      if (parsed) { records.push(parsed); i = end - 1; headings = null; continue; }
    }
    if (/^#{1,6}\s/.test(trimmed)) { const parsed = parseDate(trimmed); if (parsed || /\d{4}|\d{1,2}\/\d/.test(trimmed)) date = parsed; headings = null; continue; }
    if (/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(trimmed)) { date = parseDate(trimmed); headings = null; continue; }
    const source = { path, line: i + 1, excerpt: line };
    if (line.includes('|')) {
      const values = cells(line);
      if (values.every(v => /^:?-{3,}:?$/.test(v))) continue;
      if (i + 1 < lines.length && cells(lines[i + 1]).every(v => /^:?-{3,}:?$/.test(v))) { headings = lastHeadings = values.map(header); continue; }
      // A pipe-delimited row after a blank line or heading resumes the last table header until a new header row appears.
      if (!headings && trimmed.startsWith('|') && lastHeadings) headings = lastHeadings;
      if (!headings && trimmed.startsWith('|')) { warn(diagnostics, `line ${i + 1}`, `table row with no header row above it: ${snippet(line)}`); continue; }
      if (headings) {
        if (values.length > headings.length) values.splice(headings.length - 1, values.length - headings.length + 1, values.slice(headings.length - 1).join(' | '));
        if (values.length !== headings.length) { warn(diagnostics, `line ${i + 1}`, `table column count differs from header (${values.length} cells, expected ${headings.length}): ${snippet(line)}`); continue; }
        const fields = Object.fromEntries(headings.map((h, index) => [h, values[index]]));
        if (isSummary(values[0])) { diagnostics.skipped++; continue; }
        const parsed = tableRecord(fields, kind, source, date, diagnostics); if (parsed) records.push(parsed);
        continue;
      }
    }
    if (kind === 'dental' && /^\s*[-*+]\s/.test(line)) {
      const aggregate = dentalAggregate(line, source, date);
      if (aggregate === 'empty') continue;
      if (aggregate) { records.push(aggregate); continue; }
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) {
      const parsed = kind === 'linkedin' ? timedLinkedInRecord(line, source, date) || bulletRecord(line, kind, source, date, diagnostics) : bulletRecord(line, kind, source, date, diagnostics);
      if (parsed) records.push(parsed); else warn(diagnostics, `line ${i + 1}`, `unrecognized activity; retained in source only: ${snippet(line)}`);
    }
  }
  if (kind === 'applications') {
    // The apply engine states a reconciled submissions total in the log ("Clean total stays 272").
    // Carry the latest statement as a summary record so the dashboard can show applications
    // actually sent separately from every role the log merely records.
    const matches: { count: number; line: number; date: string | null }[] = [];
    lines.forEach((line, i) => { const m = line.match(/clean total\s*:?\s*\(?\s*(?:stays|is|now)?\s*(\d+)/i); if (m) matches.push({ count: Number(m[1]), line: i + 1, date: parseDate(line) }); });
    const last = matches.at(-1);
    if (last) records.push(record({ agent: 'Rio', timestamp: last.date, actionType: 'summary', target: `applications_sent ${last.date || 'undated'}`, detail: `Applications sent (reconciled total stated in the applied log): ${last.count}`, status: 'unknown', outputLink: null, source: { path, line: last.line, excerpt: lines[last.line - 1] }, recordKind: 'summary', metadata: { metric: 'applications_sent', count: last.count } }));
  }
  return records;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('hyperlink' in value) return `[${value.text}](${value.hyperlink})`;
    if ('richText' in value) return value.richText.map(r => r.text).join('');
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}
async function parseWorkbook(buffer: Buffer, path: string, diagnostics: Diagnostics, now: Date): Promise<ExecutionRecord[]> {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return withDateContext(path, now, () => parseSheets(workbook, path, diagnostics));
}
function parseSheets(workbook: ExcelJS.Workbook, path: string, diagnostics: Diagnostics): ExecutionRecord[] {
  const records: ExecutionRecord[] = [];
  for (const sheet of workbook.worksheets) {
    let headings: string[] | null = null;
    sheet.eachRow((row, rowNumber) => {
      const values: string[] = []; for (let i = 1; i <= row.cellCount; i++) values.push(cellText(row.getCell(i).value));
      if (!values.some(v => v.trim())) return;
      if (!headings) {
        const candidate = values.map(header);
        if (candidate.includes('company') || candidate.includes('person') || candidate.includes('opportunity')) headings = candidate;
        else warn(diagnostics, `${sheet.name} row ${rowNumber}`, 'no recognized header');
        return;
      }
      if (isSummary(values[0])) { diagnostics.skipped++; return; }
      const fields = Object.fromEntries(headings.map((h, i) => [h, values[i] || '']));
      const source = { path, sheet: sheet.name, row: rowNumber, excerpt: values.join(' | ') };
      const parsed = tableRecord(fields, 'opportunities', source, null, diagnostics); if (parsed) records.push(parsed);
    });
  }
  return records;
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isMissing(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
/** Expand path-segment wildcards, following matching file and directory symlinks. */
async function filesFor(pattern: string): Promise<string[]> {
  if (!/[*?]/.test(pattern)) return [pattern];
  const absolute = resolve(pattern), parts = absolute.split(sep).filter(Boolean);
  let paths: string[] = [sep];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index], next: string[] = [];
    for (const parent of paths) {
      if (!/[*?]/.test(part)) {
        const path = join(parent, part);
        if (index !== parts.length - 1) { next.push(path); continue; }
        try { await stat(path); next.push(path); }
        catch (error) { if (!isMissing(error)) next.push(path); }
        continue;
      }
      const regex = new RegExp(`^${part.split(/([*?])/).map(p => p === '*' ? '.*' : p === '?' ? '.' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
      let entries;
      try { entries = await readdir(parent, { withFileTypes: true }); } catch (error) { if (isMissing(error)) continue; throw error; }
      for (const entry of entries) {
        if (!regex.test(entry.name)) continue;
        const path = join(parent, entry.name);
        let target: { isFile(): boolean; isDirectory(): boolean } = entry;
        if (entry.isSymbolicLink()) {
          try { target = await stat(path); }
          catch (error) { if (isMissing(error)) continue; throw error; }
        }
        if (index === parts.length - 1 ? target.isFile() : target.isDirectory()) next.push(path);
      }
    }
    paths = next;
  }
  return paths.sort();
}
function clampMessage(warnings: string[], limit = 60000): string {
  let text = '';
  for (let i = 0; i < warnings.length; i++) {
    const next = text ? `${text}\n${warnings[i]}` : warnings[i];
    if (next.length > limit - 80) return `${text}\n… ${warnings.length - i} more diagnostics omitted`;
    text = next;
  }
  return text;
}
async function sourceImport(path: string, kind: SourceKind, now: Date, workbook = false): Promise<ImportResult> {
  const report: SourceReport = { path, kind, status: 'ok', records: 0, skipped: 0, message: '', importedAt: now.toISOString() };
  const diagnostics: Diagnostics = { skipped: 0, warnings: [] }, records: ExecutionRecord[] = [];
  let files: string[];
  try { files = await filesFor(path); }
  catch (error) { report.status = isMissing(error) ? 'missing' : 'error'; report.message = errorMessage(error); return { records, sources: [report] }; }
  if (!files.length) { report.status = 'missing'; report.message = 'No matching source files'; }
  let failures = 0;
  for (const file of files) {
    const firstWarning = diagnostics.warnings.length;
    try {
      const buffer = await readFile(file);
      const parsed = workbook ? await parseWorkbook(buffer, file, diagnostics, now) : withDateContext(file, now, () => parseMarkdown(buffer.toString('utf8'), file, kind, diagnostics));
      records.push(...parsed);
      if (!parsed.length) diagnostics.warnings.push(`${file}: no recognized records; empty or unparseable source`);
    } catch (error) { failures++; diagnostics.skipped++; if (isMissing(error) && files.length === 1) report.status = 'missing'; diagnostics.warnings.push(`${file}: could not be read (${errorMessage(error)}); skipped this file`); }
    if (files.length > 1) for (let w = firstWarning; w < diagnostics.warnings.length; w++) if (!diagnostics.warnings[w].startsWith(file)) diagnostics.warnings[w] = `${file} ${diagnostics.warnings[w]}`;
  }
  if (failures && report.status !== 'missing') report.status = failures === files.length ? 'error' : 'ok';
  report.records = records.length; report.skipped = diagnostics.skipped;
  report.message = diagnostics.warnings.length ? clampMessage(diagnostics.warnings) : report.message || `Imported ${records.length} records read-only`;
  return { records, sources: [report] };
}

export async function importRio(options: { home?: string; paths?: Partial<Record<SourceKind | 'workbook', string>>; now?: Date } = {}): Promise<ImportResult> {
  const home = options.home || homedir(), now = options.now || new Date();
  const defaults = {
    applications: join(home, 'workspace/job-hunt-2026-10-10/applied-log.md'),
    opportunities: join(home, 'workspace/job-hunt-2026-10-10/OPPORTUNITY-LEDGER.md'),
    workbook: join(home, 'workspace/job-hunt-2026-10-10/opportunity-tracker.xlsx'),
    linkedin: join(home, '.claude/linkedin/log.md'),
    dental: join(home, 'workspace/metamuse/MetaMuse-Operating-Kit/brain/strategy/cash-track/log.md'),
    social: join(home, 'workspace/content-crew/deliveries/*/PLAN.md'), memory: join(home, 'memory/????-??-??.md'),
  };
  const imports = await Promise.all(Object.entries(defaults).map(([key, path]) => {
    const selected = options.paths?.[key as keyof typeof defaults] || path;
    return sourceImport(selected.startsWith('~/') ? join(home, selected.slice(2)) : selected, key === 'workbook' ? 'opportunities' : key as SourceKind, now, key === 'workbook');
  }));
  return { records: imports.flatMap(r => r.records), sources: imports.flatMap(r => r.sources) };
}

function inboxRecord(value: unknown, source: SourceRef): ExecutionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record must be an object');
  const input = value as Record<string, unknown>;
  const stringField = (key: string, required = false) => {
    if (input[key] === undefined && !required) return '';
    if (typeof input[key] !== 'string' || (required && !(input[key] as string).trim())) throw new Error(`${key} must be a ${required ? 'nonempty ' : ''}string`);
    return (input[key] as string).trim();
  };
  const agent = stringField('agent', true), actionType = stringField('actionType', true), target = stringField('target', true), detail = stringField('detail');
  if (!actionTypes.has(actionType)) throw new Error('unsupported actionType');
  if (!statuses.has(input.status as Status)) throw new Error('unsupported status');
  const timestamp = input.timestamp === null || input.timestamp === undefined ? null : typeof input.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(input.timestamp) ? parseDate(input.timestamp) : null;
  if (input.timestamp !== null && input.timestamp !== undefined && !timestamp) throw new Error('invalid timestamp');
  const kind = input.recordKind === undefined ? 'execution' : input.recordKind;
  if (!['execution', 'snapshot', 'summary'].includes(String(kind))) throw new Error('unsupported recordKind');
  const metadata: ExecutionRecord['metadata'] = {};
  if (input.metadata !== undefined) {
    if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) throw new Error('metadata must be an object');
    for (const [key, entry] of Object.entries(input.metadata)) {
      if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry) || typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('metadata values must be finite primitives');
      metadata[key] = entry as string | number | boolean | null;
    }
  }
  const outputLink = input.outputLink === undefined || input.outputLink === null ? null : stringField('outputLink');
  const externalId = stringField('id');
  if (externalId) metadata.externalId = externalId;
  return record({ agent, timestamp, actionType, target, detail, status: input.status as Status, outputLink, source, metadata, recordKind: kind as ExecutionRecord['recordKind'] }, stringField('entityKey') || undefined, externalId ? hash(JSON.stringify([agent, externalId])) : undefined);
}

/** Locate actual JSON object starts without mistaking braces inside quoted strings for structure. */
function jsonObjectLocations(text: string, depth: number): { line: number; excerpt: string }[] {
  const locations: { line: number; excerpt: string }[] = [];
  let quoted = false, escaped = false, line = 1;
  const stack: { start: number; line: number; type: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '\n') line++;
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') { quoted = true; continue; }
    if (character === '{' || character === '[') stack.push({ start: i, line, type: character });
    else if (character === '}' || character === ']') {
      const opened = stack.pop();
      if (opened?.type === '{' && stack.length === depth) locations.push({ line: opened.line, excerpt: text.slice(opened.start, i + 1) });
    }
  }
  return locations;
}

export async function importInbox(directory: string, now = new Date()): Promise<ImportResult> {
  let files: string[];
  try { files = (await readdir(directory, { withFileTypes: true })).filter(e => e.isFile() && /\.jsonl?$/i.test(e.name)).map(e => join(directory, e.name)).sort(); }
  catch (error) { return { records: [], sources: [{ path: directory, kind: 'inbox', status: isMissing(error) ? 'missing' : 'error', records: 0, skipped: 0, message: errorMessage(error), importedAt: now.toISOString() }] }; }
  const result: ImportResult = { records: [], sources: [] };
  if (!files.length) result.sources.push({ path: directory, kind: 'inbox', status: 'ok', records: 0, skipped: 0, message: 'No JSON or JSONL files in inbox', importedAt: now.toISOString() });
  for (const path of files) {
    const source: SourceReport = { path, kind: 'inbox', status: 'ok', records: 0, skipped: 0, message: '', importedAt: now.toISOString() }, warnings: string[] = [];
    const accept = (value: unknown, line: number, excerpt: string) => {
      try { result.records.push(inboxRecord(value, { path, line, excerpt })); source.records++; }
      catch (error) { source.skipped++; warnings.push(`line ${line}: ${errorMessage(error)}`); }
    };
    try {
      const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
      if (/\.jsonl$/i.test(path)) {
        text.split(/\r?\n/).forEach((line, index) => {
          if (!line.trim()) return;
          try { accept(JSON.parse(line), index + 1, line); } catch (error) { source.skipped++; warnings.push(`line ${index + 1}: invalid JSON (${errorMessage(error)})`); }
        });
      } else {
        const value = JSON.parse(text), isArray = Array.isArray(value), wrapped = !isArray && Array.isArray(value?.records), rows = isArray ? value : wrapped ? value.records : [value];
        const locations = jsonObjectLocations(text, isArray ? 1 : wrapped ? 2 : 0);
        let locationIndex = 0;
        rows.forEach((row: unknown) => {
          const location = row && typeof row === 'object' && !Array.isArray(row) ? locations[locationIndex++] : undefined;
          accept(row, location?.line || 1, location?.excerpt || JSON.stringify(row));
        });
      }
    } catch (error) { source.status = 'error'; warnings.push(errorMessage(error)); }
    source.message = warnings.length ? warnings.join('\n') : `Imported ${source.records} records read-only`;
    result.sources.push(source);
  }
  return result;
}
