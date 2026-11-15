# Hosted deployment

Control Unit can run locally with SQLite or as a hosted dashboard and API on Vercel or Netlify. Hosted mode uses serverless Node functions and PostgreSQL for durable records. A read-only collector runs on the computer that has Rio's source files and sends a validated snapshot to the hosted site. Deploying the site alone does not connect it to Rio's computer.

## Current automatic deployment

The live Vercel project `qaribiqbals-projects/control-unit` is connected to [the GitHub repository](https://github.com/QaribIqbal/Control-Unit). Pushes to `main` trigger production deployments automatically; other branches may produce Vercel previews. [GitHub Actions CI](../.github/workflows/ci.yml) runs tests and a build on pushes and pull requests. The Vercel deployment starts from the Git push independently of the CI result, so review the check result before merging changes. Server credentials stay in Vercel's environment settings and collector credentials stay in the collector machine's gitignored `.env`.

## 1. Create the database

Create a TLS-enabled PostgreSQL database with a user permitted to create tables and indexes in the target schema. Neon, Supabase, or another standard PostgreSQL provider is suitable. Use the provider's connection URL with certificate/hostname verification available; do not use a connection configured with `sslmode=disable`.

At hosted startup, Control Unit initializes its four `cu_` tables (`cu_records`, `cu_sources`, `cu_analysis_cache`, `cu_usage`). The database role must have the permissions needed to create and use these tables and indexes. The repeatable DDL is also in [`database/schema.sql`](../database/schema.sql). No application tables outside the `cu_` prefix are created.

## 2. Deploy the site

Import this repository into Vercel or Netlify and use the checked-in provider configuration. Both build with `npm run build`, publish `dist`, and route `/api/*` to the Node function. Vercel explicitly installs with `npm ci`; Netlify installs dependencies using the checked-in lockfile and its build settings. Node.js 24 is required. Vercel's `vercel.json` and Netlify's `netlify.toml` define the build and function settings.

Choose the stable canonical HTTPS site origin before configuring authentication, for example `https://control.example.com`. Configure the provider's primary domain and redirect aliases first, then set `APP_ORIGIN` to that exact origin: scheme and hostname, with no path, query or trailing route. Every alias users may visit should redirect to this canonical origin. Preview/deploy URLs are rejected by the origin checks unless you deliberately configure a separate environment with its own exact `APP_ORIGIN` and secrets.

Add these **server-side environment variables** in the provider's project settings. Do not prefix any of them with `VITE_`:

| Variable | Required value |
| --- | --- |
| `CONTROL_UNIT_MODE` | `hosted` |
| `APP_ORIGIN` | Exact canonical HTTPS site origin |
| `DATABASE_URL` | PostgreSQL connection URL; hosted connections require verified TLS |
| `DASHBOARD_PASSWORD` | Operator login password, at least 12 characters (maximum 1024) |
| `SESSION_SECRET` | Random secret, at least 32 characters |
| `INGESTION_TOKEN` | Separate random bearer token, at least 32 characters |

`OPENAI_API_KEY` is optional. `LLM_MODEL` (default `gpt-4.1-mini`) and `LLM_DAILY_CALL_LIMIT` (default `20`, set `0` to disable paid requests) are optional server settings. A missing OpenAI key does not block the dashboard or record ingestion; it disables optional OpenAI analysis.

Enter actual values locally in your provider's server environment UI or in the collector machine's local environment. Never commit real credentials, put them in frontend `VITE_` variables, or paste them into chat. The tracked [`.env.example`](../.env.example) contains empty credential values only. No provider account, database or deployment is created for you by this repository.

After setting variables, redeploy so the serverless functions start with the configured values. An incomplete hosted configuration or unavailable database fails closed and returns a setup/unavailable response. The first valid hosted function initialization creates the `cu_` tables automatically.

## 3. Start the collector on Rio's computer

The collector requires Node.js 24 and this project checkout. On the computer that can read Rio's original files, create a project-root `.env` from `.env.example`, then enter these local values:

```dotenv
CONTROL_UNIT_URL=https://control.example.com
INGESTION_TOKEN=
COLLECTOR_ID=rio-primary
```

Use the exact canonical site origin for `CONTROL_UNIT_URL` and the same ingestion token configured on the hosted server. Choose a stable, unique `COLLECTOR_ID` for this machine; if omitted, the collector derives one from the machine hostname. Configure `RIO_HOME` or the `RIO_*_PATH` overrides as needed for the files on this computer. These paths are read-only. Keep `.env` local and gitignored.

Run a one-time import and sync:

```sh
npm ci
npm run collector
```

For an explicitly started process that syncs every 60 seconds:

```sh
npm run collector:watch
```

Stop the watch process with Ctrl+C. The collector does not install a service, create a scheduled task, or run in the background unless you set that up yourself. It does not need the database URL, dashboard password, session secret, or OpenAI key. Do not put those hosted server secrets on the collector machine.

## What is sent and how it is checked

The collector reads the configured Markdown, Excel and inbox inputs without modifying them. It sends normalized records, their recorded source excerpts, source paths and source-health reports over HTTPS. There is no separate raw-file or output-artifact upload, but a daily-summary record can include the text of its source summary file. The hosted function cannot access the collector's filesystem. Anyone who can see the hosted database can see the synced records and excerpts.

A full collector snapshot is limited to 3 MB and 5,000 records. The snapshot is validated in full before insertion, and replacement is atomic per collector: rejected or failed requests preserve that collector's previous snapshot. Other collectors and records submitted through the executions API are preserved. The custom execution API accepts at most 500 records per request and has a 1 MB request limit.

Hosted refresh reads the latest successful upload; it does not scan Rio's machine. Source freshness is based on each source's `importedAt` time from the collector. If the checked source paths are absent on the collector machine, the dashboard correctly shows missing sources and no data. The specified real Rio sources were absent on this Mac when checked November 15, 2026; run the collector on the computer where the real files are available or provide a read-only mount and configure its paths. The app never invents records to fill gaps.

Output verification on a hosted site cannot inspect local artifact paths because the hosted server has no allowed local filesystem roots. A URL alone is not evidence. For a matching `output` record to verify a run, include delivered text in `metadata.content` (within metadata limits); see the evidence rules in the [README](../README.md#output-verification). This content is part of the record sent to the host, so only include content intended for the hosted dashboard.

## Local mode

Local development remains supported and requires no hosted database or sign-in:

```sh
npm ci
npm run dev
```

The local server imports configured source files directly and stores its SQLite database under `data/`. See the [README](../README.md#run) for source paths, local API use, provenance semantics and development checks.

## Provider references

Before deploying, run `npm test`, `npm run build`, and `npm run check:deployment`. The last command bundles both serverless entrypoints locally and checks that local-only dependencies and environment files are absent. A local bundle check does not replace testing the final provider deployment with its real server environment and database.

- [Vercel project configuration](https://vercel.com/docs/project-configuration)
- [Vercel environment variables](https://vercel.com/docs/projects/environment-variables)
- [Netlify build configuration](https://docs.netlify.com/configure-builds/file-based-configuration/)
- [Netlify environment variables](https://docs.netlify.com/build/environment-variables/overview/)
- [Node.js releases](https://nodejs.org/en/about/previous-releases)
