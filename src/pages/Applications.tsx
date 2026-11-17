import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { PageProps } from "../ui";
import type { DashboardData, ExecutionRecord } from "../../shared/types";
import { Bars, Empty, Funnel, GroupHeader, Kpi, Panel, PageHeader, StagePill, meta } from "../ui";
import { dayLabel, groupByDay } from "../detail";
import { daysToBars } from "../modules";

/** Preserve the source status; generic success is not proof that a role was submitted. */
export function applicationStatus(record: ExecutionRecord) {
  const sourceStatus = String(record.metadata.appStatus || record.metadata.stage || "").trim();
  if (sourceStatus) return sourceStatus;
  return ["failed", "blocked", "pending", "planned", "in_progress"].includes(record.status)
    ? record.status.replaceAll("_", " ") : "Status not recorded";
}

/** Use the KPI evidence IDs so the filter includes every counted source row, including duplicate roles. */
export function applicationRows(data: DashboardData, submissionsOnly: boolean) {
  if (!submissionsOnly) return data.entities.applications;
  const ids = new Set(data.kpis.find((k) => k.id === "applications-clean")?.recordIds || []);
  return data.records.filter((record) => ids.has(record.id));
}

export function Applications({ data, open, timezone }: PageProps) {
  const total = data.kpis.find((k) => k.id === "applications-total");
  const week = data.kpis.find((k) => k.id === "applications-week");
  const clean = data.kpis.find((k) => k.id === "applications-clean");
  const last14 = data.applicationsDaily.reduce((n, d) => n + d.count, 0);
  const todayCount = data.applicationsDaily.at(-1)?.count ?? 0;
  const [submissionsOnly, setSubmissionsOnly] = useState(false);
  const filterActive = submissionsOnly && clean?.value != null;
  const rows = applicationRows(data, filterActive);
  const undated = data.entities.applications.filter((r) => !r.timestamp);
  const [visible, setVisible] = useState(7);
  const noData = total?.value === null && rows.length === 0;
  return (
    <>
      <PageHeader title="Applications" subtitle="Tracked roles, confirmed submissions, and where each one stands." />
      <div className="tile-row">
        <Kpi label="Roles tracked" value={total?.value ?? null} hint="Distinct company + role" onClick={total ? () => open(total.recordIds, "Roles tracked") : undefined} />
        <Kpi label="Clean submissions" value={clean?.value ?? null} hint="Confirmed in applied log" onClick={clean && clean.value !== null ? () => open(clean.recordIds, clean.label) : undefined} />
        <Kpi label="Tracked activity this week" value={week?.value ?? null} hint="Dated, Monday to today" onClick={week ? () => open(week.recordIds, "Tracked activity this week") : undefined} />
        <Kpi label="Tracked activity today" value={noData ? null : todayCount} />
        <Kpi label="Tracked activity · 14 days" value={noData ? null : last14} />
        {undated.length > 0 && <Kpi label="No date recorded" value={undated.length} hint="Not in the day chart" onClick={() => open(undated.map((r) => r.id), "Applications without a date")} />}
      </div>
      {noData ? <Panel title="Applications"><Empty /></Panel> : (
        <div className="split">
          <Panel title="Tracked activity per day" aside={<span className="quiet head-note">Last 14 days</span>}>
            <Bars bars={daysToBars(data.applicationsDaily)} open={open} title="Tracked activity" />
          </Panel>
          <Panel title="By stage" aside={<span className="quiet head-note">Latest stage</span>}>
            <Funnel stages={data.applicationStages.map((stage) => stage.stage === "Applied" ? { ...stage, stage: "Tracked / applied" } : stage)} open={open} title="Applications" />
          </Panel>
        </div>
      )}
      <div className="applications-list-head">
        <h2>{filterActive ? "Clean submissions" : "Tracked roles"}</h2>
        <button type="button" className="submissions-filter" aria-pressed={filterActive} disabled={clean?.value == null} onClick={() => { setSubmissionsOnly(!filterActive); setVisible(7); }}>
          Submissions only
        </button>
      </div>
      {clean?.value == null && <p className="quiet applications-filter-note">Submission status is not available yet.</p>}
      {rows.length ? (
        <div className="feed">
          {groupByDay(rows, timezone).slice(0, visible).map((g) => (
            <section key={g.day ?? "undated"} className="feed-day">
              <GroupHeader title={dayLabel(g.day, data.today.date)} count={g.rows.length} tone={g.day ? undefined : "muted"} />
              <ul className="feed-list">
                {g.rows.slice(0, g.day ? undefined : 30).map((r) => (
                  <li key={r.id}>
                    <button className="feed-item app-row" onClick={() => open([r.id], "Application")}>
                      <span className="feed-body"><span className="feed-title"><strong>{meta(r, "company", r.target.split(/\s+[—–]\s+/)[0])}</strong><span className="feed-company">{meta(r, "role", r.target.split(/\s+[—–]\s+/).slice(1).join(" — "))}</span></span></span>
                      <span className="app-status" title={applicationStatus(r)}><StagePill stage={applicationStatus(r)} /></span>
                      {r.timestamp ? <span className="date-chip">{r.timestamp.slice(5, 10).replace("-", "/")}</span> : null}
                    </button>
                  </li>
                ))}
                {!g.day && g.rows.length > 30 && <li><button className="load-more" onClick={() => open(g.rows.map((r) => r.id), "Applications without a date")}>All {g.rows.length} undated applications <ArrowUpRight size={14} /></button></li>}
              </ul>
            </section>
          ))}
          {groupByDay(rows, timezone).length > visible && <button className="load-more" onClick={() => setVisible((v) => v + 7)}>Show earlier days <ChevronDown size={15} /></button>}
        </div>
      ) : <Panel title="Applications"><Empty>{filterActive ? "No confirmed submissions recorded." : "No data recorded"}</Empty></Panel>}
    </>
  );
}
