# Hosted Control Unit amendment

The user clarified that deployment will be Netlify or Vercel. This supersedes the local-only hosting constraint while retaining read-only source handling, traceability, grounded analysis and local development. Earlier local implementation is retained as an operating mode. The user has requested autonomous decisions without mid-build questions.

## Chosen architecture
Host React static assets and the same API in serverless Node functions on either platform. Persist records, source health, analysis cache and daily quota in managed PostgreSQL. A local collector reads Rio's original files and inbox, then atomically replaces its own hosted projection with authenticated HTTPS POST /api/sync. No hosted function imports local source paths or uses its temporary filesystem as durable storage.

Compared with exposing a local server through a tunnel, this removes a permanent inbound connection requirement. Compared with host-specific blob storage, PostgreSQL permits the same code and atomic transactions on either host. Database provisioning/provider choice is left to deployment; any TLS-enabled PostgreSQL endpoint compatible with pg is supported. No cloud resources, connectors or credentials are created by this code change.

## Public boundary
Hosted mode requires APP_ORIGIN (canonical HTTPS URL), DATABASE_URL, DASHBOARD_PASSWORD, SESSION_SECRET and INGESTION_TOKEN. All record/dashboard/analysis endpoints require an HttpOnly Secure SameSite=Strict signed cookie. Login exchanges the operator password for a time-limited cookie. Collector sync and execution ingestion require the separate bearer token. Same-origin/Host checks bind browser requests to APP_ORIGIN; tokens never enter frontend bundles. Missing hosted configuration fails closed. Local mode retains loopback guards and no sign-in requirement.

## Sync and integrity
POST /api/sync accepts a validated collectorId, normalized records and source reports. It preserves source provenance as data but never opens source paths on the hosted server. Max sync payload is 3 MB and 5,000 records: collector validates before sending, failure retains previous projection. Each replacement is one transaction scoped to collector origin; API records and other collectors survive. Submitted IDs are scoped to collector to avoid collisions. A missing source is represented as missing with zero records, never a fictitious row. Requests use HTTPS and a bearer token from device-local environment/.env; the collector does not run unless explicitly invoked.

## Evidence
Server-side hosted verification has no local artifact roots. Local paths and external URLs remain unverified unless an actual matching output record contains delivered content. Do not upload whole artifacts or secrets automatically. Only normalized records and their recorded excerpts/source diagnostics are synchronized. Hosted dashboard shows collector freshness from source importedAt, not browser refresh time. Refreshing hosted data never claims to scan Rio's files.

## Delivery
Vercel and Netlify function/config adapters; portable Postgres store and migration SQL; read-only collector CLI (once/watch); authenticated hosted API and sign-in UI; deployment README. Test SQL behavior against a real embedded PostgreSQL engine, API auth/origin/fail-closed boundaries and collector no-partial-sync/source-provenance behavior. Build platform bundles locally. Actual remote deployment/database connection remains dependent on user-provided resources; do not claim it occurred.
