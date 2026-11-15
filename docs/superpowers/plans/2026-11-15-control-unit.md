# Control Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A working local agent execution dashboard with Rio imports, grounded analysis and extensible ingestion.

**Architecture:** Loopback Node server owns SQLite, read-only import, aggregation and optional LLM. React consumes the typed same-origin API. Source references and record IDs accompany all metrics.

**Tech Stack:** Node 24, TypeScript, SQLite (node:sqlite), Express, React, Vite, ExcelJS, Vitest.

**Spec:** docs/superpowers/specs/2026-11-15-control-unit-design.md

## Global Constraints
- Never invent data. Missing or unparseable source means "No data recorded" in that section.
- Every number on screen must be traceable to an execution record. The LLM summarizes and flags, it never estimates counts.
- Parsers must tolerate messy markdown and never crash on a bad row.
- Runs fully locally. Dark, dense, single-glance design, newest first.
- Rio's existing files are read-only. No keys in tracked files, logs, browser or account connectors.
- The user requests no questions mid-build; make reasonable choices and document them.

## Review Focus
- Absent or corrupted source files must not crash an import or create fictitious records (Task 1).
- Duplicate entities across workbook/ledger and repeated imports must not inflate totals (Tasks 1–2).
- Missing/ambiguous dates must not become today's events; Pakistan week/day boundaries must be correct (Tasks 1–2).
- Summary claims, broken artifact links and untrusted text must not pass verification or instruct the LLM (Task 2).
- Empty data, invalid API input, local hostile origins and provider errors must produce usable honest UI/API responses (Tasks 2–3).

### Task 1: Read-only importers
**Files:** server/importers.ts, tests/importers.test.ts
**Interfaces:** exports importRio(options?: {home?:string; paths?:Partial<Record<SourceKind,string>>; now?:Date}):Promise<ImportResult>, importInbox(directory:string, now?:Date):Promise<ImportResult>. Types from shared/types.ts. Use actionTypes job_application, linkedin_touch, interview, assessment, dental_lead, social_post, summary, run, task. metadata common keys company/person/role/stage/waitingOn/waitingFor/platform/blockedSince/updatedAt. No store dependency.
- [x] Write tests for messy tables/bullets, generated XLSX, unknown dates, all missing paths, read-only hash, repeated IDs and dedup source overlap; run and observe failures.
- [x] Implement imports, row diagnostics and stable normalized records without source writes; run tests.
- [x] Review correctness and document parser limitations.

### Task 2: Durable store, metrics, API and analysis
**Files:** server/model.ts, store.ts, dashboard.ts, analysis.ts, config.ts, app.ts, index.ts, cli.ts; tests/core.test.ts, api.test.ts, analysis.test.ts
**Interfaces:** shared/types.ts is the frontend contract. GET /api/dashboard -> DashboardData; POST /api/import -> ImportResult summary; POST /api/executions -> accepted IDs; POST /api/digest -> AnalysisResponse; POST /api/ask {question} -> AnalysisResponse; GET /api/records/:id -> ExecutionRecord. Server runs on 127.0.0.1:4310 with Vite middleware in dev and dist in production.
- [x] Write failing tests for validation, SQLite persistence/idempotency, exact KPI IDs, current entity dedup, local date windows, 3-day threshold and success claims without outputs.
- [x] Implement models/store/aggregation, preserving unknowns and source reports; run tests.
- [x] Write failing API/analysis tests for ingestion, cross-origin rejection, missing key, invalid citation/provider failures and prompt injection boundaries.
- [x] Implement HTTP boundaries and optional bounded/cached OpenAI calls; run tests. Wire startup, interval imports and CLI.

### Task 3: Dashboard interface
**Files:** src/main.tsx, src/App.tsx, src/styles.css, src/components/* (optional).
**Interfaces:** DashboardData and AnalysisResponse; same-origin endpoints in Task 2. Read shared/types.ts for exact fields. Frontend never invents records, computes counts for display or receives secret values.
- [x] Build a deliberate dense dark dashboard with all requested sections and explicit empty/error/loading states.
- [x] Make navigation, search, filters, refresh, metric provenance drawer, source list, digest and chat functional.
- [x] Verify responsive behavior, keyboard/focus semantics and production TypeScript/build.

### Task 4: Integration, review and delivery
**Files:** README.md, .env.example, docs/*; integration fixes in owned files as needed.
- [x] Document run/import/link schema, timezone/dedup/date semantics, source overrides, key location/cap, trust boundary and local hosting.
- [x] Run full suite, production build, real-path CLI import and API/browser smoke checks. Fixtures must never populate the live dashboard.
- [x] Have an independent reviewer check record integrity and security; fix material findings, rerun affected tests and full suite/build.
- [x] Record completion and evidence, clearly state real files and LLM key were unavailable for live integration testing.
