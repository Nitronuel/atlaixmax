# Atlaix Max

Atlaix Max token intelligence dashboard.

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev
```

Add provider keys to `.env` before running live scans or wallet tracking. The browser never receives those keys. The Vite app talks to the local API, and the API talks to the data providers.

## Current Scope

- Safe Scan page with the current Atlaix layout and styling
- Bubblemaps API gateway split into client, validation, cache, routes, and report service
- Endpoint status handling for unsupported, missing, rate-limited, and unconfigured responses
- DexScreener liquidity lookup from the browser for public token-pair data
- Zerion-powered wallet tracking with holdings, activity, PnL, trade history, and wallet activity alerts
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
BUBBLEMAPS_API_KEY=
BUBBLEMAPS_API_BASE_URL=https://api.bubblemaps.io
ZERION_API_KEY=
ZERION_WEBHOOK_CALLBACK_URL=
ZERION_TX_SUBSCRIPTION_ID=
ZERION_WEBHOOK_SKIP_SIGNATURE=false
API_PORT=3101
```

Keep provider secrets out of frontend code, commits, screenshots, and logs.
