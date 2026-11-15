import { ArrowUpRight, CircleAlert, Clock3, Ban, TriangleAlert, CalendarDays } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Chip, CountUp, Empty, PageHeader } from "../ui";
import { moduleSummaries, routeHref } from "../modules";

export function Overview({ data, open }: PageProps) {
  const summaries = moduleSummaries(data);
  const byId = new Map(data.records.map((r) => [r.id, r]));
  const attention = data.attention;
  const todayItems = data.today.items.filter((i) => i.count > 0);
  const badSources = data.sources.filter((s) => s.status === "error").length;
  const missingSources = data.sources.filter((s) => s.status === "missing").length;
  const okSources = data.sources.filter((s) => s.status === "ok").length;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${data.today.date}T00:00:00Z`));
  return (
    <>
      <PageHeader title="Overview" subtitle="Every module at a glance. Select a card to go deeper." />

      <section className="today-strip" aria-label="Today">
        <div className="today-title"><CalendarDays size={16} /><span>Today</span><small>{todayLabel}</small></div>
        {todayItems.length ? (
          <div className="today-items">
            {todayItems.map((item) => (
              <button key={item.key} className={`today-item today-${item.key}`} onClick={() => open(item.recordIds, item.label)}>
                <strong><CountUp value={item.count} /></strong><span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : <p className="today-empty">Nothing recorded for today yet.</p>}
      </section>

      <div className="module-grid">
        {summaries.map((s, i) => (
          <a key={s.id} href={routeHref(s.id)} data-module={s.id} className="module-card" style={{ ["--i" as string]: i }}>
            <span className="module-card-top">
              <span className="module-card-label"><span className="module-dot" />{s.label}</span>
              {s.alerts > 0 ? <Chip tone="alert">{s.alerts} need attention</Chip> : s.tone === "empty" ? <Chip>No data</Chip> : s.tone === "warn" ? <Chip tone="warn">Check sources</Chip> : <Chip tone="ok">On track</Chip>}
            </span>
            {s.value === null ? (
              <strong className="module-card-value tile-empty">No data recorded</strong>
            ) : (
              <strong className="module-card-value"><CountUp value={s.value} /><small>{s.caption}</small></strong>
            )}
            <Bars bars={s.bars} title={s.label} compact />
            <span className="module-card-detail">{s.detail}<ArrowUpRight size={14} /></span>
          </a>
        ))}
      </div>

      <section className="panel attention-strip" aria-label="Needs attention">
        <div className="panel-head">
          <h2><CircleAlert size={17} />Needs attention</h2>
          {attention.length > 0 ? <Chip tone="alert">{attention.length}</Chip> : <Chip tone="ok">Nothing flagged</Chip>}
        </div>
        {attention.length === 0 ? (
          <Empty>Open interviews or leads with no movement in 3+ days, today’s blocked posts and failed runs appear here.</Empty>
        ) : (
          <ul className="flag-list">
            {attention.slice(0, 8).map((item) => {
              const record = byId.get(item.recordId);
              const label = item.kind === "stale" ? `Waiting on ${item.waitingOn}` : item.kind === "blocked" ? "Blocked today" : "Failed run";
              return (
                <li key={`${item.kind}-${item.recordId}`}>
                  <button onClick={() => open([item.recordId], item.kind === "stale" ? "Waiting work" : label)}>
                    {item.kind === "stale" ? <Chip tone="alert"><Clock3 size={12} />{item.days}d</Chip> : item.kind === "blocked" ? <Chip tone="alert"><Ban size={12} />Blocked</Chip> : <Chip tone="alert"><TriangleAlert size={12} />Failed</Chip>}
                    <span className="flag-title">{record?.target || "Recorded item"}</span>
                    <span className="flag-sub">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {attention.length > 8 && <a className="text-button more-link" href="#/interviews">+{attention.length - 8} more <ArrowUpRight size={13} /></a>}
      </section>

      <section className="panel" aria-label="Source health">
        <div className="panel-head">
          <h2>Sources</h2>
          <a className="text-button" href={routeHref("agents")}>Details <ArrowUpRight size={13} /></a>
        </div>
        {data.sources.length ? (
          <div className="chip-row">
            {okSources > 0 && <Chip tone="ok">{okSources} synced</Chip>}
            {missingSources > 0 && <Chip tone="warn">{missingSources} missing</Chip>}
            {badSources > 0 && <Chip tone="alert">{badSources} errors</Chip>}
            <span className="quiet">{data.records.length.toLocaleString()} records</span>
          </div>
        ) : <Empty />}
      </section>
    </>
  );
}
