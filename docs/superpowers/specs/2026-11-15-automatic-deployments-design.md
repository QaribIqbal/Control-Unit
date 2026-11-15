# Automatic deployments design

## Intent

Keep the live Control Unit site current when code changes are pushed to GitHub, without repeating a manual Vercel CLI deployment.

## Approach

Connect the existing Vercel project directly to `QaribIqbal/Control-Unit`, with `main` as the production branch. Vercel handles builds and deployment from Git. A GitHub Actions workflow runs `npm ci`, tests, and the production build on pushes and pull requests. Existing server environment variables remain in Vercel; no deployment credential is placed in the repository or GitHub Actions.

## Alternatives considered

- A GitHub Actions job using a Vercel token would offer explicit deployment gating, but adds another long-lived credential and more setup.
- A deploy hook would require a secret URL and separate trigger. It adds little value when Vercel can watch the repo directly.

## Verification

Confirm the Vercel project Git link and production branch via Vercel API. Push this workflow to `main`; confirm the GitHub Actions check and a new Vercel deployment for the pushed commit. Verify the live `/api/session` endpoint still responds.
