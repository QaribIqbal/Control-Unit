# Control Unit: instructions for Rio

The dashboard is deployed at https://control-unit-iota.vercel.app. The project code is at https://github.com/QaribIqbal/Control-Unit. Vercel Authentication has been disabled for this project, so collector requests reach the dashboard's ingestion token check. Never paste tokens into chat or commit them.

On the machine with Rio's files, clone the repository, install Node.js 24, and run `npm ci`. Put the separately supplied collector-only `.env` attachment in the project root untouched. It contains `CONTROL_UNIT_URL`, `INGESTION_TOKEN`, and `COLLECTOR_ID=rio-primary` only. The `.env` is gitignored. Set `RIO_HOME` or the documented `RIO_*_PATH` overrides if needed. Do not configure database credentials, dashboard password, session secret, or the OpenAI key on the collector.

Run `npm run collector` once. To keep syncing while the process runs, use `npm run collector:watch`. Do not install a background service unless the owner requests one. The collector reads source files without modifying them, sends normalized records and source excerpts securely, and reports missing or skipped inputs. Confirm the sync by checking source health in the dashboard. Do not invent data to fill missing sources.

Sources: `~/workspace/job-hunt-2026-10-10/applied-log.md`, `OPPORTUNITY-LEDGER.md`, `opportunity-tracker.xlsx`; `~/.claude/linkedin/log.md`; `~/workspace/metamuse/MetaMuse-Operating-Kit/brain/strategy/cash-track/log.md`; `~/workspace/content-crew/deliveries/*/PLAN.md`; `~/memory/YYYY-MM-DD.md`.

The hosted database stores the synchronized records, source paths and excerpts. Snapshot limit: 3 MB and 5,000 records. Successful sync replaces only this collector's snapshot. Missing sources must remain reported missing. A remote URL or local path alone cannot verify an output on the hosted server; include delivered content in a matching `output` record's `metadata.content` when appropriate.

Future agents can submit records to `POST /api/executions` on the deployed origin with `Authorization: Bearer <INGESTION_TOKEN>` read from their local environment. Required fields: `agent`, `timestamp` (ISO date/timestamp or null), `actionType`, `target`, `detail`, `status`; optional stable `id`, `outputLink`, `entityKey`, `recordKind`, and primitive `metadata`. See the project README and `docs/deployment.md` for the complete schema and provenance rules. Do not submit sample data as real executions.
