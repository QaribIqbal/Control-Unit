import { ArrowUpRight } from "lucide-react";
import type { PageProps } from "../ui";
import { Chip, Empty, Kpi, PageHeader, Panel, Status, meta } from "../ui";

export function Social({ data, open }: PageProps) {
  const posts = data.entities.social;
  const platforms = data.socialPlatforms;
  const has = posts.length > 0;
  const sum = (f: (p: (typeof platforms)[number]) => number) => platforms.reduce((n, p) => n + f(p), 0);
  const byId = new Map(data.records.map((r) => [r.id, r]));
  return (
    <>
      <PageHeader title="Social" subtitle="Per-platform posts: planned, published, blocked." />
      <div className="tile-row">
        <Kpi label="Published this week" value={has ? sum((p) => p.published) : null} tone="ok" />
        <Kpi label="Planned / ready" value={has ? sum((p) => p.planned - p.blocked) : null} />
        <Kpi label="Blocked" value={has ? sum((p) => p.blocked) : null} tone={sum((p) => p.blocked) ? "alert" : "ok"}
          onClick={has ? () => open(platforms.flatMap((p) => p.recordIds.filter((id) => byId.get(id)?.status === "blocked")), "Blocked posts") : undefined} />
      </div>
      <Panel title="By platform">
        {platforms.length ? (
          <div className="platform-cards">
            {platforms.map((p) => (
              <button key={p.platform} className={`platform-card ${p.blocked ? "has-blocked" : ""}`} onClick={() => open(p.recordIds, p.platform)}>
                <span className="platform-card-name">{p.platform}<ArrowUpRight size={13} /></span>
                <span className="platform-card-stats">
                  <Chip tone="ok">{p.published} published</Chip>
                  <Chip>{p.planned - p.blocked} planned</Chip>
                  {p.blocked > 0 && <Chip tone="alert">{p.blocked} blocked</Chip>}
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
              <thead><tr><th>Post</th><th>Platform</th><th>Status</th><th>Blocked since</th><th>Evidence</th></tr></thead>
              <tbody>
                {posts.map((r) => (
                  <tr key={r.id} className={r.status === "blocked" ? "row-stale" : ""}>
                    <td><button className="text-button cell-title" onClick={() => open([r.id], "Post evidence")}>{r.target}</button></td>
                    <td>{meta(r, "platform")}</td>
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
