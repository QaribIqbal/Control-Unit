import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Chip, Empty, Funnel, Kpi, Panel, PageHeader, Status, formatDate, meta } from "../ui";
import { daysToBars } from "../modules";

export function Applications({ data, open, timezone }: PageProps) {
  const total = data.kpis.find((k) => k.id === "applications-total");
  const week = data.kpis.find((k) => k.id === "applications-week");
  const last14 = data.applicationsDaily.reduce((n, d) => n + d.count, 0);
  const rows = data.entities.applications;
  const [visible, setVisible] = useState(15);
  const noData = total?.value === null && rows.length === 0;
  return (
    <>
      <PageHeader title="Applications" subtitle="Jobs applied for, and where each one stands." />
      <div className="tile-row">
        <Kpi label="Applied in total" value={total?.value ?? null} hint="Completed, de-duplicated" onClick={total ? () => open(total.recordIds, total.label) : undefined} />
        <Kpi label="This week" value={week?.value ?? null} hint="Monday to today" onClick={week ? () => open(week.recordIds, week.label) : undefined} />
        <Kpi label="Last 14 days" value={total?.value === null ? null : last14} hint="Dated applications only" />
        <Kpi label="Tracked opportunities" value={rows.length ? rows.length : null} hint="Latest state per company" />
      </div>
      {noData ? <Panel title="Applications"><Empty /></Panel> : (
        <div className="split">
          <Panel title="Applied per day" aside={<span className="quiet head-note">Last 14 days</span>}>
            <Bars bars={daysToBars(data.applicationsDaily)} open={open} title="Applications" />
          </Panel>
          <Panel title="By stage" aside={<span className="quiet head-note">Latest recorded stage</span>}>
            <Funnel stages={[...data.applicationStages].sort((a, b) => b.count - a.count)} open={open} title="Applications" />
          </Panel>
        </div>
      )}
      <Panel title="Latest applications" aside={rows.length ? <Chip>{rows.length}</Chip> : undefined}>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Company / role</th><th>Stage</th><th>Status</th><th>Date</th><th>Evidence</th></tr></thead>
              <tbody>
                {rows.slice(0, visible).map((r) => (
                  <tr key={r.id}>
                    <td><button className="text-button cell-title" onClick={() => open([r.id], "Application evidence")}>{meta(r, "company", r.target)}</button><small>{meta(r, "role", "")}</small></td>
                    <td><span className="stage-label">{meta(r, "stage", "—")}</span></td>
                    <td><Status value={r.status} /></td>
                    <td className="nowrap quiet">{formatDate(r.timestamp, timezone, true)}</td>
                    <td><button className="icon-button" aria-label={`Inspect ${r.target}`} onClick={() => open([r.id], "Application evidence")}><ArrowUpRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > visible && <button className="load-more" onClick={() => setVisible((v) => v + 25)}>Show more <ChevronDown size={15} /></button>}
          </div>
        ) : <Empty />}
      </Panel>
    </>
  );
}
