import type { DashboardData } from "../shared/types";

export type ModuleId = "overview" | "applications" | "interviews" | "linkedin" | "dental" | "social" | "agents";
export const MODULES: { id: ModuleId; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "/overview" },
  { id: "applications", label: "Applications", path: "/applications" },
  { id: "interviews", label: "Interviews & Assessments", path: "/interviews" },
  { id: "linkedin", label: "LinkedIn Outreach", path: "/linkedin" },
  { id: "dental", label: "Dental Leads", path: "/dental" },
  { id: "social", label: "Social", path: "/social" },
  { id: "agents", label: "Agents", path: "/agents" },
];
const legacy: Record<string, ModuleId> = { activity: "agents", pipelines: "interviews", sources: "agents" };

/** Hash routes: `#/applications`. Legacy `#agents`-style anchors and unknown values resolve safely. */
export function parseRoute(hash: string): ModuleId {
  const key = hash.replace(/^#\/?/, "").split(/[/?]/)[0].toLowerCase();
  return MODULES.find((m) => m.id === key)?.id ?? legacy[key] ?? "overview";
}
export const routeHref = (id: ModuleId) => `#${MODULES.find((m) => m.id === id)!.path}`;

export type Tone = "ok" | "warn" | "alert" | "empty";
export interface Bar { label: string; count: number; recordIds: string[] }
export interface ModuleSummary {
  id: Exclude<ModuleId, "overview">;
  label: string;
  value: number | null; // null = No data recorded
  caption: string;
  detail: string;
  tone: Tone;
  alerts: number;
  bars: Bar[];
}

const kpi = (data: DashboardData, id: string) => data.kpis.find((k) => k.id === id);
const kpiValue = (data: DashboardData, id: string) => kpi(data, id)?.value ?? null;
const shortDate = (date: string) => String(Number(date.slice(8, 10)));
export const daysToBars = (days: { date: string; count: number; recordIds: string[] }[]): Bar[] =>
  days.map((d) => ({ label: shortDate(d.date), count: d.count, recordIds: d.recordIds }));

export function staleIn(data: DashboardData, ids: Iterable<string>) {
  const wanted = new Set(ids);
  return data.stale.filter((s) => wanted.has(s.recordId));
}
export const staleMap = (data: DashboardData) => new Map(data.stale.map((s) => [s.recordId, s]));
/** Stale days within a single entity group, largest first. */
export const STALE_DAYS = 3;

const sum = (bars: { count: number }[]) => bars.reduce((total, bar) => total + bar.count, 0);

/** Client-side day key in the dashboard timezone (date-only strings pass through). */
export function dayKeyIn(timestamp: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp)); }
  catch { return timestamp.slice(0, 10); }
}
/** Records per day over [today - back, today + forward], for mini charts. Counts only dated records. */
export function perDay(rows: { id: string; timestamp: string | null }[], today: string, timezone: string, back: number, forward = 0): Bar[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: back + forward + 1 }, (_, i) => {
    const date = new Date(base + (i - back) * 86400000).toISOString().slice(0, 10);
    const ids = rows.filter((r) => r.timestamp && dayKeyIn(r.timestamp, timezone) === date).map((r) => r.id);
    return { label: shortDate(date), count: ids.length, recordIds: ids };
  });
}

export function moduleSummaries(data: DashboardData): ModuleSummary[] {
  const e = data.entities;
  const attentionIds = (kind: string, ids: Set<string>) => data.attention.filter((a) => a.kind === kind && ids.has(a.recordId)).length;
  const pipelineIds = new Set([...e.interviews, ...e.assessments].map((r) => r.id));
  const pipelineStale = attentionIds("stale", pipelineIds);
  const dentalStale = attentionIds("stale", new Set(e.dental.map((r) => r.id)));
  const socialBlockedToday = attentionIds("blocked", new Set(e.social.map((r) => r.id)));
  const failedRuns = data.attention.filter((a) => a.kind === "failed").length;
  const socialBlocked = data.socialPlatforms.reduce((total, p) => total + p.blocked, 0);
  const socialPlanned = data.socialPlatforms.reduce((total, p) => total + p.planned, 0);
  const sourceProblems = data.sources.filter((s) => s.status === "error").length;
  const missing = data.sources.filter((s) => s.status === "missing").length;
  const tone = (value: number | null, alerts: number, warn = false): Tone => value === null ? "empty" : alerts > 0 ? "alert" : warn ? "warn" : "ok";
  const apps = kpiValue(data, "applications-total");
  const week = kpiValue(data, "applications-week");
  const interviews = kpiValue(data, "interviews");
  const assessments = kpiValue(data, "assessments");
  const li = kpiValue(data, "linkedin-total");
  const liToday = kpiValue(data, "linkedin-today");
  const dental = kpiValue(data, "dental-total");
  const posts = kpiValue(data, "posts-week");
  const hasSocial = e.social.length > 0;
  const noPipeline = interviews === null && assessments === null;
  const today = data.today.date;
  const socialBars = perDay(e.social, today, data.timezone, 6, 7);
  const activityBars = perDay(data.records, today, data.timezone, 13);
  return [
    { id: "applications", label: "Applications", value: apps, caption: "applications", bars: daysToBars(data.applicationsDaily),
      detail: apps === null ? "No data recorded" : `${week ?? 0} this week · ${sum(data.applicationsDaily)} in last 14 days`, alerts: 0, tone: tone(apps, 0) },
    { id: "interviews", label: "Interviews & Assessments", value: noPipeline ? null : (interviews ?? 0) + (assessments ?? 0), caption: "open", bars: data.pipelineStages.filter((s) => s.stage !== "Applied").map((s) => ({ label: s.stage, count: s.count, recordIds: s.recordIds })),
      detail: noPipeline ? "No data recorded" : `${interviews ?? 0} interviews · ${assessments ?? 0} assessments`, alerts: pipelineStale, tone: tone(noPipeline ? null : 1, pipelineStale) },
    { id: "linkedin", label: "LinkedIn Outreach", value: li, caption: "touches", bars: daysToBars(data.linkedinDaily),
      detail: li === null ? "No data recorded" : `${liToday ?? 0} today · ${sum(data.linkedinDaily)} in last 14 days`, alerts: 0, tone: tone(li, 0) },
    { id: "dental", label: "Dental Leads", value: dental, caption: "leads", bars: data.dentalStages.map((s) => ({ label: s.stage, count: s.count, recordIds: s.recordIds })),
      detail: dental === null ? "No data recorded" : `${data.dentalStages.length} stage${data.dentalStages.length === 1 ? "" : "s"}${dentalStale ? ` · ${dentalStale} stale` : ""}`, alerts: dentalStale, tone: tone(dental, dentalStale) },
    { id: "social", label: "Social", value: hasSocial ? posts ?? 0 : null, caption: "published, 7 days", bars: socialBars,
      detail: hasSocial ? `${socialPlanned} upcoming · ${socialBlocked} blocked` : "No data recorded", alerts: socialBlockedToday, tone: tone(hasSocial ? 1 : null, socialBlockedToday) },
    { id: "agents", label: "Agents", value: data.agents.length ? data.agents.length : null, caption: data.agents.length === 1 ? "agent" : "agents", bars: activityBars,
      detail: !data.sources.length ? "No data recorded" : `${data.records.length.toLocaleString()} records · ${sourceProblems + missing} source issue${sourceProblems + missing === 1 ? "" : "s"}`, alerts: failedRuns + sourceProblems, tone: tone(data.agents.length ? 1 : null, failedRuns + sourceProblems, missing > 0) },
  ];
}

export function attentionCount(data: DashboardData): number {
  return data.attention.length;
}
export function barMax(bars: { count: number }[]): number {
  return Math.max(1, ...bars.map((b) => b.count));
}

/** Count records by recorded stage (falls back to status). */
export function stageCounts(records: { id: string; status: string; metadata: Record<string, unknown> }[]) {
  const groups = new Map<string, string[]>();
  for (const r of records) {
    const stage = String(r.metadata.stage || "").trim() || r.status.replaceAll("_", " ");
    groups.set(stage, [...(groups.get(stage) || []), r.id]);
  }
  return [...groups].map(([stage, recordIds]) => ({ stage, count: recordIds.length, recordIds })).sort((a, b) => b.count - a.count);
}
