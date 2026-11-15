import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { ExecutionRecord } from "../../shared/types";
import type { PageProps } from "../ui";
import { Chip, Empty, GroupHeader, Kpi, PageHeader, Panel, StagePill, meta } from "../ui";
import { dayKeyIn } from "../modules";
import { dayLabel, groupByDay, slotTime, weekDays } from "../detail";

const SHORT: Record<string, string> = { instagram: "IG", linkedin: "LI", facebook: "FB", tiktok: "TT", youtube: "YT", twitter: "X", x: "X", threads: "TH" };
const platformShort = (p: string) => SHORT[p.toLowerCase()] || p.slice(0, 2).toUpperCase();
const slotTone = (r: ExecutionRecord) => (r.status === "published" ? "published" : r.status === "blocked" ? "blocked" : "planned");
const bySlot = (a: ExecutionRecord, b: ExecutionRecord) => (slotTime(a) || "99").localeCompare(slotTime(b) || "99");

export function Social({ data, open, timezone }: PageProps) {
  const posts = data.entities.social;
  const platforms = data.socialPlatforms;
  const has = posts.length > 0;
  const sum = (f: (p: (typeof platforms)[number]) => number) => platforms.reduce((n, p) => n + f(p), 0);
  const week = weekDays(data.today.date);
  const dayOf = (r: ExecutionRecord) => (r.timestamp ? dayKeyIn(r.timestamp, timezone) : null);
  const recent = posts.filter((r) => { const d = dayOf(r); return d !== null && d >= week[0]; });
  const groups = groupByDay(recent, timezone);
  const [showOlder, setShowOlder] = useState(false);
  const older = posts.filter((r) => !recent.includes(r));
  return (
    <>
      <PageHeader title="Social" subtitle="This week’s slots at a glance, then every post by day." />
      <div className="tile-row">
        <Kpi label="Published, last 7 days" value={has ? sum((p) => p.published) : null} tone={sum((p) => p.published) ? "ok" : "neutral"} onClick={has ? () => open(platforms.flatMap((p) => p.publishedIds), "Published posts") : undefined} />
        <Kpi label="Upcoming planned" value={has ? sum((p) => p.planned) : null} hint="Ready, from today on" onClick={has ? () => open(platforms.flatMap((p) => p.plannedIds), "Upcoming posts") : undefined} />
        <Kpi label="Blocked, last 7 days" value={has ? sum((p) => p.blocked) : null} tone={sum((p) => p.blocked) ? "alert" : "ok"} onClick={has ? () => open(platforms.flatMap((p) => p.blockedIds), "Blocked posts") : undefined} />
      </div>

      <section className="week-strip" aria-label="This week">
        {week.map((day) => {
          const slots = posts.filter((r) => dayOf(r) === day).sort(bySlot);
          const isToday = day === data.today.date;
          return (
            <div key={day} className={`week-day ${isToday ? "is-today" : ""} ${day > data.today.date ? "is-future" : ""}`}>
              <div className="week-day-head"><span>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}</span><strong>{Number(day.slice(8))}</strong></div>
              <div className="week-slots">
                {slots.length ? slots.map((r) => (
                  <button key={r.id} className={`slot slot-${slotTone(r)}`} onClick={() => open([r.id], "Post")} title={`${slotTime(r) || ""} ${r.target} · ${r.status}`}>
                    <span className="slot-time">{slotTime(r) || "—"}</span><span className="slot-platform">{platformShort(meta(r, "platform", ""))}</span>
                  </button>
                )) : <span className="slot-empty">—</span>}
              </div>
            </div>
          );
        })}
      </section>
      <div className="legend"><span className="lg lg-published">Published</span><span className="lg lg-planned">Planned</span><span className="lg lg-blocked">Blocked</span></div>

      {has ? (
        <div className="feed">
          {groups.map((g) => (
            <section key={g.day ?? "undated"} className="feed-day">
              <GroupHeader title={dayLabel(g.day, data.today.date)} count={g.rows.length} tone={g.rows.some((r) => r.status === "blocked") && g.day === data.today.date ? "alert" : undefined} />
              <ul className="feed-list">
                {[...g.rows].sort(bySlot).map((r) => (
                  <li key={r.id}>
                    <button className={`feed-item post-row post-${slotTone(r)}`} onClick={() => open([r.id], "Post")}>
                      <span className="post-time">{slotTime(r) || "—"}</span>
                      <span className="feed-body"><span className="feed-title"><strong>{r.target}</strong><span className="feed-company">{meta(r, "platform", "")}</span></span></span>
                      <StagePill stage={r.status === "published" ? "Published" : r.status === "blocked" ? "Blocked" : "Planned"} />
                      <ArrowUpRight size={15} className="row-arrow" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {older.length > 0 && (
            <section className="feed-day">
              <button className="load-more" onClick={() => setShowOlder((v) => !v)}>{showOlder ? "Hide" : "Show"} older history <Chip>{older.length}</Chip><ChevronDown size={15} /></button>
              {showOlder && groupByDay(older, timezone).map((g) => (
                <div key={g.day ?? "undated"} className="older-day">
                  <GroupHeader title={dayLabel(g.day, data.today.date)} count={g.rows.length} tone="muted" />
                  <div className="chip-row">{[...g.rows].sort(bySlot).map((r) => <button key={r.id} className={`slot slot-inline slot-${slotTone(r)}`} onClick={() => open([r.id], "Post")}>{slotTime(r) || ""} {meta(r, "platform", "")}</button>)}</div>
                </div>
              ))}
            </section>
          )}
        </div>
      ) : <Panel title="Posts"><Empty /></Panel>}
    </>
  );
}
