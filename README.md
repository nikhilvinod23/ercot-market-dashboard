# ERCOT Market Pulse

An isolated, dependency-free dashboard interface prototype for tracking the ERCOT market.

## Current scope

- Responsive dashboard shell with market-operations visual language
- Six navigable views: Overview, Prices, Demand & Load, Supply, Reliability, and Congestion & Events
- Summary cards for demand, real-time pricing, renewable share, and available capacity
- Illustrative nodal/hub price board and settlement point detail table
- Illustrative load-vs-forecast, seven-day demand outlook, and weather-zone comparison
- Illustrative generation mix, renewable forecast variance, and storage activity
- Illustrative adequacy, reserve coverage, binding constraints, market notices, and event feed
- Lightweight interactions for view navigation, chart range controls, filters, refresh, and informational toasts

## Important note

This prototype does not connect to ERCOT or any other data source. All values, prices, forecasts, constraints, notices, and alerts are illustrative placeholders intended to establish the interface and information hierarchy. The next implementation phase will require an ERCOT Public API account, subscription key, server-side ingestion, and data normalization.

## Run locally

The project now includes a dependency-free Node backend. Node 18+ is required because the backend uses the built-in `fetch` API.

1. Copy `.env.example` to `.env`.
2. Add your ERCOT subscription key.
3. Add `ERCOT_USERNAME` and `ERCOT_PASSWORD` to enable automatic hourly ID-token renewal. Do not commit `.env`.
4. Start the app with `node server.js`.
5. Open `http://127.0.0.1:8000/`.

Available backend routes:

- `GET /api/health` — configuration and token status without exposing secrets
- `GET /api/ercot/products` — authenticated public-report catalog
- `GET /api/ercot/product?emilId=np6-787-cd` — report metadata and artifact links
- `GET /api/ercot/report?emilId=np6-787-cd` — fetches the first artifact for a report

The browser dashboard still displays illustrative values. The backend is ready for report-specific normalization and UI wiring once credentials are configured.
