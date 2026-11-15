import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Bot, ChevronDown, FileText, ShieldCheck, X } from "lucide-react";
import type { AnalysisResponse, DashboardData, ExecutionRecord, SourceReport } from "../shared/types";
import { normalizeStage, applyActionFloor, type Stage } from "../shared/stages";

export function formatDate(value: string | null, timezone?: string, short = false) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      ...(short ? {} : { hour: "2-digit", minute: "2-digit" }),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
export function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function meta(record: ExecutionRecord, key: string, fallback = "—") {
  const value = record.metadata[key];
  return value === null || value === undefined || value === ""
    ? fallback
    : String(value);
}
export function Empty({ children }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-dash">—</span>
      <p>No data recorded</p>
      {children && <small>{children}</small>}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Panel({
  id,
  title,
  icon,
  aside,
  children,
  className = "",
}: {
  id?: string;
  title: string;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
      <div className="panel-head">
        <h2>
          {icon}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const focusable = Array.from(
          container.current?.querySelectorAll<HTMLElement>(
            'button, a[href], input, textarea, select, [tabindex="0"]',
          ) || [],
        ).filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === container.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === container.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={container}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`drawer ${wide ? "drawer-wide" : ""}`}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const SPEC_FIELDS: [string, string][] = [
  ["company", "Company"], ["role", "Role"], ["person", "Person"], ["platform", "Platform"], ["touchType", "Type"],
  ["waitingFor", "Waiting for"], ["waitingOn", "Waiting on"], ["blockedSince", "Blocked since"], ["reply", "Reply"],
];
export function stageFor(record: ExecutionRecord): Stage {
  const fallback: Stage = record.actionType === "interview" ? "Interview" : record.actionType === "assessment" ? "Assessment" : "Applied";
  const stage = normalizeStage(record.metadata.stage, fallback);
  return applyActionFloor(stage, record.actionType);
}
export function RecordDetail({ record, timezone }: { record: ExecutionRecord; timezone: string }) {
  const link = safeLink(record.outputLink);
  const rawStage = String(record.metadata.stage || "").trim();
  const isStageful = ["job_application", "interview", "assessment"].includes(record.actionType);
  const rows: [string, ReactNode][] = [];
  rows.push(["Recorded", formatDate(record.timestamp, timezone)]);
  if (isStageful) rows.push(["Stage", <><span className="chip chip-neutral">{stageFor(record)}</span>{rawStage && rawStage.toLowerCase() !== stageFor(record).toLowerCase() && <span className="spec-raw">{rawStage}</span>}</>]);
  else if (rawStage) rows.push(["Stage", rawStage]);
  for (const [key, label] of SPEC_FIELDS) { const v = record.metadata[key]; if (v !== null && v !== undefined && v !== "") rows.push([label, String(v)]); }
  rows.push(["Action", record.actionType.replaceAll("_", " ")]);
  rows.push(["Agent", record.agent]);
  // Importer rows repeat the raw source row as `detail`; show it only inside the collapsed evidence box.
  const detailIsSourceCopy = Boolean(record.source.excerpt) && record.detail === record.source.excerpt;
  const showBody = Boolean(record.detail) && !detailIsSourceCopy;
  const extras = Object.entries(record.metadata).filter(([key, v]) => !SPEC_FIELDS.some(([k]) => k === key) && !["stage", "company", "role", "person", "appliedAt", "updatedAt", "externalId"].includes(key) && v !== null && v !== "");
  return (
    <article className="record-detail">
      <div className="record-detail-heading">
        <span className="agent-tag"><Bot size={14} />{record.agent}</span>
        <Status value={record.status} />
      </div>
      <h3>{record.target || record.actionType.replaceAll("_", " ")}</h3>
      <dl className="spec-sheet">
        {rows.map(([label, value]) => (<div className="spec-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>))}
        {extras.map(([key, v]) => (<div className="spec-row" key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{String(v)}</dd></div>))}
      </dl>
      {showBody && <p className="detail-text">{record.detail}</p>}
      {link ? (
        <a className="output-link" href={link} target="_blank" rel="noopener noreferrer">Open recorded output<ArrowUpRight size={16} /></a>
      ) : record.outputLink ? (
        <p className="quiet code-text source-path">Output reference: {record.outputLink}</p>
      ) : null}
      <details className="evidence-block">
        <summary><FileText size={15} />Source evidence</summary>
        <p className="code-text source-path">{record.source.path}</p>
        <p className="quiet">
          {record.source.sheet ? `Sheet: ${record.source.sheet}` : ""}
          {record.source.row !== undefined ? ` · Row ${record.source.row}` : ""}
          {record.source.line !== undefined ? `Line ${record.source.line}` : ""}
        </p>
        {record.source.excerpt ? <pre className="excerpt">{record.source.excerpt}</pre> : <p className="quiet">No source excerpt recorded</p>}
        <p className="quiet code-text">{record.recordKind} · {record.id}</p>
      </details>
    </article>
  );
}
export function PipelineTable({
  records,
  open,
  timezone,
  dental = false,
  stale = [],
}: {
  records: ExecutionRecord[];
  open: (ids: string[], title: string) => void;
  timezone: string;
  dental?: boolean;
  stale?: DashboardData["stale"];
}) {
  if (!records.length) return <Empty />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{dental ? "Practice / contact" : "Company / role"}</th>
            <th>Stage</th>
            <th>Waiting for</th>
            <th>Waiting on</th>
            <th>Days waiting</th>
            <th>Updated</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className={stale.some((item) => item.recordId === record.id) ? "row-stale" : ""}>
              <td>
                <button
                  className="text-button cell-title"
                  onClick={() => open([record.id], "Record evidence")}
                >
                  {meta(record, dental ? "person" : "company", record.target)}
                </button>
                <small>{meta(record, "role", record.detail)}</small>
              </td>
              <td>
                <span className="chip chip-neutral">{stageFor(record)}</span>
                {meta(record, "stage", "") && meta(record, "stage", "").toLowerCase() !== stageFor(record).toLowerCase() && <small className="stage-raw">{meta(record, "stage", "")}</small>}
              </td>
              <td>{meta(record, "waitingFor")}</td>
              <td>{meta(record, "waitingOn")}</td>
              <td>
                {(() => {
                  const item = stale.find((entry) => entry.recordId === record.id);
                  return item ? <Chip tone="alert">{item.daysWaiting}d</Chip> : meta(record, "daysWaiting");
                })()}
              </td>
              <td className="nowrap quiet">
                {formatDate(record.timestamp, timezone, true)}
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Inspect ${record.target}`}
                  onClick={() => open([record.id], "Record evidence")}
                >
                  <ArrowUpRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Sources({ sources }: { sources: SourceReport[] }) {
  if (!sources.length) return <Empty />;
  return (
    <div className="sources">
      {sources.map((source, index) => (
        <details className="source-row" key={`${source.path}-${index}`}>
          <summary>
            <span className={`source-dot ${source.status}`} />
            <span className="source-name">
              {source.kind}
              <small>{source.path.split("/").pop() || source.path}</small>
            </span>
            <span className={`source-status ${source.status}`}>
              {source.status === "ok"
                ? "Imported"
                : source.status === "missing"
                  ? "Missing"
                  : "Import error"}
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="source-expanded">
            <p className="code-text source-path">{source.path}</p>
            <p>{source.message || "No import message recorded"}</p>
            <dl>
              <dt>Imported records</dt>
              <dd>{source.records}</dd>
              <dt>Skipped entries</dt>
              <dd>{source.skipped}</dd>
              <dt>Last import attempt</dt>
              <dd>{formatDate(source.importedAt)}</dd>
            </dl>
          </div>
        </details>
      ))}
    </div>
  );
}
export function AnalysisResult({
  result,
  open,
}: {
  result: AnalysisResponse;
  open: (ids: string[], title: string) => void;
}) {
  return (
    <div className="analysis-result">
      <div className="analysis-mode">
        <ShieldCheck size={14} />
        <span>
          {result.mode === "local" ? "Extractive answer" : "LLM analysis"}
          {result.cached ? " · Cached" : ""}
        </span>
      </div>
      <p>{result.text}</p>
      {result.scope && <small className="quiet">Scope: {result.scope}</small>}
      {result.citations.length > 0 && (
        <div className="citations">
          {result.citations.map((id, index) => (
            <button
              key={`${id}-${index}`}
              onClick={() => open([id], "Cited evidence")}
            >
              <FileText size={12} />
              Evidence {index + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- glanceable building blocks ---------- */
export type OpenEvidence = (ids: string[], title: string) => void;
export interface PageProps {
  data: DashboardData;
  open: OpenEvidence;
  timezone: string;
  hosted: boolean;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="module-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="module-head-actions">{children}</div>}
    </header>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "alert"; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

/** Counts up to `value` (ease-out, ~600ms). Skips animation for reduced motion and after the first run. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = previous.current ?? 0;
    previous.current = value;
    if (reduce || from === value) { setShown(value); return; }
    const start = Date.now(), duration = 600;
    // A timer (not rAF) so hidden tabs still settle on the true value.
    const timer = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 4))));
      if (t >= 1) { window.clearInterval(timer); setShown(value); }
    }, 24);
    return () => { window.clearInterval(timer); setShown(value); };
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

/** Big-number tile. `value === null` always renders "No data recorded". */
export function Kpi({ label, value, hint, tone = "neutral", onClick }: {
  label: string; value: number | null; hint?: string; tone?: "neutral" | "ok" | "warn" | "alert"; onClick?: () => void;
}) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      {value === null ? <strong className="tile-value tile-empty">No data recorded</strong> : <strong className={`tile-value tile-${tone}`}><CountUp value={value} /></strong>}
      {hint && <small>{hint}</small>}
    </>
  );
  return onClick ? <button className="tile" onClick={onClick}>{body}</button> : <div className="tile">{body}</div>;
}

/** Vertical bars in the module colour (`--accent`); every bar opens its evidence. Labels are never truncated. */
export function Bars({ bars, open, title, compact = false }: {
  bars: { label: string; count: number; recordIds: string[] }[]; open?: OpenEvidence; title: string; compact?: boolean;
}) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  if (!bars.some((b) => b.count > 0)) return compact ? <div className="bars bars-compact bars-empty" aria-hidden="true">{bars.map((b, i) => <span key={i} className="bar-stub" />)}</div> : <Empty>Nothing recorded in this window.</Empty>;
  return (
    <div className={`bars ${compact ? "bars-compact" : ""}`} role="group" aria-label={title}>
      {bars.map((b, i) => {
        const inner = (
          <>
            {!compact && <span className="bar-count">{b.count || ""}</span>}
            <span className="bar-track"><span className={`bar-fill ${b.count ? "" : "zero"}`} style={{ height: `${Math.max(b.count ? 6 : 0, (b.count / max) * 100)}%`, ["--i" as string]: i }} /></span>
            {!compact && <span className="bar-label">{b.label}</span>}
          </>
        );
        return open && !compact ? (
          <button key={`${b.label}-${i}`} className="bar" onClick={() => open(b.recordIds, `${title} · ${b.label}`)} aria-label={`${b.label}: ${b.count}`}>{inner}</button>
        ) : (
          <span key={`${b.label}-${i}`} className="bar" title={`${b.label}: ${b.count}`}>{inner}</span>
        );
      })}
    </div>
  );
}

/** Horizontal funnel in the module colour: widest stage = 100%. Zero stages stay visible so the taxonomy is stable. */
export function Funnel({ stages, open, title }: {
  stages: { stage: string; count: number; recordIds: string[] }[]; open: OpenEvidence; title: string;
}) {
  if (!stages.some((s) => s.count > 0)) return <Empty />;
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="funnel" role="list" aria-label={title}>
      {stages.map((s, i) => (
        <button key={s.stage} role="listitem" className={`funnel-row ${s.count ? "" : "is-zero"}`} onClick={() => s.count && open(s.recordIds, `${title} · ${s.stage}`)} disabled={!s.count}>
          <span className="funnel-name">{s.stage}</span>
          <span className="funnel-track"><span className="funnel-fill" style={{ width: `${s.count ? Math.max(3, (s.count / max) * 100) : 0}%`, ["--i" as string]: i }} /></span>
          <strong>{s.count}</strong>
        </button>
      ))}
    </div>
  );
}
