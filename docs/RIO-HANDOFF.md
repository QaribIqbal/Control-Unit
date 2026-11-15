# Control Unit: instructions for Rio

The dashboard is deployed at https://control-unit-iota.vercel.app. Obtain the ingestion token separately from the owner. Never paste tokens into chat or commit them. The site currently has Vercel Authentication enabled; an automated collector needs an authorized access path before it can sync.

On the machine with Rio's files, obtain the Control Unit project directory, install Node.js 24, and run `npm ci`. Create the project-root `.env` from `.env.example`; set `CONTROL_UNIT_URL` to the deployed HTTPS origin, `INGESTION_TOKEN` to the separately supplied secret, and `COLLECTOR_ID=rio-primary`. The `.env` is gitignored. Set `RIO_HOME` or the documented `RIO_*_PATH` overrides if needed. Do not configure database credentials, dashboard password, session secret, or the OpenAI key on the collector.

Run `npm run collector` once. To keep syncing while the process runs, use `npm run collector:watch`. Do not install a background service unless the owner requests one. The collector reads source files without modifying them, sends normalized records and source excerpts securely, and reports missing or skipped inputs. Confirm the sync by checking source health in the dashboard. Do not invent data to fill missing sources.

Sources: `~/workspace/job-hunt-2026-10-10/applied-log.md`, `OPPORTUNITY-LEDGER.md`, `opportunity-tracker.xlsx`; `~/.claude/linkedin/log.md`; `~/workspace/metamuse/MetaMuse-Operating-Kit/brain/strategy/cash-track/log.md`; `~/workspace/content-crew/deliveries/*/PLAN.md`; `~/memory/YYYY-MM-DD.md`.

The hosted database stores the synchronized records, source paths and excerpts. Snapshot limit: 3 MB and 5,000 records. Successful sync replaces only this collector's snapshot. Missing sources must remain reported missing. A remote URL or local path alone cannot verify an output on the hosted server; include delivered content in a matching `output` record's `metadata.content` when appropriate.

Future agents can submit records to `POST /api/executions` on the deployed origin with `Authorization: Bearer <INGESTION_TOKEN>` read from their local environment. Required fields: `agent`, `timestamp` (ISO date/timestamp or null), `actionType`, `target`, `detail`, `status`; optional stable `id`, `outputLink`, `entityKey`, `recordKind`, and primitive `metadata`. See the project README and `docs/deployment.md` for the complete schema and provenance rules. Do not submit sample data as real executions.
