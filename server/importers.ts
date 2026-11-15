import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
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
  position: 'role', 'job title': 'role', 'job role': 'role', 'contact name': 'person', contact: 'person', name: 'person',
  state: 'status', outcome: 'status', 'current stage': 'stage', 'pipeline stage': 'stage',
  'applied on': 'appliedAt', 'applied date': 'appliedAt', 'application date': 'appliedAt', 'date applied': 'appliedAt', 'sent on': 'date', day: 'date',
  'updated at': 'updated', 'last updated': 'updated', 'last activity': 'updated', timestamp: 'date',
  output: 'link', url: 'link', proof: 'link', 'output link': 'link', 'post url': 'link', 'assessment link': 'link',
  activity: 'action', type: 'action', 'action type': 'action', channel: 'platform',
  'post title': 'title', post: 'title', content: 'title', 'waiting on': 'waitingOn', 'waiting for': 'waitingFor',
  'blocked since': 'blockedSince', 'response received': 'reply', response: 'reply',
  'touch type': 'touchType', 'event id': 'eventId',
};
const header = (s: string) => { const key = normalize(s); return aliases[key] || key; };
const cells = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());

/** Only unambiguous calendar dates are accepted; file mtimes are never event dates. */
function parseDate(raw: string): string | null {
  const text = clean(raw);
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?\b/);
  let y: number, m: number, d: number;
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s*,?\s*(\d{4})\b/) || text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/);
    if (!named) return null;
    const dayFirst = /^\d/.test(named[1]);
    d = Number(named[dayFirst ? 1 : 2]); y = Number(named[3]);
    const month = named[dayFirst ? 2 : 1].toLowerCase();
    m = months.findIndex(v => v === month || v.slice(0, 3) === month) + 1;
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
function warn(d: Diagnostics, location: string, message: string) { d.skipped += 1; d.warnings.push(`${location}: ${message}`); }
function entityFor(type: string, target: string, metadata: ExecutionRecord['metadata']): string {
  if (['job_application', 'interview', 'assessment'].includes(type)) return `application:${normalize(String(metadata.company || target))}:${normalize(String(metadata.role || ''))}`;
  if (type === 'linkedin_touch') return `linkedin:${normalize(String(metadata.person || target))}`;
  if (type === 'dental_lead') return `dental:${normalize(String(metadata.company || metadata.person || target))}`;
  if (type === 'social_post') return `social:${normalize(String(metadata.platform || 'unknown'))}:${normalize(target)}`;
  return `${type}:${normalize(target)}`;
}
function record(input: Omit<ExecutionRecord, 'id' | 'entityKey'>, entityKey?: string, id?: string): ExecutionRecord {
  return { ...input, entityKey: entityKey || entityFor(input.actionType, input.target, input.metadata), id: id || `rio_${hash(JSON.stringify([input.agent, input.source.path, input.source.sheet, input.source.row || input.source.line, input.actionType, input.target, input.detail]))}` };
}
function isSummary(text: string) {
  return /^(?:total|totals|summary|daily total|weekly total)\b/i.test(clean(text)) || /^\d+\s+(?:posts?|contacts?|messages?|applications?|leads?)\b/i.test(clean(text));
}
function summary(path: string, detail: string, timestamp: string | null, line = 1): ExecutionRecord {
  return record({ agent: 'Rio', timestamp, actionType: 'summary', target: basename(path), detail, status: 'unknown', outputLink: null, source: { path, line, excerpt: detail }, recordKind: 'summary', metadata: {} });
}

function tableRecord(fields: Fields, kind: SourceKind, source: SourceRef, contextDate: string | null, diagnostics: Diagnostics): ExecutionRecord | null {
  const company = clean(get(fields, 'company')), role = clean(get(fields, 'role')), person = clean(get(fields, 'person'));
  const title = clean(get(fields, 'title', 'target', 'topic')), stage = clean(get(fields, 'stage'));
  const action = clean(get(fields, 'action')), detail = source.excerpt || Object.values(fields).join(' | ');
  if (isSummary(company || person || title)) return null;
  const evidence = `${action} ${stage} ${get(fields, 'status')}`;
  let actionType: string;
  if (kind === 'dental') actionType = 'dental_lead';
  else if (kind === 'social') actionType = 'social_post';
  else if (kind === 'linkedin' || /linkedin|connection|outreach|message|inmail/i.test(action)) actionType = 'linkedin_touch';
  else if (/assessment|take.home|test task/i.test(evidence)) actionType = 'assessment';
  else if (/interview/i.test(evidence)) actionType = 'interview';
  else actionType = 'job_application';
  const target = actionType === 'social_post' ? title : actionType === 'linkedin_touch' ? person || company : company ? [company, role].filter(Boolean).join(' — ') : person;
  if (!target) { warn(diagnostics, source.sheet ? `${source.sheet} row ${source.row}` : `line ${source.line}`, 'missing identifiable target'); return null; }
  const snapshot = ['opportunities', 'dental', 'social'].includes(kind);
  const rawDate = snapshot ? get(fields, 'updated', 'date') : actionType === 'job_application' ? get(fields, 'appliedAt', 'date') : get(fields, 'date');
  const timestamp = rawDate ? parseDate(rawDate) : contextDate;
  if (rawDate && !timestamp) diagnostics.warnings.push(`${source.sheet ? `${source.sheet} row ${source.row}` : `line ${source.line}`}: unknown or invalid date ${JSON.stringify(rawDate)}`);
  const metadata: ExecutionRecord['metadata'] = {};
  for (const [key, value] of Object.entries({ company, role, person, stage, platform: clean(get(fields, 'platform')), waitingOn: clean(get(fields, 'waitingOn')), waitingFor: clean(get(fields, 'waitingFor')), reply: clean(get(fields, 'reply')), blockedSince: parseDate(get(fields, 'blockedSince')), appliedAt: parseDate(get(fields, 'appliedAt')), updatedAt: parseDate(get(fields, 'updated')) })) if (value) metadata[key] = value;
  if (actionType === 'linkedin_touch' && (get(fields, 'touchType') || touchType(action))) metadata.touchType = get(fields, 'touchType') || touchType(action);
  if (get(fields, 'eventId')) metadata.eventId = get(fields, 'eventId');
  const explicit = get(fields, 'status');
  return record({ agent: clean(get(fields, 'agent')) || 'Rio', timestamp, actionType, target, detail, status: statusOf(explicit || evidence), outputLink: explicitLink(get(fields, 'link')) || linkOf(detail), source, metadata, recordKind: ['opportunities', 'dental', 'social'].includes(kind) ? 'snapshot' : 'execution' });
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

function parseMarkdown(text: string, path: string, kind: SourceKind, diagnostics: Diagnostics): ExecutionRecord[] {
  if (kind === 'memory') return text.trim() ? [summary(path, text.trim(), parseDate(basename(path)))] : [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records: ExecutionRecord[] = [];
  let date: string | null = null, headings: string[] | null = null, fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], trimmed = line.trim();
    if (/^```|^~~~/.test(trimmed)) { fenced = !fenced; continue; }
    if (fenced || !trimmed) { if (!trimmed) headings = null; continue; }
    if (/^#{1,6}\s/.test(trimmed)) { const parsed = parseDate(trimmed); if (parsed || /\d{4}|\d{1,2}\/\d/.test(trimmed)) date = parsed; headings = null; continue; }
    if (/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})$/.test(trimmed)) { date = parseDate(trimmed); headings = null; continue; }
    const source = { path, line: i + 1, excerpt: line };
    if (line.includes('|')) {
      const values = cells(line);
      if (values.every(v => /^:?-{3,}:?$/.test(v))) continue;
      if (i + 1 < lines.length && cells(lines[i + 1]).every(v => /^:?-{3,}:?$/.test(v))) { headings = values.map(header); continue; }
      if (headings) {
        if (values.length !== headings.length) { warn(diagnostics, `line ${i + 1}`, 'table column count differs from header'); continue; }
        const fields = Object.fromEntries(headings.map((h, index) => [h, values[index]]));
        if (isSummary(values[0])) { diagnostics.skipped++; continue; }
        const parsed = tableRecord(fields, kind, source, date, diagnostics); if (parsed) records.push(parsed);
        continue;
      }
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) {
      const parsed = bulletRecord(line, kind, source, date, diagnostics); if (parsed) records.push(parsed); else warn(diagnostics, `line ${i + 1}`, 'unrecognized activity; retained in source only');
    }
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
async function parseWorkbook(buffer: Buffer, path: string, diagnostics: Diagnostics): Promise<ExecutionRecord[]> {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const records: ExecutionRecord[] = [];
  for (const sheet of workbook.worksheets) {
    let headings: string[] | null = null;
    sheet.eachRow((row, rowNumber) => {
      const values: string[] = []; for (let i = 1; i <= row.cellCount; i++) values.push(cellText(row.getCell(i).value));
      if (!values.some(v => v.trim())) return;
      if (!headings) {
        const candidate = values.map(header);
        if (candidate.includes('company') || candidate.includes('person')) headings = candidate;
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
/** Expand only path-segment wildcards, without following directory symlinks. */
async function filesFor(pattern: string): Promise<string[]> {
  if (!/[*?]/.test(pattern)) return [pattern];
  const absolute = resolve(pattern), parts = absolute.split(sep).filter(Boolean);
  let paths: string[] = [sep];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index], next: string[] = [];
    for (const parent of paths) {
      if (!/[*?]/.test(part)) { next.push(join(parent, part)); continue; }
      const regex = new RegExp(`^${part.split(/([*?])/).map(p => p === '*' ? '.*' : p === '?' ? '.' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
      let entries;
      try { entries = await readdir(parent, { withFileTypes: true }); } catch (error) { if (isMissing(error)) continue; throw error; }
      for (const entry of entries) if (!entry.isSymbolicLink() && regex.test(entry.name) && (index === parts.length - 1 ? entry.isFile() : entry.isDirectory())) next.push(join(parent, entry.name));
    }
    paths = next;
  }
  return paths.sort();
}
async function sourceImport(path: string, kind: SourceKind, now: Date, workbook = false): Promise<ImportResult> {
  const report: SourceReport = { path, kind, status: 'ok', records: 0, skipped: 0, message: '', importedAt: now.toISOString() };
  const diagnostics: Diagnostics = { skipped: 0, warnings: [] }, records: ExecutionRecord[] = [];
  let files: string[];
  try { files = await filesFor(path); }
  catch (error) { report.status = isMissing(error) ? 'missing' : 'error'; report.message = errorMessage(error); return { records, sources: [report] }; }
  if (!files.length) { report.status = 'missing'; report.message = 'No matching source files'; }
  for (const file of files) {
    try {
      const buffer = await readFile(file);
      const parsed = workbook ? await parseWorkbook(buffer, file, diagnostics) : parseMarkdown(buffer.toString('utf8'), file, kind, diagnostics);
      records.push(...parsed);
      if (!parsed.length) diagnostics.warnings.push(`${file}: no recognized records; empty or unparseable source`);
    } catch (error) { report.status = isMissing(error) && files.length === 1 ? 'missing' : 'error'; diagnostics.warnings.push(`${file}: ${errorMessage(error)}`); }
  }
  report.records = records.length; report.skipped = diagnostics.skipped;
  report.message = diagnostics.warnings.length ? diagnostics.warnings.join('\n') : report.message || `Imported ${records.length} records read-only`;
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
