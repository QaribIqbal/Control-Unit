# Control Unit

An operations dashboard for AI agents with **local and hosted** operating modes. Rio's Markdown and Excel logs are imported read-only into a common execution ledger. Every business metric links to its contributing records and original source references. No sample records are loaded into the application.

Use local mode to keep the dashboard and source files on one machine, or deploy the dashboard to Vercel or Netlify and run the read-only collector on the machine that has Rio's files. A hosted site by itself cannot access files on your computer. See the [hosted deployment guide](docs/deployment.md) for setup and the data boundary.

## Run

Requires **Node.js 24** (built-in SQLite) and npm. From this project directory:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4310**. The API and Vite frontend share one local server. Imports run at startup, every 60 seconds, and when you choose **Refresh sources**. The browser reloads dashboard data periodically. Stop with Ctrl+C.

For the production build, still running entirely locally:

```sh
npm run build
npm start
```

To import without opening the dashboard:

```sh
npm run import
```

SQLite lives in `data/control-unit.sqlite`; the inbox defaults to project-root `inbox/`. Both are gitignored. The importer never edits, creates, moves or deletes Rio's source files or submitted inbox files. The server only creates its own database and inbox directory. Removing an import file removes its current imported records on refresh; API-ingested records persist. Source imports are current read-only projections, not a historical backup of deleted source rows. Stop the app before backing up the SQLite file (or include its WAL/SHM files with a SQLite-aware backup).

## Rio sources

By default, `~` means this Mac's user home:

| Source | Default path |
| --- | --- |
| Applications | `~/workspace/job-hunt-2026-10-10/applied-log.md` |
| Opportunity ledger | `~/workspace/job-hunt-2026-10-10/OPPORTUNITY-LEDGER.md` |
| Opportunity workbook | `~/workspace/job-hunt-2026-10-10/opportunity-tracker.xlsx` |
| LinkedIn | `~/.claude/linkedin/log.md`, plus explicit outreach in the applications log |
| Dental | `~/workspace/metamuse/MetaMuse-Operating-Kit/brain/strategy/cash-track/log.md` |
| Social | `~/workspace/content-crew/deliveries/*/PLAN.md` |
| Daily memory | `~/memory/YYYY-MM-DD.md` |

**Availability checked November 15, 2026:** none of the specified real files/pattern matches existed on this Mac. The CLI and dashboard correctly report missing sources and “No data recorded.” Real-file parsing cannot be certified until those files are available. Tests use separate temporary fixtures, including actual generated XLSX archives; they never populate the live dashboard. There is no fallback to made-up data.

If Rio runs under another home or machine, place/mount a read-only copy locally and set `RIO_HOME` to that directory. For example a home containing `workspace/`, `memory/` and `.claude/` works as-is. Alternatively use the individual `RIO_*_PATH` overrides in `.env.example`. This app does not connect to Rio's remote filesystem or any account connector. Never point `DATA_DIR` or `INBOX_DIR` at Rio's source directories.

The importers recognize Markdown tables with flexible headers, dated sections and common explicit activity bullets; Excel sheets use the first recognizable company/person header. Each malformed row is skipped with source diagnostics rather than aborting the import. Unrecognized prose is not guessed into structured activities. Daily memory and aggregate prose remain summary records; “sent 50 messages” does not become 50 invented people. Invalid/ambiguous or absent event dates stay unknown. Source health exposes missing files, parse errors, skipped rows and date warnings. See [importer details](docs/importer-notes.md).

## Link another agent

New agents appear after their first valid record. Use either a local drop file or the ingestion endpoint, in the same format:

```json
{
  "id": "agent-supplied-unique-event-id",
  "agent": "Researcher",
  "timestamp": "2026-11-15T10:30:00+05:00",
  "actionType": "task",
  "target": "Weekly research report",
  "detail": "Waiting for source material",
  "status": "blocked",
  "outputLink": null,
  "entityKey": "task:weekly-research",
  "metadata": {
    "waitingOn": "Project owner",
    "waitingFor": "Research brief",
    "blockedSince": "2026-11-15"
  }
}
```

This is a schema example, not live execution data. Required fields are `agent`, `timestamp`, `actionType`, `target`, `detail`, `status`. `timestamp` is an ISO timestamp **with seconds and timezone**, an ISO calendar date, or `null` when unknown. Do not substitute the import time. `outputLink` is optional/null. Supported statuses: `success`, `failed`, `blocked`, `pending`, `in_progress`, `planned`, `published`, `unknown`.

Optional `id` provides idempotency; scope it uniquely within an agent and reuse it on retries. IDs are internally hashed with the agent name; the original ID is kept as `metadata.externalId`. Without an ID, exact payloads get stable derived IDs. `entityKey` links changing states of the same opportunity/lead/task; use the same key across those updates. `recordKind` defaults to `execution`, with `snapshot` for current state and `summary` for aggregate narrative. `metadata` values must be bounded strings, numbers, booleans or null. Useful metadata: `company`, `person`, `role`, `stage`, `platform`, `touchType`, `eventId`, `waitingOn`, `waitingFor`, `updatedAt`, `blockedSince`.

Business KPI action types are `job_application`, `linkedin_touch`, `interview`, `assessment`, `dental_lead`, `social_post`. `run`, `task`, `output` and `summary` support general agents. Custom simple action identifiers are accepted by the HTTP API and appear in the ledger, without silently counting toward unrelated business metrics. Source references are assigned by the server/importer; caller-supplied provenance is ignored.

### Drop files

Save an object, array of objects, or `{ "records": [...] }` as `inbox/your-agent.json`, or one object per line in `inbox/your-agent.jsonl`. Choose **Refresh sources** or wait for the next import. Invalid rows are reported separately. Files are read-only. Keep files in the inbox while you want them represented; the inbox projection is refreshed from current files.

### HTTP ingestion

Send a JSON record or an array (up to 500) to `POST http://127.0.0.1:4310/api/executions`. Requests are limited to 1 MB, validated in full before insertion, and idempotent for stable IDs. No business actions or outreach are executed by this endpoint.

Optional `INGESTION_TOKEN` in the server environment requires `Authorization: Bearer <token>` from the agent. Read the token from your local secret store/environment inside your agent code; do not paste it into a literal command, shared config or chat. If unset, local processes can ingest without a token. The server binds only to loopback and rejects nonlocal Host and foreign Origin requests. Do not expose it through a public tunnel as if it had production multi-user authentication.

## Metrics and evidence

- Click any KPI, daily histogram bar, pipeline stage, record or citation to inspect contributing record IDs and exact file/line or worksheet/row evidence.
- **Roles tracked** counts distinct company-and-role entities, including entries that are not submissions. **Clean submissions** counts individual application-log rows whose recorded status explicitly says submitted or an equivalent application state; its filter shows those same rows, including repeated roles. The count is unavailable until the current collector has synced the source with its status cells. The historical daily and weekly application activity charts use their existing broader event classification and are not clean-submission counts.
- LinkedIn volume uses individual completed **execution** records; pipeline snapshots do not become new executions. No matching completed records means “No data recorded,” not an assumed zero. A known total with no events in the requested day/week legitimately displays zero with an empty contributor set.
- Distinct explicit event IDs are retained. Without IDs, matching normalized assertions across source files are paired as overlap; distinct source-row occurrences are retained. Different text is not silently merged. Provide explicit IDs for reliable repeated-touch accounting across heterogeneous logs.
- Interview/assessment/dental/social views use latest recorded state per entity. Opportunity stage changes replace older assessment/interview state sharing the same entity; progressed assessments stop counting as pending. Use distinct entity keys if an assessment is genuinely an independent parallel obligation. `metadata.updatedAt` orders state updates; actual instants, not lexical timestamp strings, determine chronology. Unknown dates cannot assert freshness or days waiting.
- Calendar windows use `TIMEZONE` (default `Asia/Karachi`), with Monday-based weeks. Undated records contribute to all-time execution totals but not today/this-week counts. Stale means an open item's last explicit movement date is at least three calendar days ago; closed/failed items are excluded. Unknown responsibility stays “Not recorded.”
- Dental stage counts count unique lead entities. Social planned is current planned/pending/in-progress/blocked work; published is explicitly `published` this week per platform. Pipeline and social numbers reflect recorded state, not assumptions about external systems.

### Output verification

Reported success is **unverified** until a readable, nonempty local artifact is present under an allowed output root, or a matching `output` record supplies delivered content/a readable artifact. A log assertion or URL alone does not prove an output. URLs are never fetched. Successful calls with missing evidence stay red, even if the action may really have occurred. This validates evidence presence, not that a remote employer/LinkedIn/clinic actually received something.

For a future agent, submit a `run` with an explicit ID and an `output` with `metadata.runId` set to that run's original ID (or returned internal ID), from the **same agent**. Include the delivered text in `metadata.content` or a local artifact in `outputLink`. An output record without content/artifact cannot clear a run. Keep embedded content under the metadata string limit. Allowed local artifact roots are Rio's `workspace/`, `memory/`, `.claude/linkedin/` and Control Unit's data directory. Symlinks are resolved and checked against those roots; arbitrary files are not served to the browser.

## Optional LLM analysis

The platform works without a key: stale checks, output verification, exact metrics, extractive daily digest and record search all run locally. To enable the optional OpenAI analysis, copy `.env.example` to project-root `.env`, enter `OPENAI_API_KEY` **locally in your editor**, and restart. `.env` is gitignored; no real credential is shipped or stored in the browser, shared account connector, AGENTS.md or a global configuration file.

Default model: `gpt-4.1-mini`, configurable with `LLM_MODEL`. Requests use OpenAI's [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), `store: false`, strict structured output and no external tools. The model sees a bounded set of execution extracts **only when you request a digest or answer**. This sends selected log content to OpenAI; leave the key unset to keep all analysis local. Source files themselves stay local. Provider data handling still applies; `store:false` is not a promise of zero provider retention.

To enforce grounded output, the model selects/ranks existing record IDs. The server rejects unknown citations and renders displayed facts directly from those selected records. Arbitrary model-written prose/counts are not displayed. Digests use deterministic exact counts plus model-selected salient record extracts. This deliberately favors verifiable answers over unrestricted generative chat. Ask “who did Rio contact on LinkedIn this week?” or “what failed today?”; agent/category/status/time filters run in code. This is not unrestricted SQL or a guarantee that arbitrary natural-language questions can be interpreted.

LLM context is limited to the newest 160 matching records and 1,000 detail characters per record; at most 12 selected records are displayed with citations. The UI discloses bounded scope. Matching counts come from the full locally filtered set, never the model. Identical requests against unchanged records are cached. The default `LLM_DAILY_CALL_LIMIT=20` counts attempted requests, including failures; set `0` to disable paid calls. No automatic paid refreshes. This is a call cap, not a dollar-denominated spending guarantee. Provider/invalid-citation failures fall back to labeled local extracts without leaking provider error bodies or keys.

## Development checks

```sh
npm test
npm run build
npm audit
```

Tests cover SQLite persistence/idempotency; missing/corrupt sources and messy rows; generated XLSX; read-only hashes; unknown dates; overlap and snapshots; Pakistan day/week windows; stale/closed pipelines; output claim failures; local API validation and hostile origins; citation validation, no-key fallback and LLM call limits. Live OpenAI testing requires your key and is not performed by this delivery.

The lockfile pins installed dependencies. ExcelJS's unused legacy UUID dependency is overridden to compatible UUID 11.1.1+ to avoid its known older-version advisory.

## Hosted deployment

Vercel and Netlify configurations are included. Hosted mode serves the dashboard and API through serverless functions and stores durable data in PostgreSQL. A collector you explicitly run on Rio's machine reads the configured sources and sends normalized records, recorded excerpts, paths and source-health reports to the hosted site over HTTPS. It does not upload whole source files or artifacts. The hosted server cannot read local artifact paths, so output verification requires embedded delivered content in `metadata.content`.

The live deployment is [Control Unit](https://control-unit-iota.vercel.app), backed by a hosted PostgreSQL database. The code is at [QaribIqbal/Control-Unit](https://github.com/QaribIqbal/Control-Unit). Follow [Rio's handoff](docs/RIO-HANDOFF.md) for the collector on his machine or [docs/deployment.md](docs/deployment.md) for general provider setup. Hosted login uses a 12-hour secure session cookie; collector sync uses a separate bearer token. Vercel Authentication is disabled for this project so the collector can reach the ingestion API.

The sources checked on this Mac on November 15, 2026 were absent, so the dashboard reports no source data until the collector runs on a machine where those files exist. Missing data is never replaced with invented records. A missing OpenAI key does not prevent records from appearing; it only disables optional OpenAI analysis.
