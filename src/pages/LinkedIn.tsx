import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Empty, Kpi, PageHeader, Panel, Status, formatDate, meta } from "../ui";
import { daysToBars } from "../modules";

export function LinkedIn({ data, open, timezone }: PageProps) {
  const byId = new Map(data.records.map((r) => [r.id, r]));
  const totalKpi = data.kpis.find((k) => k.id === "linkedin-total");
  const todayKpi = data.kpis.find((k) => k.id === "linkedin-today");
  const records = (totalKpi?.recordIds || []).map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => (b.timestamp ? Date.parse(b.timestamp) : -Infinity) - (a.timestamp ? Date.parse(a.timestamp) : -Infinity));
  const last14 = data.linkedinDaily.reduce((n, d) => n + d.count, 0);
  const kinds = new Map<string, string[]>();
  for (const r of records) { const k = meta(r, "touchType", meta(r, "type", "touch")); kinds.set(k, [...(kinds.get(k) || []), r.id]); }
  const [visible, setVisible] = useState(15);
  const none = totalKpi?.value === null;
  return (
    <>
      <PageHeader title="LinkedIn Outreach" subtitle="Recorded touches, day by day." />
      <div className="tile-row">
        <Kpi label="Today" value={todayKpi?.value ?? null} onClick={todayKpi ? () => open(todayKpi.recordIds, todayKpi.label) : undefined} />
        <Kpi label="Last 14 days" value={none ? null : last14} />
        <Kpi label="Total recorded" value={totalKpi?.value ?? null} onClick={totalKpi ? () => open(totalKpi.recordIds, totalKpi.label) : undefined} />
        {[...kinds].sort((a, b) => b[1].length - a[1].length).slice(0, 4).map(([kind, ids]) => <Kpi key={kind} label={kind} value={ids.length} onClick={() => open(ids, `LinkedIn · ${kind}`)} />)}
      </div>
      <Panel title="Touches per day" aside={<span className="quiet head-note">Last 14 days</span>}>
        {none ? <Empty /> : <Bars bars={daysToBars(data.linkedinDaily)} open={open} title="LinkedIn" />}
      </Panel>
      <Panel title="Recent touches">
        {records.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Person</th><th>Company</th><th>Type</th><th>Status</th><th>Evidence</th></tr></thead>
              <tbody>
                {records.slice(0, visible).map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{formatDate(r.timestamp, timezone)}</td>
                    <td><button className="text-button cell-title" onClick={() => open([r.id], "LinkedIn evidence")}>{meta(r, "person", r.target)}</button></td>
                    <td>{meta(r, "company")}</td>
                    <td>{meta(r, "touchType", meta(r, "type", r.actionType.replaceAll("_", " ")))}</td>
                    <td><Status value={r.status} /></td>
                    <td><button className="icon-button" aria-label={`Inspect ${r.target}`} onClick={() => open([r.id], "LinkedIn evidence")}><ArrowUpRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length > visible && <button className="load-more" onClick={() => setVisible((v) => v + 25)}>Show more <ChevronDown size={15} /></button>}
          </div>
        ) : <Empty />}
      </Panel>
    </>
  );
}
