import type { ExecutionRecord } from "../../shared/types";
import type { PageProps } from "../ui";
import { DaysChip, Empty, Funnel, GroupHeader, Kpi, PageHeader, Panel, PersonChip, StagePill, stageFor } from "../ui";
import { daysSince } from "../detail";
import { applyActionFloor } from "../../shared/stages";

export function OpportunityCard({ record, staleDays, days, onOpen, floor }: { record: ExecutionRecord; staleDays?: number; days: number | null; onOpen: () => void; floor?: string }) {
  const [company, ...rest] = record.target.split(/\s+[—–]\s+/);
  const role = String(record.metadata.role || rest.join(" — "));
  return (
    <button className={`entity-card opp-card ${staleDays !== undefined ? "is-stale" : ""}`} onClick={onOpen}>
      <span className="entity-title">{String(record.metadata.company || company)}</span>
      {role && <span className="entity-sub">{role}</span>}
      <span className="entity-chips">
        <StagePill stage={floor ? applyActionFloor(stageFor(record), floor) : stageFor(record)} />
        <DaysChip days={staleDays ?? days} stale={staleDays !== undefined} suffix="d waiting" />
      </span>
      {record.metadata.waitingFor ? <span className="entity-line">{String(record.metadata.waitingFor)}</span> : null}
      <PersonChip who={record.metadata.waitingOn} />
    </button>
  );
}

export function Interviews({ data, open, timezone }: PageProps) {
  const { interviews, assessments } = data.entities;
  const iv = data.kpis.find((k) => k.id === "interviews");
  const as = data.kpis.find((k) => k.id === "assessments");
  const staleMap = new Map(data.stale.map((s) => [s.recordId, s.daysWaiting]));
  const stale = [...interviews, ...assessments].filter((r) => staleMap.has(r.id));
  const empty = !interviews.length && !assessments.length;
  const order = (rows: ExecutionRecord[]) => [...rows].sort((a, b) => Number(staleMap.has(b.id)) - Number(staleMap.has(a.id)) || (stageFor(a) === "Closed" ? 1 : 0) - (stageFor(b) === "Closed" ? 1 : 0));
  const group = (title: string, rows: ExecutionRecord[], floor: string) => (
    <section className="card-group">
      <GroupHeader title={title} count={rows.length} />
      {rows.length ? (
        <div className="card-grid">
          {order(rows).map((r) => <OpportunityCard key={r.id} record={r} staleDays={staleMap.get(r.id)} days={daysSince(r, data.today.date, timezone)} onOpen={() => open([r.id], title.slice(0, -1))} floor={floor} />)}
        </div>
      ) : <Empty />}
    </section>
  );
  return (
    <>
      <PageHeader title="Interviews & Assessments" subtitle="What is in motion, whose move it is, and what has gone quiet." />
      <div className="tile-row">
        <Kpi label="Interviews in motion" value={iv?.value ?? null} onClick={iv ? () => open(iv.recordIds, iv.label) : undefined} />
        <Kpi label="Assessments pending" value={as?.value ?? null} onClick={as ? () => open(as.recordIds, as.label) : undefined} />
        <Kpi label="Stale (3+ days)" value={empty ? null : stale.length} tone={stale.length ? "alert" : "ok"} hint="Waiting with no update" onClick={stale.length ? () => open(stale.map((r) => r.id), "Stale interviews & assessments") : undefined} />
      </div>
      {empty ? <Panel title="Pipeline"><Empty /></Panel> : (
        <>
          <Panel title="By stage"><Funnel stages={data.pipelineStages.filter((s) => s.stage !== "Applied")} open={open} title="Pipeline" /></Panel>
          {group("Interviews", interviews, "interview")}
          {group("Assessments", assessments, "assessment")}
        </>
      )}
    </>
  );
}
