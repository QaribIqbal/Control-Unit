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
      <Panel title="Leads">
        <PipelineTable records={leads} open={open} timezone={timezone} stale={data.stale} dental />
      </Panel>
    </>
  );
}
