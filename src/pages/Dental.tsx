import type { PageProps } from "../ui";
import { Bars, DaysChip, Empty, GroupHeader, Kpi, PageHeader, Panel, PersonChip, StagePill } from "../ui";
import { DENTAL_STAGES, daysSince, dentalStage } from "../detail";

export function Dental({ data, open, timezone }: PageProps) {
  const leads = data.entities.dental;
  const total = data.kpis.find((k) => k.id === "dental-total");
  const staleIds = new Map(data.stale.map((s) => [s.recordId, s]));
  const stale = leads.filter((r) => staleIds.has(r.id));
  const columns = DENTAL_STAGES.map((stage) => ({ stage, rows: leads.filter((r) => dentalStage(r) === stage) }));
  const sales = columns.find((c) => c.stage === "Sale")!.rows;
  const daily = data.dentalDaily.slice(-14);
  const metricBars = (key: "sent" | "replies" | "calls" | "sales") => daily.map((d) => ({ label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)), count: d[key], recordIds: d.recordIds }));
  return (
    <>
      <PageHeader title="Dental Leads" subtitle="Clinics in the pipeline, and whose move it is." />
      <div className="tile-row">
        <Kpi label="Clinics" value={total?.value ?? null} onClick={total ? () => open(total.recordIds, total.label) : undefined} />
        <Kpi label="Replied or further" value={leads.length ? leads.filter((r) => dentalStage(r) !== "Contacted").length : null} />
        <Kpi label="Sales" value={leads.length ? sales.length : null} tone={sales.length ? "ok" : "neutral"} onClick={sales.length ? () => open(sales.map((r) => r.id), "Dental · Sale") : undefined} />
        <Kpi label="Stale (3+ days)" value={leads.length ? stale.length : null} tone={stale.length ? "alert" : "ok"} onClick={stale.length ? () => open(stale.map((r) => r.id), "Stale dental leads") : undefined} />
      </div>

      {leads.length ? (
        <div className="kanban">
          {columns.map(({ stage, rows }) => (
            <section key={stage} className="kanban-col" aria-label={stage}>
              <GroupHeader title={stage} count={rows.length} tone={stage === "Sale" && rows.length ? "ok" : undefined} />
              {rows.length ? rows.map((r) => {
                const item = staleIds.get(r.id);
                const days = item?.daysWaiting ?? daysSince(r, data.today.date, timezone);
                return (
                  <button key={r.id} className={`entity-card ${item ? "is-stale" : ""}`} onClick={() => open([r.id], "Clinic")}>
                    <span className="entity-title">{String(r.metadata.company || r.target)}</span>
                    {r.metadata.city ? <span className="entity-sub">{String(r.metadata.city)}</span> : null}
                    <span className="entity-chips">
                      <StagePill stage={String(r.metadata.stage || stage)} />
                      <DaysChip days={days} stale={Boolean(item)} suffix="d since contact" />
                    </span>
                    <span className="entity-line">{[r.metadata.platform && `via ${r.metadata.platform}`, r.metadata.waitingFor].filter(Boolean).join(" · ") || "No last action recorded"}</span>
                    {r.metadata.waitingOn ? <PersonChip who={r.metadata.waitingOn} /> : null}
                  </button>
                );
              }) : <p className="col-empty">None</p>}
            </section>
          ))}
        </div>
      ) : <Panel title="Pipeline"><Empty /></Panel>}

      <Panel title="Daily outreach reported" aside={<span className="head-note">From the daily summary lines</span>}>
        {daily.length ? (
          <div className="metric-grid">
            {(["sent", "replies", "calls", "sales"] as const).map((key) => (
              <div key={key} className="metric-chart">
                <div className="metric-head"><span>{key === "calls" ? "Calls booked" : key[0].toUpperCase() + key.slice(1)}</span><strong>{daily.reduce((n, d) => n + d[key], 0)}</strong></div>
                {daily.some((d) => d[key] > 0) ? <Bars bars={metricBars(key)} open={open} title={`Dental ${key}`} /> : <p className="metric-none">None reported in these days</p>}
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Panel>
    </>
  );
}
