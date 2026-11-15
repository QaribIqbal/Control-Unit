import type { PageProps } from "../ui";
import { Chip, Empty, Funnel, Kpi, PageHeader, Panel, PipelineTable } from "../ui";
import { staleIn, stageCounts } from "../modules";

export function Interviews({ data, open, timezone }: PageProps) {
  const { interviews, assessments } = data.entities;
  const iv = data.kpis.find((k) => k.id === "interviews");
  const as = data.kpis.find((k) => k.id === "assessments");
  const ids = [...interviews, ...assessments].map((r) => r.id);
  const stale = staleIn(data, ids);
  const empty = !interviews.length && !assessments.length;
  return (
    <>
      <PageHeader title="Interviews & Assessments" subtitle="What is in motion, and what has gone quiet." />
      <div className="tile-row">
        <Kpi label="Interviews in motion" value={iv?.value ?? null} onClick={iv ? () => open(iv.recordIds, iv.label) : undefined} />
        <Kpi label="Assessments pending" value={as?.value ?? null} onClick={as ? () => open(as.recordIds, as.label) : undefined} />
        <Kpi label="Stale (3+ days)" value={empty ? null : stale.length} tone={stale.length ? "alert" : "ok"} hint="Waiting with no update" onClick={stale.length ? () => open(stale.map((s) => s.recordId), "Stale interviews & assessments") : undefined} />
      </div>
      {empty ? <Panel title="Pipeline"><Empty /></Panel> : (
        <Panel title="By stage"><Funnel stages={stageCounts([...interviews, ...assessments])} open={open} title="Pipeline" /></Panel>
      )}
      <div className="split">
        <Panel title="Interviews" aside={<Chip>{interviews.length}</Chip>}>
          <PipelineTable records={interviews} open={open} timezone={timezone} stale={data.stale} />
        </Panel>
        <Panel title="Assessments" aside={<Chip>{assessments.length}</Chip>}>
          <PipelineTable records={assessments} open={open} timezone={timezone} stale={data.stale} />
        </Panel>
      </div>
    </>
  );
}
