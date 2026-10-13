# ERCOT Market Pulse

An isolated, dependency-free dashboard for live ERCOT market monitoring.

## Current scope

- Responsive dashboard shell with market-operations visual language
- Six navigable views: Overview, Prices, Demand & Load, Supply, Reliability, and Congestion & Events
- Live summary cards for prices, load forecasts, renewable output, PRC, outages, and storage
- Live hub price curves and settlement-point spread board
- Live current-day load forecast versus day-ahead forecast
- Live generation mix, installed-capacity reference, outages, and storage dispatch
- Live PRC/reliability monitor and location spread monitor
- Automatic refresh every 60 seconds plus manual refresh

## Data boundary

The browser calls the local `/api/live` route. The server fetches and normalizes the public ERCOT dashboard feeds, so credentials and upstream requests remain server-side. The authenticated ERCOT Public API catalog routes remain available for report-specific data products.

## Run locally

The project now includes a dependency-free Node backend. Node 18+ is required because the backend uses the built-in `fetch` API.

1. Copy `.env.example` to `.env`.
2. Add your ERCOT subscription key.
3. Add `ERCOT_USERNAME` and `ERCOT_PASSWORD` to enable automatic hourly ID-token renewal. Do not commit `.env`.
4. Start the app with `node server.js`.
5. Open `http://127.0.0.1:8000/`.

Available backend routes:

- `GET /api/health` — configuration and token status without exposing secrets
- `GET /api/live` — normalized live fuel mix, prices, demand, outages, storage, and PRC data
- `GET /api/ercot/products` — authenticated public-report catalog
- `GET /api/ercot/product?emilId=np6-787-cd` — report metadata and artifact links
- `GET /api/ercot/report?emilId=np6-787-cd` — fetches the first artifact for a report
