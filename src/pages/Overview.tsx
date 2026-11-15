import { ArrowUpRight, CircleAlert, ShieldCheck, Clock3 } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Chip, Empty, PageHeader } from "../ui";
import { attentionCount, moduleSummaries, routeHref } from "../modules";

export function Overview({ data, open }: PageProps) {
  const summaries = moduleSummaries(data);
  const recordById = new Map(data.records.map((r) => [r.id, r]));
  const attention = attentionCount(data);
  const badSources = data.sources.filter((s) => s.status === "error");
  const missingSources = data.sources.filter((s) => s.status === "missing");
  const okSources = data.sources.filter((s) => s.status === "ok");
  return (
    <>
      <PageHeader title="Overview" subtitle="Every module at a glance. Select a card to go deeper." />
      <div className="module-grid">
        {summaries.map((s) => (
          <a key={s.id} href={routeHref(s.id)} className={`module-card tone-${s.tone}`}>
            <span className="module-card-top">
              <span className="module-card-label">{s.label}</span>
              {s.alerts > 0 ? <Chip tone="alert">{s.alerts} need attention</Chip> : s.tone === "empty" ? <Chip>No data</Chip> : <Chip tone="ok">On track</Chip>}
            </span>
            {s.value === null ? (
              <strong className="module-card-value tile-empty">No data recorded</strong>
            ) : (
              <strong className="module-card-value">{s.value.toLocaleString()}<small>{s.caption}</small></strong>
            )}
            {s.bars.length > 0 && s.id !== "dental" && <Bars bars={s.bars} title={s.label} compact />}
            <span className="module-card-detail">{s.detail}<ArrowUpRight size={14} /></span>
          </a>
        ))}
      </div>

      <section className="panel attention-strip" aria-label="Needs attention">
        <div className="panel-head">
          <h2><CircleAlert size={17} />Needs attention</h2>
          {attention > 0 ? <Chip tone="alert">{attention}</Chip> : <Chip tone="ok">Nothing flagged</Chip>}
        </div>
        {attention === 0 ? (
          <Empty>Stale items and unverified success claims will appear here.</Empty>
        ) : (
          <ul className="flag-list">
            {data.stale.slice(0, 6).map((item) => (
              <li key={`s-${item.recordId}`}>
                <button onClick={() => open([item.recordId], "Waiting work")}>
                  <Chip tone="alert"><Clock3 size={12} />{item.daysWaiting}d</Chip>
                  <span className="flag-title">{recordById.get(item.recordId)?.target || "Waiting work"}</span>
                  <span className="flag-sub">Waiting on {item.waitingOn}</span>
                </button>
              </li>
            ))}
            {data.verification.slice(0, 4).map((item) => (
              <li key={`v-${item.recordId}`}>
                <button onClick={() => open([item.recordId], "Unverified success")}>
                  <Chip tone="warn"><ShieldCheck size={12} />Unverified</Chip>
                  <span className="flag-title">{recordById.get(item.recordId)?.target || "Recorded success claim"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {attention > 10 && <a className="text-button more-link" href="#/interviews">See all waiting work <ArrowUpRight size={13} /></a>}
      </section>

      <section className="panel" aria-label="Source health">
        <div className="panel-head">
          <h2>Sources</h2>
          <a className="text-button" href={routeHref("agents")}>Details <ArrowUpRight size={13} /></a>
        </div>
        {data.sources.length ? (
          <div className="chip-row">
            {okSources.length > 0 && <Chip tone="ok">{okSources.length} synced</Chip>}
            {missingSources.length > 0 && <Chip tone="warn">{missingSources.length} missing</Chip>}
            {badSources.length > 0 && <Chip tone="alert">{badSources.length} errors</Chip>}
            <span className="quiet">{data.records.length.toLocaleString()} records</span>
          </div>
        ) : <Empty />}
      </section>
    </>
  );
}
