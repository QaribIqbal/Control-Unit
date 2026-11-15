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

export function moduleSummaries(data: DashboardData): ModuleSummary[] {
  const e = data.entities;
  const pipelineIds = [...e.interviews, ...e.assessments].map((r) => r.id);
  const pipelineStale = staleIn(data, pipelineIds).length;
  const dentalStale = staleIn(data, e.dental.map((r) => r.id)).length;
  const socialBlocked = data.socialPlatforms.reduce((total, p) => total + p.blocked, 0);
  const socialPlanned = data.socialPlatforms.reduce((total, p) => total + p.planned, 0);
  const agentProblems = data.agents.reduce((total, a) => total + a.failed.length + a.blocked.length, 0);
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
  const hasSocial = data.entities.social.length > 0;
  const unverified = data.verification.length;
  return [
    { id: "applications", label: "Applications", value: apps, caption: "applied in total", bars: daysToBars(data.applicationsDaily),
      detail: apps === null ? "No data recorded" : `${week ?? 0} this week · ${sum(data.applicationsDaily)} in last 14 days`, alerts: 0, tone: tone(apps, 0) },
    { id: "interviews", label: "Interviews & Assessments", value: interviews === null && assessments === null ? null : (interviews ?? 0) + (assessments ?? 0), caption: "open", bars: [],
      detail: interviews === null && assessments === null ? "No data recorded" : `${interviews ?? 0} interviews · ${assessments ?? 0} assessments`, alerts: pipelineStale, tone: tone(interviews === null && assessments === null ? null : 1, pipelineStale) },
    { id: "linkedin", label: "LinkedIn Outreach", value: li, caption: "touches recorded", bars: daysToBars(data.linkedinDaily),
      detail: li === null ? "No data recorded" : `${liToday ?? 0} today · ${sum(data.linkedinDaily)} in last 14 days`, alerts: 0, tone: tone(li, 0) },
    { id: "dental", label: "Dental Leads", value: dental, caption: "leads tracked", bars: data.dentalStages.map((s) => ({ label: s.stage, count: s.count, recordIds: s.recordIds })),
      detail: dental === null ? "No data recorded" : `${data.dentalStages.length} stages${dentalStale ? ` · ${dentalStale} stale` : ""}`, alerts: dentalStale, tone: tone(dental, dentalStale) },
    { id: "social", label: "Social", value: hasSocial ? posts ?? 0 : null, caption: "published this week", bars: [],
      detail: hasSocial ? `${socialPlanned} planned · ${socialBlocked} blocked` : "No data recorded", alerts: socialBlocked, tone: tone(hasSocial ? 1 : null, socialBlocked) },
    { id: "agents", label: "Agents", value: data.agents.length ? data.agents.length : null, caption: data.agents.length === 1 ? "agent linked" : "agents linked", bars: [],
      detail: !data.sources.length ? "No data recorded" : `${agentProblems + unverified} flagged · ${sourceProblems + missing} source issues`, alerts: agentProblems + unverified + sourceProblems, tone: tone(data.agents.length ? 1 : null, agentProblems + unverified + sourceProblems, missing > 0) },
  ];
}

export function attentionCount(data: DashboardData): number {
  return data.stale.length + data.verification.length;
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
