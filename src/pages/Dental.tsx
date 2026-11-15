import { ArrowUpRight } from "lucide-react";
import type { PageProps } from "../ui";
import { Empty, Funnel, Kpi, PageHeader, Panel, PipelineTable } from "../ui";
import { staleIn } from "../modules";

export function Dental({ data, open, timezone }: PageProps) {
  const leads = data.entities.dental;
  const total = data.kpis.find((k) => k.id === "dental-total");
  const stale = staleIn(data, leads.map((r) => r.id));
  const sales = data.dentalStages.find((s) => s.stage.toLowerCase() === "sale");
  return (
    <>
      <PageHeader title="Dental Leads" subtitle="Practices contacted and how far each has progressed." />
      <div className="tile-row">
        <Kpi label="Leads tracked" value={total?.value ?? null} onClick={total ? () => open(total.recordIds, total.label) : undefined} />
        <Kpi label="Sales" value={leads.length ? sales?.count ?? 0 : null} tone={sales?.count ? "ok" : "neutral"} onClick={sales ? () => open(sales.recordIds, "Dental · Sale") : undefined} />
        <Kpi label="Stale (3+ days)" value={leads.length ? stale.length : null} tone={stale.length ? "alert" : "ok"} onClick={stale.length ? () => open(stale.map((s) => s.recordId), "Stale dental leads") : undefined} />
      </div>
      <Panel title="Funnel" aside={<span className="quiet head-note">Latest recorded stage</span>}>
        {data.dentalStages.length ? <Funnel stages={data.dentalStages} open={open} title="Dental" /> : <Empty />}
      </Panel>
      {data.dentalDaily.length > 0 && (
        <Panel title="Daily outreach reported" aside={<span className="quiet head-note">From the daily summary lines</span>}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Day</th><th>Sent</th><th>Replies</th><th>Calls booked</th><th>Sales</th><th>Evidence</th></tr></thead>
              <tbody>
                {[...data.dentalDaily].reverse().map((d) => (
                  <tr key={d.date}>
                    <td className="nowrap">{d.date}</td><td>{d.sent || "—"}</td><td>{d.replies || "—"}</td><td>{d.calls || "—"}</td><td>{d.sales || "—"}</td>
                    <td><button className="icon-button" aria-label={`Inspect ${d.date}`} onClick={() => open(d.recordIds, `Dental · ${d.date}`)}><ArrowUpRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Panel title="Leads">
        <PipelineTable records={leads} open={open} timezone={timezone} stale={data.stale} dental />
      </Panel>
    </>
  );
}
