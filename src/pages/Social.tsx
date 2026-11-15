import { ArrowUpRight } from "lucide-react";
import type { PageProps } from "../ui";
import { Chip, Empty, Kpi, PageHeader, Panel, Status, meta } from "../ui";

export function Social({ data, open }: PageProps) {
  const posts = data.entities.social;
  const platforms = data.socialPlatforms;
  const has = posts.length > 0;
  const sum = (f: (p: (typeof platforms)[number]) => number) => platforms.reduce((n, p) => n + f(p), 0);
    return (
    <>
      <PageHeader title="Social" subtitle="Per-platform posts: planned, published, blocked." />
      <div className="tile-row">
        <Kpi label="Published, last 7 days" value={has ? sum((p) => p.published) : null} onClick={has ? () => open(platforms.flatMap((p) => p.publishedIds), "Published posts") : undefined} />
        <Kpi label="Upcoming planned" value={has ? sum((p) => p.planned) : null} hint="Ready, from today on" onClick={has ? () => open(platforms.flatMap((p) => p.plannedIds), "Upcoming posts") : undefined} />
        <Kpi label="Blocked, last 7 days" value={has ? sum((p) => p.blocked) : null} tone={sum((p) => p.blocked) ? "alert" : "ok"} onClick={has ? () => open(platforms.flatMap((p) => p.blockedIds), "Blocked posts") : undefined} />
        <Kpi label="Older history" value={has ? sum((p) => p.older) : null} hint="Past slots, not in the numbers" />
      </div>
      <Panel title="By platform">
        {platforms.length ? (
          <div className="platform-cards">
            {platforms.map((p) => (
              <button key={p.platform} className={`platform-card ${p.blocked ? "has-blocked" : ""}`} onClick={() => open(p.recordIds, p.platform)}>
                <span className="platform-card-name">{p.platform}<ArrowUpRight size={13} /></span>
                <span className="platform-card-stats">
                  <Chip tone="ok">{p.published} published</Chip>
                  <Chip>{p.planned} upcoming</Chip>
                  {p.blocked > 0 && <Chip tone="alert">{p.blocked} blocked</Chip>}{p.older > 0 && <Chip>{p.older} older</Chip>}
                </span>
              </button>
            ))}
          </div>
        ) : <Empty />}
      </Panel>
      <Panel title="Posts">
        {posts.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Post</th><th>Platform</th><th>Date</th><th>Status</th><th>Note</th><th>Evidence</th></tr></thead>
              <tbody>
                {posts.map((r) => (
                  <tr key={r.id} className={r.status === "blocked" ? "row-stale" : ""}>
                    <td><button className="text-button cell-title" onClick={() => open([r.id], "Post evidence")}>{r.target}</button></td>
                    <td>{meta(r, "platform")}</td>
                    <td className="nowrap quiet">{r.timestamp ? r.timestamp.slice(0, 10) : "—"}</td>
                    <td><Status value={r.status} /></td>
                    <td className="quiet">{meta(r, "blockedSince", meta(r, "waitingOn", meta(r, "blocker", "—")))}</td>
                    <td><button className="icon-button" aria-label={`Inspect ${r.target}`} onClick={() => open([r.id], "Post evidence")}><ArrowUpRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </Panel>
    </>
  );
}
