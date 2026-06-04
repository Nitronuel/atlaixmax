# Atlaix Max

Fresh Atlaix codebase. Safe Scan is the first rebuilt surface.

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Add `INSIGHTX_API_KEY` to `.env` before running live scans. The browser never receives that key. The Vite app talks to the local API, and the API talks to InsightX.

## Current Scope

- Safe Scan page with the current Atlaix layout and styling
- InsightX API gateway split into client, validation, cache, routes, and report service
- Endpoint status handling for unsupported, missing, rate-limited, and unconfigured responses
- DexScreener liquidity lookup from the browser for public token-pair data
- Tests for validation, report fan-out, and Safe Scan data normalization

## Commands

```bash
npm run dev
npm run build
npm test
```

## Environment

Use server-only keys without a `VITE_` prefix:

```bash
INSIGHTX_API_KEY=
INSIGHTX_API_BASE_URL=https://api.insightx.network
API_PORT=3101
```

Keep provider secrets out of frontend code, commits, screenshots, and logs.
