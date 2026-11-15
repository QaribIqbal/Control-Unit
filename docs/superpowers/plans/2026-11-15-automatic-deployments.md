# Automatic Deployments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Deploy pushes to `main` automatically and validate changes in GitHub Actions.

**Architecture:** Vercel's native Git integration watches the repository. GitHub Actions runs dependency, test, and build checks without cloud secrets.

**Tech Stack:** Vercel, GitHub Actions, Node.js 24.

**Spec:** `docs/superpowers/specs/2026-11-15-automatic-deployments-design.md`

## Tasks

- [x] Connect the Vercel project to `QaribIqbal/Control-Unit` and verify `main` is its production branch.
- [x] Add `.github/workflows/ci.yml` with `npm ci`, `npm test`, and `npm run build` on pushes and pull requests.
- [x] Document the automatic deployment path and secret boundary.
- [x] Run local checks, push to `main`, confirm the GitHub check and Vercel deployment for that commit, and probe the live API.
