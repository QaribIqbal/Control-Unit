import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileText,
  GitBranch,
  LayoutDashboard,
  Link2,
  LogOut,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import type {
  AnalysisResponse,
  DashboardData,
  ExecutionRecord,
  SourceReport,
} from "../shared/types";

import { ApiError, request } from "./api";

function formatDate(value: string | null, timezone?: string, short = false) {
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
function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function meta(record: ExecutionRecord, key: string, fallback = "—") {
  const value = record.metadata[key];
  return value === null || value === undefined || value === ""
    ? fallback
    : String(value);
}
function Empty({ children }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-dash">—</span>
      <p>No data recorded</p>
      {children && <small>{children}</small>}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Panel({
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
function Modal({
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
function RecordDetail({
  record,
  timezone,
}: {
  record: ExecutionRecord;
  timezone: string;
}) {
  const link = safeLink(record.outputLink);
  return (
    <article className="record-detail">
      <div className="record-detail-heading">
        <span className="agent-tag">
          <Bot size={14} />
          {record.agent}
        </span>
        <Status value={record.status} />
      </div>
      <h3>{record.target || record.actionType.replaceAll("_", " ")}</h3>
      <p className="detail-text">{record.detail || "No detail recorded"}</p>
      <dl className="detail-grid">
        <dt>Recorded</dt>
        <dd>{formatDate(record.timestamp, timezone)}</dd>
        <dt>Action</dt>
        <dd>{record.actionType}</dd>
        <dt>Record type</dt>
        <dd>{record.recordKind}</dd>
        <dt>Record ID</dt>
        <dd className="code-text">{record.id}</dd>
        <dt>Entity</dt>
        <dd className="code-text">{record.entityKey || "—"}</dd>
        {[
          "company",
          "person",
          "role",
          "stage",
          "waitingFor",
          "waitingOn",
          "blockedSince",
        ]
          .filter((key) => !(key in record.metadata))
          .map((key) => (
            <div className="detail-field" key={key}>
              <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
              <dd>Not recorded</dd>
            </div>
          ))}
        {Object.entries(record.metadata).map(([key, value]) => (
          <div className="detail-field" key={key}>
            <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
            <dd>
              {value === null || value === "" ? "Not recorded" : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="evidence-block">
        <h4>
          <FileText size={15} />
          Source evidence
        </h4>
        <p className="code-text source-path">{record.source.path}</p>
        <p className="quiet">
          {record.source.sheet ? `Sheet: ${record.source.sheet}` : ""}
          {record.source.row !== undefined ? ` · Row ${record.source.row}` : ""}
          {record.source.line !== undefined ? `Line ${record.source.line}` : ""}
        </p>
        {record.source.excerpt ? (
          <pre className="excerpt">{record.source.excerpt}</pre>
        ) : (
          <p className="quiet">No source excerpt recorded</p>
        )}
      </div>
      {link ? (
        <a
          className="output-link"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open recorded output
          <ArrowUpRight size={16} />
        </a>
      ) : record.outputLink ? (
        <div className="evidence-block">
          <h4>Recorded output reference</h4>
          <p className="code-text source-path">{record.outputLink}</p>
          <p className="quiet">
            File references are shown for inspection and are not opened by the
            dashboard.
          </p>
        </div>
      ) : (
        <p className="quiet">No output link recorded</p>
      )}
    </article>
  );
}
function PipelineTable({
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
            <tr key={record.id}>
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
                <span className="stage-label">
                  {meta(record, "stage", record.status.replaceAll("_", " "))}
                </span>
              </td>
              <td>{meta(record, "waitingFor")}</td>
              <td>{meta(record, "waitingOn")}</td>
              <td>
                {stale.find((item) => item.recordId === record.id)
                  ?.daysWaiting ?? meta(record, "daysWaiting")}
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
function Sources({ sources }: { sources: SourceReport[] }) {
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
function AnalysisResult({
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

export default function App() {
  const [session, setSession] = useState<{ authenticated: boolean; mode: "local" | "hosted" } | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionChecking, setSessionChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const authGeneration = useRef(0);
  const sessionRequest = useRef(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [visibleActivity, setVisibleActivity] = useState(12);
  const [drawer, setDrawer] = useState<{ title: string; ids: string[] } | null>(
    null,
  );
  const [extraRecords, setExtraRecords] = useState<
    Record<string, ExecutionRecord>
  >({});
  const [drawerError, setDrawerError] = useState("");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [setup, setSetup] = useState(false);
  const [digest, setDigest] = useState<AnalysisResponse | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [answers, setAnswers] = useState<
    { question: string; result: AnalysisResponse }[]
  >([]);
  const [activeSection, setActiveSection] = useState("overview");
  const clearProtectedData = useCallback(() => {
    authGeneration.current += 1;
    sessionRequest.current += 1;
    setSessionChecking(false);
    setData(null);
    setExtraRecords({});
    setDrawer(null);
    setLinkModal(false);
    setSetup(false);
    setDigest(null);
    setAnswers([]);
    setQuestion("");
    setQuery("");
    setAgentFilter("all");
    setVisibleActivity(12);
    setNotice("");
    setError("");
    setAskError("");
    setDigestError("");
    setDrawerError("");
  }, []);
  const expireSession = useCallback(() => {
    clearProtectedData();
    setSession({ authenticated: false, mode: "hosted" });
    setPassword("");
    setSignInError("Your session has expired. Sign in again.");
  }, [clearProtectedData]);
  const api = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const generation = authGeneration.current;
    try {
      const result = await request<T>(path, options);
      if (generation !== authGeneration.current) throw new ApiError("Session changed", 401);
      return result;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && generation === authGeneration.current) expireSession();
      throw cause;
    }
  }, [expireSession]);
  const checkSession = useCallback(async () => {
    const attempt = ++sessionRequest.current;
    setSessionChecking(true);
    setSessionError("");
    try {
      const result = await request<{ authenticated: boolean; mode: "local" | "hosted" }>("/api/session");
      if (attempt === sessionRequest.current) setSession(result);
    } catch (cause) {
      if (attempt === sessionRequest.current) setSessionError(cause instanceof Error ? cause.message : "The server could not be reached.");
    } finally {
      if (attempt === sessionRequest.current) setSessionChecking(false);
    }
  }, []);
  const load = useCallback(async (silent = false) => {
    const generation = authGeneration.current;
    if (!silent) setLoading(true);
    try {
      const response = await api<DashboardData>("/api/dashboard");
      if (generation !== authGeneration.current) return false;
      setData(response);
      setError("");
      return true;
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) setError(
        cause instanceof Error ? cause.message : "Dashboard could not load",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => {
    if (!session?.authenticated) return;
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load, session?.authenticated]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!password || signingIn) return;
    setSigningIn(true);
    setSignInError("");
    try {
      await request("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      sessionRequest.current += 1;
      setSessionChecking(false);
      setSession({ authenticated: true, mode: "hosted" });
    } catch (cause) {
      setPassword("");
      setSignInError(cause instanceof Error ? cause.message : "Sign-in could not complete.");
    } finally {
      setSigningIn(false);
    }
  }
  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/logout", { method: "POST" });
      clearProtectedData();
      setPassword("");
      setSignInError("");
      setSession({ authenticated: false, mode: "hosted" });
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) setError(cause instanceof Error ? cause.message : "Sign-out could not complete. Please try again.");
    } finally { setSigningOut(false); }
  }
  const open = useCallback((ids: string[], title: string) => {
    setDrawer({ ids, title });
    setDrawerError("");
  }, []);
  useEffect(() => {
    if (!drawer || !data) return;
    const missing = drawer.ids.filter(
      (id) =>
        !data.records.some((record) => record.id === id) && !extraRecords[id],
    );
    if (!missing.length) {
      setDrawerLoading(false);
      return;
    }
    let active = true;
    setDrawerLoading(true);
    void Promise.all(
      missing.map((id) =>
        api<ExecutionRecord>(`/api/records/${encodeURIComponent(id)}`),
      ),
    )
      .then((records) => {
        if (active)
          setExtraRecords((previous) => ({
            ...previous,
            ...Object.fromEntries(records.map((record) => [record.id, record])),
          }));
      })
      .catch((cause) => {
        if (active)
          setDrawerError(
            cause instanceof Error ? cause.message : "Evidence could not load",
          );
      })
      .finally(() => {
        if (active) setDrawerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [drawer, data, extraRecords, api]);
  async function refresh() {
    setRefreshing(true);
    setNotice("");
    try {
      if (!hosted) await api("/api/import", { method: "POST" });
      if (await load(true)) setNotice(hosted ? "Dashboard refreshed. Collector sync is independent." : "Sources checked. Dashboard updated.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sources could not refresh",
      );
    } finally {
      setRefreshing(false);
    }
  }
  async function generateDigest() {
    setDigestLoading(true);
    setDigestError("");
    try {
      setDigest(
        await api<AnalysisResponse>("/api/digest", { method: "POST" }),
      );
    } catch (cause) {
      setDigestError(
        cause instanceof Error ? cause.message : "Digest could not load",
      );
    } finally {
      setDigestLoading(false);
    }
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    const asked = question.trim();
    setAsking(true);
    setAskError("");
    try {
      const result = await api<AnalysisResponse>("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: asked }),
      });
      setAnswers((previous) => [...previous, { question: asked, result }]);
      setQuestion("");
    } catch (cause) {
      setAskError(
        cause instanceof Error ? cause.message : "Answer could not load",
      );
    } finally {
      setAsking(false);
    }
  }
  const hosted = (data?.runtime?.mode || session?.mode) === "hosted";
  const ingestionEndpoint = data?.runtime?.ingestionEndpoint || `${window.location.origin}/api/executions`;
  const timezone = data?.timezone || "Asia/Karachi";
  const hasNoRecords = data?.records.length === 0;
  const nonInboxSources = data?.sources.filter((source) => source.kind !== "inbox") || [];
  const localSourcesUnavailable = Boolean(
    !hosted && nonInboxSources.length &&
    nonInboxSources.every((source) => source.status === "missing" || source.status === "error"),
  );
  const filteredRecords = (data?.records || [])
    .filter(
      (record) =>
        (agentFilter === "all" || record.agent === agentFilter) &&
        (!query.trim() ||
          [
            record.agent,
            record.target,
            record.detail,
            record.actionType,
            record.status,
            ...Object.values(record.metadata),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase().trim())),
    )
    .sort(
      (a, b) =>
        (b.timestamp ? Date.parse(b.timestamp) : -Infinity) -
        (a.timestamp ? Date.parse(a.timestamp) : -Infinity),
    );
  const recordById = new Map(
    (data?.records || []).map((record) => [record.id, record]),
  );
  const linkedinRecords = (
    data?.kpis.find((kpi) => kpi.id === "linkedin-total")?.recordIds || []
  )
    .map((id) => recordById.get(id))
    .filter((record): record is ExecutionRecord => Boolean(record));
  const navigation = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "linkedin", label: "LinkedIn", icon: TrendingUp },
    { id: "pipelines", label: "Pipelines", icon: GitBranch },
    { id: "social", label: "Social", icon: MessageSquare },
    { id: "agents", label: "Agents & sources", icon: Bot },
  ];
  if (!session?.authenticated) return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand"><span className="brand-mark"><span /><span /><span /></span><span>Control<span className="brand-second">Unit</span></span></div>
        <div className="auth-eyebrow"><ShieldCheck size={14} /> Private workspace</div>
        <h1 id="auth-title">{sessionChecking ? "Connecting to your workspace" : sessionError ? "Workspace unavailable" : "Your operations, in view."}</h1>
        {sessionChecking ? <p className="loading-inline" role="status"><LoaderCircle className="spinning" size={16} /> Checking your session…</p> : sessionError ? <>
          <p className="inline-error" role="alert">{sessionError}</p>
          <button className="button" onClick={() => void checkSession()}>Retry connection</button>
        </> : <>
          <p className="auth-description">Sign in to your private hosted workspace to review agent execution, outcomes and recorded evidence.</p>
          <form onSubmit={(event) => void signIn(event)}>
            <label htmlFor="workspace-password">Workspace password</label>
            <input id="workspace-password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} disabled={signingIn} aria-describedby={signInError ? "sign-in-error" : undefined} />
            {signInError && <p id="sign-in-error" className="inline-error" role="alert">{signInError}</p>}
            <button className="button auth-submit" disabled={signingIn || !password}>{signingIn ? <><LoaderCircle size={15} className="spinning" /> Signing in…</> : <>Open workspace <ArrowUpRight size={15} /></>}</button>
          </form>
          <p className="auth-footnote"><Database size={14} /> Synced records. Source files stay with your collector.</p>
        </>}
      </section>
    </main>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to dashboard
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          aria-label="Control Unit overview"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <span>
            Control<span className="brand-second">Unit</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="local-dot" />
          {hosted ? "Private hosted workspace" : "Local workspace"}
        </div>
        <nav aria-label="Dashboard navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              className={activeSection === id ? "active" : ""}
              href={`#${id}`}
              onClick={() => setActiveSection(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {activeSection === id && <span className="nav-mark" />}
            </a>
          ))}
        </nav>
        <button className="link-agent" onClick={() => setLinkModal(true)}>
          <Plus size={16} />
          Link an agent
        </button>
        {hosted && <button className="sidebar-sign-out" disabled={signingOut} onClick={() => void signOut()} aria-label={signingOut ? "Signing out" : "Sign out"} title="Sign out"><LogOut size={15} /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>}
        <div className="sidebar-bottom">
          <div>
            <span className={`local-dot ${error ? "offline" : ""}`} />
            {error
              ? "Connection needs attention"
              : loading
                ? hosted ? "Connecting to workspace" : "Connecting locally"
                : hosted ? "Hosted workspace" : "Running locally"}
          </div>
          <small>{hosted ? "Source files stay with your collector" : "Source files stay on this machine"}</small>
          <div className="sidebar-timezone">
            <Clock3 size={13} />
            {timezone}
          </div>
        </div>
      </aside>
      <main id="main-content">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>Overview</strong>
          </span>
          <div className="topbar-right">
            <span className="today">
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: timezone,
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              }).format(new Date())}
            </span>
            <span className="local-chip">
              <span className="local-dot" />
              {hosted ? "Private hosted" : "Local server"}
            </span>
          </div>
        </header>
        <div className="main-content">
          <section className="page-heading" id="overview">
            <div>
              <div className="heading-note">
                <span className="live-indicator" />
                Agent operations
              </div>
              <h1>
                Your agents.
                <br className="mobile-break" /> Accounted for.
              </h1>
              <p>Execution, outcomes and the work waiting on you.</p>
            </div>
            <div className="heading-actions">
              <span className="last-updated">
                {hosted
                  ? data?.runtime?.lastSyncAt ? `Collector synced ${formatDate(data.runtime.lastSyncAt, timezone)}` : "Collector sync not recorded"
                  : data ? `Checked ${formatDate(data.generatedAt, timezone)}` : "Waiting for local records"}
              </span>
              <button
                className="button"
                onClick={() => void refresh()}
                disabled={refreshing || loading}
              >
                <RefreshCw size={15} className={refreshing ? "spinning" : ""} />
                {refreshing ? hosted ? "Refreshing…" : "Checking sources…" : hosted ? "Refresh dashboard" : "Refresh sources"}
              </button>
            </div>
          </section>
          {error && (
            <div className="error-banner" role="alert">
              <CircleAlert size={17} />
              <div>
                <strong>Dashboard needs attention</strong>
                <p>
                  {error}
                  {data
                    ? " Showing the last loaded records."
                    : hosted ? " Check the deployment configuration and try again." : " Check that the local server is running."}
                </p>
              </div>
              <button className="text-button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={15} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {hasNoRecords && (
            <section className="empty-data-banner" role="status" aria-live="polite">
              <div className="empty-data-copy">
                <Database size={17} aria-hidden="true" />
                <div>
                  <strong>
                    {hosted && data?.runtime?.collectorRequired && !data.runtime.lastSyncAt
                      ? "Rio is not connected yet"
                      : localSourcesUnavailable
                        ? "Rio’s source files were not found here"
                        : "No execution records received"}
                  </strong>
                  <p>
                    {hosted && data?.runtime?.collectorRequired && !data.runtime.lastSyncAt
                      ? "Run the read-only collector on Rio’s machine to send the first records to this dashboard."
                      : localSourcesUnavailable
                        ? "The expected log paths are unavailable on this computer. Set RIO_HOME to a read-only copy, or use the collector where Rio’s files are available."
                        : "Check the source health and parse reports below to see which inputs were found and what they contained."}
                  </p>
                </div>
              </div>
              {hosted && data?.runtime?.collectorRequired && !data.runtime.lastSyncAt ? (
                <button className="button" onClick={() => setLinkModal(true)}>Connect Rio</button>
              ) : localSourcesUnavailable ? (
                <a className="text-button" href="#agents">Inspect source paths <ArrowUpRight size={13} /></a>
              ) : (
                <a className="text-button" href="#agents">Inspect source reports <ArrowUpRight size={13} /></a>
              )}
            </section>
          )}
          {loading && !data ? (
            <div className="initial-loading" role="status">
              <LoaderCircle size={24} className="spinning" />
              <p>{hosted ? "Reading your hosted workspace…" : "Reading your local workspace…"}</p>
            </div>
          ) : (
            <>
              <div className="kpi-strip" aria-label="Recorded metrics">
                {data?.kpis.length ? (
                  data.kpis.map((kpi) => (
                    <button
                      className="kpi"
                      key={kpi.id}
                      title={kpi.description}
                      onClick={() => open(kpi.recordIds, kpi.label)}
                      aria-label={`${kpi.label}: ${kpi.value === null ? "No data recorded" : kpi.value}. Inspect evidence`}
                    >
                      <span className="kpi-label">
                        {kpi.label}
                        <ArrowUpRight size={13} />
                      </span>
                      <strong className={kpi.value === null ? "kpi-empty" : ""}>
                        {kpi.value === null
                          ? "No data recorded"
                          : kpi.value.toLocaleString()}
                      </strong>
                      <small>{kpi.description}</small>
                    </button>
                  ))
                ) : (
                  <div className="kpi no-kpis">
                    <span className="kpi-label">Recorded metrics</span>
                    <strong className="kpi-empty">No data recorded</strong>
                    <small>{hosted ? "Run the collector to sync available evidence." : "Refresh sources to read available evidence."}</small>
                  </div>
                )}
              </div>
              <div className="primary-grid">
                <Panel
                  id="activity"
                  title="Activity ledger"
                  icon={<Activity size={17} />}
                  aside={<span className="quiet head-note">Newest first</span>}
                >
                  <div className="activity-controls">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setVisibleActivity(12);
                        }}
                        placeholder="Search actions, targets or details"
                        aria-label="Search activity"
                      />
                    </label>
                    <label className="agent-select">
                      <span className="sr-only">Filter by agent</span>
                      <select
                        value={agentFilter}
                        onChange={(event) => {
                          setAgentFilter(event.target.value);
                          setVisibleActivity(12);
                        }}
                      >
                        <option value="all">All agents</option>
                        {data?.agents.map((agent) => (
                          <option key={agent.name} value={agent.name}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {filteredRecords.length ? (
                    <div className="activity-list">
                      {filteredRecords
                        .slice(0, visibleActivity)
                        .map((record) => (
                          <button
                            className="activity-row"
                            key={record.id}
                            onClick={() => open([record.id], "Record evidence")}
                          >
                            <span
                              className={`activity-marker ${record.status}`}
                            >
                              <Activity size={15} />
                            </span>
                            <span className="activity-content">
                              <span className="activity-title">
                                {record.target ||
                                  record.actionType.replaceAll("_", " ")}
                                <Status value={record.status} />
                              </span>
                              <span className="activity-description">
                                {record.detail ||
                                  record.actionType.replaceAll("_", " ")}
                              </span>
                              <span className="activity-meta">
                                <span>{record.agent}</span>
                                <span>{record.recordKind}</span>
                                <span>
                                  {formatDate(record.timestamp, timezone)}
                                </span>
                              </span>
                            </span>
                            <ChevronRight className="row-arrow" size={16} />
                          </button>
                        ))}
                      {filteredRecords.length > visibleActivity && (
                        <button
                          className="load-more"
                          onClick={() =>
                            setVisibleActivity((previous) => previous + 12)
                          }
                        >
                          Show more activity
                          <ChevronDown size={15} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <Empty>
                      {query || agentFilter !== "all"
                        ? "No records match the current filters."
                        : hosted ? "Sync your collector or link an agent to begin." : "Refresh sources or link an agent to begin."}
                    </Empty>
                  )}
                </Panel>
                <div className="attention-column">
                  <Panel
                    title="Needs attention"
                    icon={<CircleAlert size={17} />}
                    className="attention-panel"
                  >
                    {data &&
                    (data.verification.length > 0 || data.stale.length > 0) ? (
                      <div className="attention-items">
                        {data.verification.map((item) => (
                          <button
                            className="attention-item danger"
                            key={`v-${item.recordId}`}
                            onClick={() =>
                              open([item.recordId], "Unverified success")
                            }
                          >
                            <span className="attention-kind">
                              <ShieldCheck size={14} />
                              Unverified success
                            </span>
                            <strong>
                              {recordById.get(item.recordId)?.target ||
                                "Recorded success claim"}
                            </strong>
                            <p>{item.reason}</p>
                            <span className="inspect-label">
                              Inspect evidence
                              <ChevronRight size={13} />
                            </span>
                          </button>
                        ))}
                        {data.stale.map((item) => (
                          <button
                            className="attention-item warning"
                            key={`s-${item.recordId}`}
                            onClick={() =>
                              open([item.recordId], "Waiting work")
                            }
                          >
                            <span className="attention-kind">
                              <Clock3 size={14} />
                              Waiting {item.daysWaiting} days
                            </span>
                            <strong>
                              {recordById.get(item.recordId)?.target ||
                                "Waiting work"}
                            </strong>
                            <p>
                              Waiting on: {item.waitingOn || "Not recorded"}
                            </p>
                            <span className="inspect-label">
                              Inspect evidence
                              <ChevronRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty>
                        Verification flags and stale work appear here.
                      </Empty>
                    )}
                  </Panel>
                  <Panel
                    title="Operations digest"
                    icon={<Sparkles size={17} />}
                    aside={
                      <button
                        className="text-button"
                        disabled={digestLoading}
                        onClick={() => void generateDigest()}
                      >
                        {digestLoading
                          ? "Generating…"
                          : digest
                            ? "Regenerate"
                            : "Generate"}
                      </button>
                    }
                  >
                    {digestError && (
                      <p className="inline-error" role="alert">
                        {digestError}
                      </p>
                    )}
                    {digest ? (
                      <AnalysisResult result={digest} open={open} />
                    ) : (
                      <div className="digest-placeholder">
                        <p>
                          A grounded readout of recorded work, blockers and
                          outcomes.
                        </p>
                        <span>
                          <ShieldCheck size={14} />
                          {data?.analysis.configured
                            ? `Optional model: ${data.analysis.model}`
                            : "Extractive analysis available"}
                        </span>
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
              <div className="secondary-grid">
                <Panel
                  id="linkedin"
                  title="LinkedIn outreach"
                  icon={<TrendingUp size={17} />}
                  aside={
                    <span className="quiet head-note">Daily activity</span>
                  }
                >
                  <div className="chart-intro">
                    <p>Recorded touches</p>
                    <span className="quiet">
                      Select a day to inspect its evidence
                    </span>
                  </div>
                  {data?.linkedinDaily.some((day) => day.count > 0) ? (
                    <div
                      className="chart"
                      role="group"
                      aria-label="Daily LinkedIn activity"
                    >
                      {data.linkedinDaily.map((day) => (
                        <button
                          key={day.date}
                          className="chart-column"
                          onClick={() =>
                            open(day.recordIds, `LinkedIn · ${day.date}`)
                          }
                          aria-label={`${day.date}: ${day.count} recorded touches`}
                        >
                          <span className="bar-value">{day.count}</span>
                          <span className="bar-space">
                            <span
                              className={`chart-bar ${day.count ? "" : "zero"}`}
                              style={{
                                height: `${(day.count / Math.max(...data.linkedinDaily.map((item) => item.count), 1)) * 100}%`,
                              }}
                            />
                          </span>
                          <span className="bar-date">
                            {day.date.slice(5).replace("-", "/")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty>
                      No LinkedIn touches are recorded in this date window.
                    </Empty>
                  )}
                  {linkedinRecords.length ? (
                    <div className="table-scroll linkedin-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Person</th>
                            <th>Company</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linkedinRecords.map((record) => (
                            <tr key={record.id}>
                              <td className="nowrap">
                                {formatDate(record.timestamp, timezone)}
                              </td>
                              <td>
                                <button
                                  className="text-button cell-title"
                                  onClick={() =>
                                    open(
                                      [record.id],
                                      "LinkedIn outreach evidence",
                                    )
                                  }
                                >
                                  {meta(record, "person", record.target)}
                                </button>
                              </td>
                              <td>{meta(record, "company")}</td>
                              <td>
                                {meta(
                                  record,
                                  "type",
                                  meta(
                                    record,
                                    "touchType",
                                    record.actionType.replaceAll("_", " "),
                                  ),
                                )}
                              </td>
                              <td>
                                <Status value={record.status} />
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  onClick={() =>
                                    open(
                                      [record.id],
                                      "LinkedIn outreach evidence",
                                    )
                                  }
                                  aria-label={`Inspect ${record.target}`}
                                >
                                  <ArrowUpRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </Panel>
                <Panel
                  title="Ask your data"
                  icon={<MessageSquare size={17} />}
                  aside={
                    <span className="mode-label">
                      {data?.analysis.configured ? "LLM enabled" : "Extractive mode"}
                    </span>
                  }
                >
                  <div className="ask-body">
                    {!data?.analysis.configured && (
                      <p className="analysis-hint">
                        Answers use recorded evidence.{" "}
                        <button
                          className="text-button"
                          onClick={() => setSetup(true)}
                        >
                          Optional LLM setup
                        </button>
                      </p>
                    )}
                    {answers.length ? (
                      <div className="answer-history" aria-live="polite">
                        {answers.map((answer, index) => (
                          <div className="answer-pair" key={index}>
                            <h3>{answer.question}</h3>
                            <AnalysisResult
                              result={answer.result}
                              open={open}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ask-prompt">
                        Ask about applications, outreach, waiting work or an
                        agent’s latest output.
                      </p>
                    )}
                    <form
                      className="ask-form"
                      onSubmit={(event) => void ask(event)}
                    >
                      <label className="sr-only" htmlFor="question">
                        Question about recorded data
                      </label>
                      <input
                        id="question"
                        value={question}
                        onChange={(event) => setQuestion(event.target.value)}
                        placeholder="What needs my attention?"
                        maxLength={2000}
                        disabled={asking}
                      />
                      <button
                        className="send-button"
                        disabled={asking || !question.trim()}
                        aria-label={asking ? "Getting answer" : "Ask question"}
                      >
                        {asking ? (
                          <LoaderCircle size={17} className="spinning" />
                        ) : (
                          <Send size={17} />
                        )}
                      </button>
                    </form>
                    {askError && (
                      <p className="inline-error" role="alert">
                        {askError}
                      </p>
                    )}
                    <p className="ask-footnote">
                      Every answer cites its recorded evidence.
                    </p>
                  </div>
                </Panel>
              </div>
              <div id="pipelines" className="section-heading">
                <div>
                  <h2>Work in motion</h2>
                  <p>
                    Current opportunity and lead state, with stakeholder
                    ownership.
                  </p>
                </div>
                <GitBranch size={19} />
              </div>
              <div className="pipeline-grid">
                <Panel title="Interviews">
                  <PipelineTable
                    records={data?.entities.interviews || []}
                    open={open}
                    timezone={timezone}
                    stale={data?.stale}
                  />
                </Panel>
                <Panel title="Assessments">
                  <PipelineTable
                    records={data?.entities.assessments || []}
                    open={open}
                    timezone={timezone}
                    stale={data?.stale}
                  />
                </Panel>
              </div>
              <Panel
                title="Dental pipeline"
                className="dental-panel"
                aside={
                  <span className="quiet head-note">Latest recorded stage</span>
                }
              >
                {data?.dentalStages.length ? (
                  <div className="stage-strip">
                    {data.dentalStages.map((stage) => (
                      <button
                        key={stage.stage}
                        onClick={() =>
                          open(stage.recordIds, `Dental · ${stage.stage}`)
                        }
                      >
                        <strong>{stage.count}</strong>
                        <span>{stage.stage}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                ) : null}
                <PipelineTable
                  records={data?.entities.dental || []}
                  open={open}
                  timezone={timezone}
                  stale={data?.stale}
                  dental
                />
              </Panel>
              <Panel
                id="social"
                title="Social publishing"
                icon={<MessageSquare size={17} />}
                aside={
                  <span className="quiet head-note">
                    Recorded platform state
                  </span>
                }
              >
                <div className="social-platforms">
                  {data?.socialPlatforms.length ? (
                    data.socialPlatforms.map((platform) => (
                      <div className="platform-row" key={platform.platform}>
                        <button
                          className="platform-name text-button"
                          onClick={() =>
                            open(platform.recordIds, platform.platform)
                          }
                        >
                          {platform.platform}
                          <ArrowUpRight size={13} />
                        </button>
                        <button
                          className="platform-metric"
                          onClick={() =>
                            open(
                              platform.plannedIds,
                              `${platform.platform} · Planned`,
                            )
                          }
                        >
                          <strong>{platform.planned}</strong>
                          <span>Planned</span>
                        </button>
                        <button
                          className="platform-metric"
                          onClick={() =>
                            open(
                              platform.publishedIds,
                              `${platform.platform} · Published`,
                            )
                          }
                        >
                          <strong>{platform.published}</strong>
                          <span>Published this week</span>
                        </button>
                        <button
                          className="platform-metric"
                          onClick={() =>
                            open(
                              platform.recordIds.filter(
                                (id) =>
                                  recordById.get(id)?.status === "blocked",
                              ),
                              `${platform.platform} · Blocked`,
                            )
                          }
                        >
                          <strong
                            className={platform.blocked ? "amber-text" : ""}
                          >
                            {platform.blocked}
                          </strong>
                          <span>Blocked</span>
                        </button>
                      </div>
                    ))
                  ) : (
                    <Empty />
                  )}
                </div>
                {data?.entities.social.length ? (
                  <div className="table-scroll social-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Post / output</th>
                          <th>Platform</th>
                          <th>Status</th>
                          <th>Blocker / waiting on</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.entities.social.map((record) => (
                          <tr key={record.id}>
                            <td>
                              <button
                                className="text-button cell-title"
                                onClick={() =>
                                  open([record.id], "Publishing evidence")
                                }
                              >
                                {record.target}
                              </button>
                              <small>{record.detail}</small>
                            </td>
                            <td>{meta(record, "platform")}</td>
                            <td>
                              <Status value={record.status} />
                            </td>
                            <td>
                              {meta(
                                record,
                                "waitingOn",
                                meta(record, "blocker"),
                              )}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                onClick={() =>
                                  open([record.id], "Publishing evidence")
                                }
                                aria-label={`Inspect ${record.target}`}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Panel>
              <div id="agents" className="section-heading">
                <div>
                  <h2>Agents & evidence</h2>
                  <p>{hosted ? "Last recorded work and the health reported by your collector." : "Last recorded work and the health of each local source."}</p>
                </div>
                <Database size={19} />
              </div>
              <div className="secondary-grid">
                <Panel
                  title="Linked agents"
                  icon={<Bot size={17} />}
                  aside={
                    <button
                      className="text-button"
                      onClick={() => setLinkModal(true)}
                    >
                      <Plus size={14} />
                      Link agent
                    </button>
                  }
                >
                  {data?.agents.length ? (
                    <div className="agents-list">
                      {data.agents.map((agent) => (
                        <article className="agent-row" key={agent.name}>
                          <div className="agent-row-top">
                            <span className="agent-avatar">
                              <Bot size={21} />
                            </span>
                            <div>
                              <button
                                className="text-button agent-name"
                                onClick={() =>
                                  open(
                                    agent.recordIds,
                                    `${agent.name} · Recorded work`,
                                  )
                                }
                              >
                                {agent.name}
                                <ArrowUpRight size={13} />
                              </button>
                              <small>
                                Last run: {formatDate(agent.lastRun, timezone)}
                              </small>
                            </div>
                          </div>
                          <div className="agent-output">
                            <span>Latest output</span>
                            {agent.latestOutput ? (
                              <button
                                className="text-button"
                                onClick={() =>
                                  open(
                                    [agent.latestOutput!.id],
                                    "Latest recorded output",
                                  )
                                }
                              >
                                {agent.latestOutput.target ||
                                  agent.latestOutput.detail}
                                <ArrowUpRight size={14} />
                              </button>
                            ) : (
                              <span className="quiet">No data recorded</span>
                            )}
                          </div>
                          <div className="agent-counts">
                            {agent.recordIds.length ? (
                              <>
                                <button
                                  onClick={() =>
                                    open(
                                      agent.failed,
                                      `${agent.name} · Failed records`,
                                    )
                                  }
                                >
                                  <span
                                    className={
                                      agent.failed.length ? "red-text" : ""
                                    }
                                  >
                                    {agent.failed.length}
                                  </span>{" "}
                                  failed records
                                </button>
                                <button
                                  onClick={() =>
                                    open(
                                      agent.blocked,
                                      `${agent.name} · Blocked records`,
                                    )
                                  }
                                >
                                  <span
                                    className={
                                      agent.blocked.length ? "amber-text" : ""
                                    }
                                  >
                                    {agent.blocked.length}
                                  </span>{" "}
                                  blocked records
                                </button>
                              </>
                            ) : (
                              <span className="quiet">No data recorded</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty>{hosted ? "Link an agent or sync an existing source with the collector." : "Link an agent or import an existing source."}</Empty>
                  )}
                </Panel>
                <Panel
                  title="Source health"
                  icon={<Database size={17} />}
                  aside={
                    <button
                      className="text-button"
                      disabled={refreshing}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw
                        size={13}
                        className={refreshing ? "spinning" : ""}
                      />
                      {hosted ? "Refresh dashboard" : "Check sources"}
                    </button>
                  }
                >
                  <Sources sources={data?.sources || []} />
                </Panel>
              </div>
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} />
                  {hosted ? "Synced execution evidence. Every result has a trail." : "Read-only source imports. Every result has a trail."}
                </span>
                <span>{timezone}</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {drawer && (
        <Modal title={drawer.title} close={() => setDrawer(null)}>
          <div className="drawer-body">
            <p className="drawer-description">
              The records behind this result, with their original source
              references.
            </p>
            {drawerLoading && (
              <p className="loading-inline" role="status">
                <LoaderCircle className="spinning" size={16} />
                Loading evidence…
              </p>
            )}
            {drawerError && (
              <p className="inline-error" role="alert">
                {drawerError}
              </p>
            )}
            {!drawer.ids.length && (
              <Empty>
                No contributing records are available for this result.
              </Empty>
            )}
            {drawer.ids.map((id) => {
              const record = recordById.get(id) || extraRecords[id];
              return record ? (
                <RecordDetail key={id} record={record} timezone={timezone} />
              ) : !drawerLoading ? (
                <p className="inline-error" key={id}>
                  Record unavailable: {id}
                </p>
              ) : null;
            })}
          </div>
        </Modal>
      )}
      {linkModal && (
        <Modal title="Link an agent" close={() => setLinkModal(false)}>
          <div className="drawer-body setup-content">
            <p>
              {hosted ? "This private hosted workspace receives synced execution records. Source files remain on the collector’s machine." : "Control Unit reads execution evidence locally. Use the inbox for files or submit records to the execution endpoint."}
            </p>
            <h3>{hosted ? "Connect the local collector" : "Local inbox"}</h3>
            {hosted ? <p>On Rio’s machine, set <code>CONTROL_UNIT_URL</code> to <code>{window.location.origin}</code> and configure <code>INGESTION_TOKEN</code> in the collector’s gitignored <code>.env</code>, then run <code>npm run collector</code>. The collector reads the configured local source files and syncs records to this workspace. Refresh dashboard loads the latest synced records.</p> : <p>
              Save JSON or JSONL records in <code>inbox/</code>, then choose <strong>Refresh sources</strong>. Each record needs an agent, timestamp (null is valid), action type, target, detail and status. Source provenance is generated by the server. Use the complete schema in the project README.
            </p>}
            <h3>Execution endpoint</h3>
            <code className="code-block">
              POST {ingestionEndpoint}
            </code>
            <p>
              Send a JSON record or an array of records. {hosted ? "A bearer token is required for every ingestion request. Configure the token in the hosting provider’s server environment and in the collector’s private environment." : "If an ingestion token is configured, your agent must supply it as a bearer token. Credentials stay in the server environment."}
            </p>
            <h3>Record fields</h3>
            <dl className="setup-fields">
              <dt>Identity</dt>
              <dd>
                <code>agent</code>, <code>actionType</code>, <code>target</code>
                , <code>detail</code>
              </dd>
              <dt>State</dt>
              <dd>
                <code>status</code>, <code>timestamp</code> (ISO date or null)
              </dd>
              <dt>Provenance</dt>
              <dd>
                Generated by the server from the inbox file or ingestion
                endpoint.
              </dd>
              <dt>Output</dt>
              <dd>
                Optional <code>outputLink</code> (URL or local path, or null)
              </dd>
              <dt>Classification</dt>
              <dd>
                Optional <code>recordKind</code>, <code>entityKey</code>,{" "}
                <code>metadata</code>
              </dd>
            </dl>
            <h3>Action types</h3>
            <p>
              Use <code>job_application</code>, <code>linkedin_touch</code>,{" "}
              <code>interview</code>, <code>assessment</code>,{" "}
              <code>dental_lead</code>, <code>social_post</code>,{" "}
              <code>output</code>, <code>run</code> or <code>task</code> for the
              corresponding dashboard sections.
            </p>
            <p className="setup-note">
              <Link2 size={16} />
              New agents appear after their first valid record is imported.
              Existing source files are never edited.
            </p>
          </div>
        </Modal>
      )}
      {setup && (
        <Modal title="Optional LLM analysis" close={() => setSetup(false)}>
          <div className="drawer-body setup-content">
            <p>
              Extractive answers and deterministic checks work without an
              API key.
            </p>
            <p>
              To enable model summaries, set <code>OPENAI_API_KEY</code> {hosted ? "in your hosting provider’s server environment, then redeploy the site." : <>in the project’s gitignored <code>.env</code> and restart the local server.</>} Keep the key private; do not paste it into this dashboard.
            </p>
            <p>
              Review the README for model, daily limit and privacy settings.
              Model requests include a bounded selection of recorded evidence.
              Counts continue to come from recorded evidence.
            </p>
            {data?.analysis.configured && (
              <div className="setup-note">
                <Sparkles size={16} />
                <span>
                  {data.analysis.model} · {data.analysis.callsToday} calls today
                  · Daily limit {data.analysis.dailyLimit}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
