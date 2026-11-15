import { useState } from "react";
import { Activity, ArrowUpRight, Bot, ShieldCheck, ChevronDown, ChevronRight, Database, LoaderCircle, MessageSquare, Plus, RefreshCw, Search, Send, Sparkles } from "lucide-react";
import type { AnalysisResponse } from "../../shared/types";
import type { PageProps } from "../ui";
import { groupFlags } from "../detail";
import { AnalysisResult, Chip, Empty, Kpi, PageHeader, Panel, Sources, Status, formatDate } from "../ui";

export interface AgentsProps extends PageProps {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  onLink: () => void;
  onSetup: () => void;
  refresh: () => void;
  refreshing: boolean;
}

export function Agents({ data, open, timezone, hosted, api, onLink, onSetup, refresh, refreshing }: AgentsProps) {
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [visible, setVisible] = useState(12);
  const [digest, setDigest] = useState<AnalysisResponse | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [answers, setAnswers] = useState<{ question: string; result: AnalysisResponse }[]>([]);

  const needle = query.toLowerCase().trim();
  const filtered = data.records
    .filter((r) => (agentFilter === "all" || r.agent === agentFilter) && (!needle || [r.agent, r.target, r.detail, r.actionType, r.status, ...Object.values(r.metadata)].join(" ").toLowerCase().includes(needle)))
    .sort((a, b) => (b.timestamp ? Date.parse(b.timestamp) : -Infinity) - (a.timestamp ? Date.parse(a.timestamp) : -Infinity));
  const flagGroups = groupFlags(data);
  const failed = data.agents.reduce((n, a) => n + a.failed.length, 0);
  const blocked = data.agents.reduce((n, a) => n + a.blocked.length, 0);
  const bad = data.sources.filter((s) => s.status === "error").length;
  const missing = data.sources.filter((s) => s.status === "missing").length;
  const ok = data.sources.filter((s) => s.status === "ok").length;

  async function generateDigest() {
    setDigestLoading(true); setDigestError("");
    try { setDigest(await api<AnalysisResponse>("/api/digest", { method: "POST" })); }
    catch (cause) { setDigestError(cause instanceof Error ? cause.message : "Digest could not load"); }
    finally { setDigestLoading(false); }
  }
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    const asked = question.trim(); setAsking(true); setAskError("");
    try {
      const result = await api<AnalysisResponse>("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: asked }) });
      setAnswers((previous) => [...previous, { question: asked, result }]); setQuestion("");
    } catch (cause) { setAskError(cause instanceof Error ? cause.message : "Answer could not load"); }
    finally { setAsking(false); }
  }

  return (
    <>
      <PageHeader title="Agents" subtitle="Who ran, what they produced, and whether the sources are healthy.">
        <button className="button" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spinning" : ""} />{hosted ? "Refresh dashboard" : "Check sources"}</button>
        <button className="button" onClick={onLink}><Plus size={15} />Link agent</button>
      </PageHeader>
      <div className="tile-row">
        <Kpi label="Agents" value={data.agents.length || null} />
        <Kpi label="Failed records" value={data.agents.length ? failed : null} tone={failed ? "alert" : "ok"} />
        <Kpi label="Blocked records" value={data.agents.length ? blocked : null} tone={blocked ? "warn" : "ok"} />
        <Kpi label="Unverified success" value={data.agents.length ? data.verification.length : null} tone={data.verification.length ? "warn" : "ok"} onClick={data.verification.length ? () => open(data.verification.map((v) => v.recordId), "Unverified success") : undefined} />
      </div>

      <Panel title="Verification flags" icon={<ShieldCheck size={17} />} aside={<span className="head-note">Success claims without a matching delivered output</span>}>
        {flagGroups.length ? (
          <div className="flag-groups">
            {flagGroups.map((g) => (
              <div key={g.agent} className="flag-group">
                <span className="flag-agent"><Bot size={16} />{g.agent}</span>
                {g.high.length > 0 && <button className="sev sev-high" onClick={() => open(g.high, `${g.agent} · Output claims without evidence`)}><strong>{g.high.length}</strong> output claims</button>}
                {g.low.length > 0 && <button className="sev sev-low" onClick={() => open(g.low, `${g.agent} · Log assertions without output`)}><strong>{g.low.length}</strong> log assertions</button>}
              </div>
            ))}
          </div>
        ) : <Empty>No unverified success claims.</Empty>}
      </Panel>

      <Panel title="Source health" icon={<Database size={17} />} aside={<span className="chip-row">{ok > 0 && <Chip tone="ok">{ok} synced</Chip>}{missing > 0 && <Chip tone="warn">{missing} missing</Chip>}{bad > 0 && <Chip tone="alert">{bad} errors</Chip>}</span>}>
        <Sources sources={data.sources} />
      </Panel>

      <Panel title="Linked agents" icon={<Bot size={17} />}>
        {data.agents.length ? (
          <div className="agents-list">
            {data.agents.map((agent) => (
              <article className="agent-row" key={agent.name}>
                <div className="agent-row-top">
                  <span className="agent-avatar"><Bot size={21} /></span>
                  <div>
                    <button className="text-button agent-name" onClick={() => open(agent.recordIds, `${agent.name} · Recorded work`)}>{agent.name}<ArrowUpRight size={13} /></button>
                    <small>Last run: {formatDate(agent.lastRun, timezone)}</small>
                  </div>
                </div>
                <div className="agent-output">
                  <span>Latest output</span>
                  {agent.latestOutput ? <button className="text-button" onClick={() => open([agent.latestOutput!.id], "Latest recorded output")}>{agent.latestOutput.target || agent.latestOutput.detail}<ArrowUpRight size={14} /></button> : <span className="quiet">No data recorded</span>}
                </div>
                <div className="agent-counts">
                  {agent.recordIds.length ? <>
                    <button onClick={() => open(agent.failed, `${agent.name} · Failed records`)}><span className={agent.failed.length ? "red-text" : ""}>{agent.failed.length}</span> failed</button>
                    <button onClick={() => open(agent.blocked, `${agent.name} · Blocked records`)}><span className={agent.blocked.length ? "amber-text" : ""}>{agent.blocked.length}</span> blocked</button>
                  </> : <span className="quiet">No data recorded</span>}
                </div>
              </article>
            ))}
          </div>
        ) : <Empty>{hosted ? "Link an agent or sync an existing source with the collector." : "Link an agent or import an existing source."}</Empty>}
      </Panel>

      <Panel title="Activity ledger" icon={<Activity size={17} />} aside={<span className="quiet head-note">Newest first</span>}>
        <div className="activity-controls">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(12); }} placeholder="Search actions, targets or details" aria-label="Search activity" /></label>
          <label className="agent-select"><span className="sr-only">Filter by agent</span>
            <select value={agentFilter} onChange={(e) => { setAgentFilter(e.target.value); setVisible(12); }}>
              <option value="all">All agents</option>
              {data.agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div className="activity-list">
            {filtered.slice(0, visible).map((r) => (
              <button className="activity-row" key={r.id} onClick={() => open([r.id], "Record evidence")}>
                <span className={`activity-marker ${r.status}`}><Activity size={15} /></span>
                <span className="activity-content">
                  <span className="activity-title">{r.target || r.actionType.replaceAll("_", " ")}<Status value={r.status} /></span>
                  <span className="activity-description">{(r.detail || r.actionType.replaceAll("_", " ")).slice(0, 240)}</span>
                  <span className="activity-meta"><span>{r.agent}</span><span>{r.recordKind}</span><span>{formatDate(r.timestamp, timezone)}</span></span>
                </span>
                <ChevronRight className="row-arrow" size={16} />
              </button>
            ))}
            {filtered.length > visible && <button className="load-more" onClick={() => setVisible((v) => v + 12)}>Show more activity<ChevronDown size={15} /></button>}
          </div>
        ) : <Empty>{query || agentFilter !== "all" ? "No records match the current filters." : hosted ? "Sync your collector or link an agent to begin." : "Refresh sources or link an agent to begin."}</Empty>}
      </Panel>

      <div className="split">
        <Panel title="Operations digest" icon={<Sparkles size={17} />} aside={<button className="text-button" disabled={digestLoading} onClick={() => void generateDigest()}>{digestLoading ? "Generating…" : digest ? "Regenerate" : "Generate"}</button>}>
          {digestError && <p className="inline-error" role="alert">{digestError}</p>}
          {digest ? <AnalysisResult result={digest} open={open} /> : <div className="digest-placeholder"><p>A grounded readout of recorded work, blockers and outcomes.</p></div>}
        </Panel>
        <Panel title="Ask your data" icon={<MessageSquare size={17} />} aside={<span className="mode-label">{data.analysis.configured ? "LLM enabled" : "Extractive mode"}</span>}>
          <div className="ask-body">
            {!data.analysis.configured && <p className="analysis-hint">Answers use recorded evidence. <button className="text-button" onClick={onSetup}>Optional LLM setup</button></p>}
            {answers.length ? <div className="answer-history" aria-live="polite">{answers.map((a, i) => <div className="answer-pair" key={i}><h3>{a.question}</h3><AnalysisResult result={a.result} open={open} /></div>)}</div> : <p className="ask-prompt">Ask about applications, outreach, waiting work or an agent’s latest output.</p>}
            <form className="ask-form" onSubmit={(e) => void ask(e)}>
              <label className="sr-only" htmlFor="question">Question about recorded data</label>
              <input id="question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What needs my attention?" maxLength={2000} disabled={asking} />
              <button className="send-button" disabled={asking || !question.trim()} aria-label={asking ? "Getting answer" : "Ask question"}>{asking ? <LoaderCircle size={17} className="spinning" /> : <Send size={17} />}</button>
            </form>
            {askError && <p className="inline-error" role="alert">{askError}</p>}
          </div>
        </Panel>
      </div>
    </>
  );
}
