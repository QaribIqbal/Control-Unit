import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PageProps } from "../ui";
import { Bars, Empty, GroupHeader, Kpi, PageHeader, Panel, TouchIcon, formatDate } from "../ui";
import { daysToBars } from "../modules";
import { dayLabel, groupByDay } from "../detail";

const TYPE_LABEL: Record<string, string> = { comment: "Commented", like: "Liked", message: "Messaged", inmail: "InMail", connection: "Connected", reply: "Replied", post: "Engaged with post", other: "Touch" };

export function LinkedIn({ data, open, timezone }: PageProps) {
  const byId = new Map(data.records.map((r) => [r.id, r]));
  const totalKpi = data.kpis.find((k) => k.id === "linkedin-total");
  const todayKpi = data.kpis.find((k) => k.id === "linkedin-today");
  const records = (totalKpi?.recordIds || []).map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const last14 = data.linkedinDaily.reduce((n, d) => n + d.count, 0);
  const typeOf = (r: (typeof records)[number]) => String(r.metadata.touchType || "other");
  const kinds = new Map<string, string[]>();
  for (const r of records) kinds.set(typeOf(r), [...(kinds.get(typeOf(r)) || []), r.id]);
  const days = groupByDay(records, timezone);
  const [visibleDays, setVisibleDays] = useState(5);
  const none = totalKpi?.value === null;
  return (
    <>
      <PageHeader title="LinkedIn Outreach" subtitle="Who was touched, how, and when." />
      <div className="tile-row">
        <Kpi label="Today" value={todayKpi?.value ?? null} onClick={todayKpi ? () => open(todayKpi.recordIds, todayKpi.label) : undefined} />
        <Kpi label="Last 14 days" value={none ? null : last14} />
        <Kpi label="All touches" value={totalKpi?.value ?? null} onClick={totalKpi ? () => open(totalKpi.recordIds, totalKpi.label) : undefined} />
      </div>
      {kinds.size > 0 && (
        <div className="type-row">
          {[...kinds].sort((a, b) => b[1].length - a[1].length).map(([kind, ids]) => (
            <button key={kind} className="type-chip" onClick={() => open(ids, `LinkedIn · ${TYPE_LABEL[kind] || kind}`)}>
              <TouchIcon type={kind} /><strong>{ids.length}</strong><span>{TYPE_LABEL[kind] || kind}</span>
            </button>
          ))}
        </div>
      )}
      <Panel title="Touches per day" aside={<span className="head-note">Last 14 days</span>}>
        {none ? <Empty /> : <div className="chart-large"><Bars bars={daysToBars(data.linkedinDaily)} open={open} title="LinkedIn" /></div>}
      </Panel>
      {records.length ? (
        <div className="feed">
          {days.slice(0, visibleDays).map((group) => (
            <section key={group.day ?? "undated"} className="feed-day">
              <GroupHeader title={dayLabel(group.day, data.today.date)} count={group.rows.length} />
              <ul className="feed-list">
                {group.rows.map((r) => (
                  <li key={r.id}>
                    <button className="feed-item" onClick={() => open([r.id], "LinkedIn touch")}>
                      <TouchIcon type={typeOf(r)} />
                      <span className="feed-body">
                        <span className="feed-title"><strong>{String(r.metadata.person || r.target)}</strong>{r.metadata.company ? <span className="feed-company">{String(r.metadata.company)}</span> : null}</span>
                        <span className="feed-summary">{TYPE_LABEL[typeOf(r)] || "Touch"}{r.metadata.subject ? ` · ${String(r.metadata.subject).replace(/^post:\s*/i, "")}` : ""}</span>
                      </span>
                      {r.timestamp && r.timestamp.includes("T") ? <span className="feed-time">{formatDate(r.timestamp, timezone)}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {days.length > visibleDays && <button className="load-more" onClick={() => setVisibleDays((v) => v + 5)}>Show earlier days <ChevronDown size={15} /></button>}
        </div>
      ) : <Panel title="Activity"><Empty /></Panel>}
    </>
  );
}
