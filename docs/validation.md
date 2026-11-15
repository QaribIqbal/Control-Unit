# Delivery validation — November 15, 2026

- Full `npm test`: **67 tests passed**, four test files.
- `npm run build`: TypeScript and Vite production bundle passed.
- `npm audit`: **0 vulnerabilities** after the compatible UUID override.
- Production server started at http://127.0.0.1:4310. Production HTML/assets, dashboard API, read-only refresh, empty digest/ask, and foreign-origin rejection smoke-tested.
- Browser checks: empty states; metric evidence drawer; Escape dismissal and focus restoration; digest; ask-data; source diagnostics. Responsive 375px breakpoint has document/body/main widths of 375px and no horizontal page overflow. Default viewport restored afterward.
- Independent integrity review found event-identity, snapshot-volume, negated-status, pipeline-transition, chronological-ordering and output-evidence issues. Each received regression coverage and fixes. Scoped follow-up review closed all material findings.
- All real Rio paths were checked and unavailable. The actual configured-path import runs successfully with missing-source reports and zero invented records. Real-file integration remains unverified until files exist on this machine/read-only mount.
- Live OpenAI testing was not performed: no API key configured. Tests exercise provider request/selection boundaries with isolated responses, citation rejection, fallback, cache and daily cap; local analysis was checked in the running app.
- Temporary Markdown, JSON and generated XLSX fixtures never populate the production database. Source files are read-only; tests verify hashes before/after import.

See README for explicit local-run, key, source-path, ingestion and semantic limitations.

## Hosted amendment validation

- `npm test`: **102 tests passed** across nine files, including hosted authentication, cookie/bearer separation, transactional PostgreSQL storage, collector snapshots, validation and platform adapters.
- `npm run build` and `npm run check:deployment` passed. Both Netlify and Vercel entrypoints bundle for Node 24 without SQLite/ExcelJS or environment files in the hosted dependency graph.
- The SQL implementation passed PGlite integration tests and an isolated real PostgreSQL 16 driver check, including concurrent quota reservations and snapshot replacement. Temporary cluster was removed.
- Browser testing used an isolated loopback harness with empty in-memory test storage: private login, authenticated dashboard, logout clearing access, and 375px sign-in without horizontal overflow. This is a local simulation, not a provider deployment.
- The real local dashboard now explains missing Rio source files at the top, with a link to inspect paths. Hosted first-sync state explains that Rio's collector is not connected.
- `npm run collector` without a configured site origin exits with a clear configuration error and sends no data. Actual hosted synchronization, provider database TLS connection and public deployment remain pending user resources.
- Remaining implementation and bounded review used lightweight GPT-6 Luna subagents as requested.
