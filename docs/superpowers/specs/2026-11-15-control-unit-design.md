# Control Unit design

## Intent
Build the user's local, read-only view of agent execution, starting with Rio. Show actual outputs, volume, stakeholder responsibilities, failures, and stale work. The supplied prompt is the authoritative specification. The user explicitly requests no mid-build questions; implementation decisions below are builder choices.

## Approach
Use a React/TypeScript dashboard served by a loopback-only Node 24 server, SQLite for durable normalized records, and tolerant Markdown/Excel importers. Compared with a browser-only app this can read the source paths safely; compared with a hosted server it can access Rio's local files without uploading them. The newer explicit fully-local requirement takes priority over the earlier Vercel/Netlify idea. Document hosting limitations.

## Records and provenance
The common record includes agent, timestamp (null when unknown), actionType, target, detail, status, outputLink, stable id, entityKey, recordKind, metadata, and source path/line or worksheet/row/excerpt. Unknown dates stay unknown, never assigned file modification time. Import summaries as summaries; never turn aggregate prose into fabricated individual activities. Distinguish snapshots of an opportunity/lead/post from individual execution events. Deduplicate by semantic event/entity keys across sources and use latest known state for pipeline counts. Every KPI carries contributing record IDs. UI opens these records and provenance.

## Sources
Read the seven paths/patterns in the supplied prompt without any writes to source directories. RIO_HOME defaults to the OS user's home. Explicit per-source overrides are supported. All requested source paths were checked on 2026-11-15 and were absent on this Mac. Report missing/error/unparseable sources honestly and retain diagnostics. Never silently mark a missing source healthy. Fixtures are test-only and never seed the application database.

## Interface
Dark dense operations dashboard: graphite background #101318, panels #181d24, dividers #2b333e, quiet text #9ba8b8, white #edf2f7, cool blue #8caeff, amber #e8b86d and red #ef8585 for actionable exceptions. System sans for fully offline typography; restrained monospace only for timestamps and source identifiers. Persistent narrow navigation; KPI strip; activity plus attention column; LinkedIn 14-day histogram/table; interview/assessment and dental pipelines; social per-platform totals; agent/source panels. Newest-first records, functional search/agent filters, source drawer, refresh, digest and ask-data. Empty sections say “No data recorded”.

## Analysis
Verification and 3-day stale detection are deterministic and available offline. A success claim needs a concrete matching output record or readable local artifact; a URL alone is an unverified reference, not fetched proof. Summary success claims do not prove outputs. Prefer false-negative verification over a false pass. The optional OpenAI Responses integration uses gpt-4.1-mini (configurable), an environment-only key, no tools, store:false, strict cited record selection, cache and daily call cap. Exact counts and answers without the LLM remain deterministic. Key never sent to browser or logged. Missing key leaves the app useful; no invented AI digest. Retrieved records are untrusted input. Bounded contexts explicitly disclose scope.

## Ingestion and operation
POST /api/executions accepts common records with validation and optional bearer authentication. A local inbox supports JSON/JSONL without modifying submitted files. Stable IDs make repeated imports idempotent. Loopback binding, Host/Origin checks, request size limits, safe artifact checks and no arbitrary file-reading endpoint. Startup import, manual refresh and periodic import. Source and import errors surfaced without crashing the server. SQLite and inbox ignored by git. .env ignored in this same change.

## Deliverables and validation
Platform code, README with run/link/schema/key/path/semantics instructions, import CLI, tests against synthetic messy Markdown and real generated XLSX fixtures, read-only hashes, missing sources, deduplication, provenance, timezone boundaries, stale threshold, verification, ingestion, grounded analysis and app smoke tests. Production build and actual browser inspection. Real-file validation is explicitly pending because sources are unavailable here.
