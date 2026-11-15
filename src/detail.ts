import type { DashboardData, ExecutionRecord } from "../shared/types";
import { dayKeyIn, type ModuleId } from "./modules";

/** Whose move it is, from the free-text waiting-on/owner field. */
export type Mover = "qarib" | "rio" | "third" | "none";
export function whoseMove(waitingOn: unknown): Mover {
  const t = String(waitingOn ?? "").trim().toLowerCase();
  if (!t || /^(?:not recorded|—|-|n\/?a|none)$/.test(t)) return "none";
  if (/\bqarib\b|\bme\b|\byou\b/.test(t)) return "qarib";
  if (/\brio\b/.test(t)) return "rio";
  return "third";
}

/** Whole days between a record's last update and `today` (both in the dashboard timezone). */
export function daysSince(record: ExecutionRecord, today: string, timezone: string): number | null {
  const updated = typeof record.metadata.updatedAt === "string" && record.metadata.updatedAt ? record.metadata.updatedAt : record.timestamp;
  if (!updated) return null;
  const day = dayKeyIn(updated, timezone);
  const diff = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

export const DENTAL_STAGES = ["Contacted", "Replied", "Call booked", "Sale"] as const;
export type DentalStage = (typeof DENTAL_STAGES)[number];
export function dentalStage(record: ExecutionRecord): DentalStage {
  const t = String(record.metadata.stage || "").toLowerCase();
  if (/\bsale|sold|paid|won\b/.test(t)) return "Sale";
  if (/\bcall|booked|meeting\b/.test(t)) return "Call booked";
  if (/\brepl|respond|response\b/.test(t)) return "Replied";
  return "Contacted";
}

/** Group rows by day (newest first); undated rows go last under "No date recorded". */
export function groupByDay<T extends { timestamp: string | null }>(rows: T[], timezone: string): { day: string | null; rows: T[] }[] {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) { const key = row.timestamp ? dayKeyIn(row.timestamp, timezone) : null; groups.set(key, [...(groups.get(key) || []), row]); }
  return [...groups].map(([day, items]) => ({ day, rows: items })).sort((a, b) => (a.day === null ? 1 : b.day === null ? -1 : b.day.localeCompare(a.day)));
}

export function dayLabel(day: string | null, today: string): string {
  if (!day) return "No date recorded";
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
  const formatted = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  return diff === 0 ? `Today · ${formatted}` : diff === 1 ? `Yesterday · ${formatted}` : diff === -1 ? `Tomorrow · ${formatted}` : formatted;
}

/** The module a record belongs to, for colouring the drawer. */
export function moduleOf(record: ExecutionRecord): ModuleId {
  switch (record.actionType) {
    case "job_application": return "applications";
    case "interview": case "assessment": return "interviews";
    case "linkedin_touch": return "linkedin";
    case "dental_lead": return "dental";
    case "social_post": return "social";
    default: return "agents";
  }
}

/** Verification flags grouped by agent, then by severity. Output/run claims are "high"; log assertions are "low". */
export type Severity = "high" | "low";
export function severityOf(record: ExecutionRecord | undefined): Severity {
  return record && ["output", "run", "task", "social_post"].includes(record.actionType) ? "high" : "low";
}
export function groupFlags(data: DashboardData) {
  const byId = new Map(data.records.map((r) => [r.id, r]));
  const agents = new Map<string, { high: string[]; low: string[] }>();
  for (const flag of data.verification) {
    const record = byId.get(flag.recordId);
    const agent = record?.agent || "Unknown agent";
    const group = agents.get(agent) || { high: [], low: [] };
    group[severityOf(record)].push(flag.recordId);
    agents.set(agent, group);
  }
  return [...agents].map(([agent, g]) => ({ agent, ...g })).sort((a, b) => b.high.length - a.high.length || b.low.length - a.low.length);
}

/** Slot time from a PLAN heading excerpt ("## 07:00 — …"). */
export function slotTime(record: ExecutionRecord): string | null {
  return record.source.excerpt?.match(/^#{2,6}\s+(\d{1,2}:\d{2})/)?.[1] ?? null;
}

/** Monday-first week containing `today`. */
export function weekDays(today: string): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  const weekday = (new Date(base).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(base + (i - weekday) * 86400000).toISOString().slice(0, 10));
}
