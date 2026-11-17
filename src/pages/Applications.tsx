import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Empty, Funnel, GroupHeader, Kpi, Panel, PageHeader, StagePill, meta, stageFor } from "../ui";
import { dayLabel, groupByDay } from "../detail";
import { daysToBars } from "../modules";

export function Applications({ data, open, timezone }: PageProps) {
  const total = data.kpis.find((k) => k.id === "applications-total");
  const sent = data.kpis.find((k) => k.id === "applications-sent");
  const week = data.kpis.find((k) => k.id === "applications-week");
  const last14 = data.applicationsDaily.reduce((n, d) => n + d.count, 0);
  const todayCount = data.applicationsDaily.at(-1)?.count ?? 0;
  const rows = data.entities.applications;
  const undated = rows.filter((r) => !r.timestamp);
  const [visible, setVisible] = useState(7);
  const noData = total?.value === null && rows.length === 0;
  return (
    <>
      <PageHeader title="Applications" subtitle="Every company and role in the application log, and where each one stands." />
      <div className="tile-row">
        <Kpi label="Applications sent" value={sent?.value ?? null} hint="Reconciled total from the log" onClick={sent ? () => open(sent.recordIds, sent.label) : undefined} />
        <Kpi label="Roles tracked" value={total?.value ?? null} hint="Distinct company + role" onClick={total ? () => open(total.recordIds, total.label) : undefined} />
        <Kpi label="This week" value={week?.value ?? null} hint="Dated, Monday to today" onClick={week ? () => open(week.recordIds, week.label) : undefined} />
        <Kpi label="Today" value={noData ? null : todayCount} />
        <Kpi label="Last 14 days" value={noData ? null : last14} />
        {undated.length > 0 && <Kpi label="No date recorded" value={undated.length} hint="Not in the day chart" onClick={() => open(undated.map((r) => r.id), "Roles without a date")} />}
      </div>
      {noData ? <Panel title="Roles"><Empty /></Panel> : (
        <div className="split">
          <Panel title="Roles logged per day" aside={<span className="quiet head-note">Last 14 days</span>}>
            <Bars bars={daysToBars(data.applicationsDaily)} open={open} title="Roles logged" />
          </Panel>
          <Panel title="By stage" aside={<span className="quiet head-note">Latest stage</span>}>
            <Funnel stages={data.applicationStages} open={open} title="Roles" />
          </Panel>
        </div>
      )}
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
                      <StagePill stage={stageFor(r)} />
                      {r.timestamp ? <span className="date-chip">{r.timestamp.slice(5, 10).replace("-", "/")}</span> : null}
                    </button>
                  </li>
                ))}
                {!g.day && g.rows.length > 30 && <li><button className="load-more" onClick={() => open(g.rows.map((r) => r.id), "Roles without a date")}>All {g.rows.length} undated roles <ArrowUpRight size={14} /></button></li>}
              </ul>
            </section>
          ))}
          {groupByDay(rows, timezone).length > visible && <button className="load-more" onClick={() => setVisible((v) => v + 7)}>Show earlier days <ChevronDown size={15} /></button>}
        </div>
      ) : <Panel title="Roles"><Empty /></Panel>}
    </>
  );
}
