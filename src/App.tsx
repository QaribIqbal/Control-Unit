import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight, Bot, Check, ChevronRight, CircleAlert, Clock3, Database, GitBranch, LayoutDashboard,
  Link2, LogOut, LoaderCircle, MessageSquare, Plus, RefreshCw, ShieldCheck, TrendingUp, X,
  Briefcase, Stethoscope, Sparkles,
} from "lucide-react";
import type { DashboardData, ExecutionRecord } from "../shared/types";
import { ApiError, request } from "./api";
import { Empty, Modal, RecordDetail, formatDate } from "./ui";
import { MODULES, parseRoute, routeHref, attentionCount, type ModuleId } from "./modules";
import { Overview } from "./pages/Overview";
import { Applications } from "./pages/Applications";
import { Interviews } from "./pages/Interviews";
import { LinkedIn } from "./pages/LinkedIn";
import { Dental } from "./pages/Dental";
import { Social } from "./pages/Social";
import { Agents } from "./pages/Agents";

const moduleIcons: Record<ModuleId, typeof LayoutDashboard> = {
  overview: LayoutDashboard, applications: Briefcase, interviews: GitBranch, linkedin: TrendingUp,
  dental: Stethoscope, social: MessageSquare, agents: Bot,
};

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
  const [route, setRoute] = useState<ModuleId>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const clearProtectedData = useCallback(() => {
    authGeneration.current += 1;
    sessionRequest.current += 1;
    setSessionChecking(false);
    setData(null);
    setExtraRecords({});
    setDrawer(null);
    setLinkModal(false);
    setSetup(false);
    setNotice("");
    setError("");
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
  const hosted = (data?.runtime?.mode || session?.mode) === "hosted";
  const ingestionEndpoint = data?.runtime?.ingestionEndpoint || `${window.location.origin}/api/executions`;
  const timezone = data?.timezone || "Asia/Karachi";
  const hasNoRecords = data?.records.length === 0;
  const nonInboxSources = data?.sources.filter((source) => source.kind !== "inbox") || [];
  const localSourcesUnavailable = Boolean(
    !hosted && nonInboxSources.length &&
    nonInboxSources.every((source) => source.status === "missing" || source.status === "error"),
  );
  const recordById = new Map((data?.records || []).map((record) => [record.id, record]));
  const pageProps = (d: DashboardData) => ({ data: d, open, timezone, hosted });
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
          href="#/overview"
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
          {MODULES.map(({ id, label }) => {
            const Icon = moduleIcons[id];
            return (
              <a key={id} className={route === id ? "active" : ""} href={routeHref(id)} aria-current={route === id ? "page" : undefined}>
                <Icon size={17} />
                <span>{label}</span>
                {id === "overview" && data && attentionCount(data) > 0 && <span className="nav-badge" aria-label={`${attentionCount(data)} need attention`}>{attentionCount(data)}</span>}
                {route === id && <span className="nav-mark" />}
              </a>
            );
          })}
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
            <strong>{MODULES.find((m) => m.id === route)!.label}</strong>
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
            <span className="last-updated">
              {hosted
                ? data?.runtime?.lastSyncAt ? `Collector synced ${formatDate(data.runtime.lastSyncAt, timezone)}` : "Collector sync not recorded"
                : data ? `Checked ${formatDate(data.generatedAt, timezone)}` : "Waiting for local records"}
            </span>
            <button className="button button-small" onClick={() => void refresh()} disabled={refreshing || loading}>
              <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
              {refreshing ? "Refreshing…" : hosted ? "Refresh" : "Refresh sources"}
            </button>
            <span className="local-chip">
              <span className="local-dot" />
              {hosted ? "Private hosted" : "Local server"}
            </span>
          </div>
        </header>
        <div className="main-content">
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
                <a className="text-button" href="#/agents">Inspect source paths <ArrowUpRight size={13} /></a>
              ) : (
                <a className="text-button" href="#/agents">Inspect source reports <ArrowUpRight size={13} /></a>
              )}
            </section>
          )}
          {loading && !data ? (
            <div className="initial-loading" role="status">
              <LoaderCircle size={24} className="spinning" />
              <p>{hosted ? "Reading your hosted workspace…" : "Reading your local workspace…"}</p>
            </div>
          ) : data ? (
            <>
              {route === "overview" && <Overview {...pageProps(data)} />}
              {route === "applications" && <Applications {...pageProps(data)} />}
              {route === "interviews" && <Interviews {...pageProps(data)} />}
              {route === "linkedin" && <LinkedIn {...pageProps(data)} />}
              {route === "dental" && <Dental {...pageProps(data)} />}
              {route === "social" && <Social {...pageProps(data)} />}
              {route === "agents" && <Agents {...pageProps(data)} api={api} onLink={() => setLinkModal(true)} onSetup={() => setSetup(true)} refresh={() => void refresh()} refreshing={refreshing} />}
              <footer className="page-footer">
                <span><ShieldCheck size={14} />{hosted ? "Synced execution evidence. Every result has a trail." : "Read-only source imports. Every result has a trail."}</span>
                <span>{timezone}</span>
              </footer>
            </>
          ) : null}
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
