# ERCOT Market Dashboard

Local dependency-free web app. Start with `node server.js` and open http://127.0.0.1:8000. Node 18+ required. Run tests with `node --test analytics.test.js`.

## Credentials

Copy .env.example to .env. Set ERCOT_SUBSCRIPTION_KEY, ERCOT_USERNAME and ERCOT_PASSWORD. Authentication renews automatically. Credentials stay server-side; .env is never committed.

## Views

Overview; Prices & geography; Demand & forecasts; Weather; Generation & storage; Ancillary services; Trading & battery; Data health.

Hover charts for precise readings. Maps have timestamp sliders and fixed color scales over the loaded period. Chart dates use the operating-day selector; report and weather maps display their independently available source dates. Overview cards always display latest readings.

## Data and limitations

- Live ERCOT public feeds: RT settlement prices, measured system demand, hourly actual/forecast demand, generation mix, fleet battery dispatch, reserves and ancillary capacity.
- Authenticated ERCOT reports: delayed weather-zone actual demand, DAM/RT ancillary capacity prices, DAM quantities sold, constraints and previous-day hub-average prices. Reports are sequentially fetched with spacing and a 15-minute refresh to limit throttling.
- Nodal map: official ERCOT SCED LMP image coordinates and published prices. Nodal LMP differs from 15-minute settlement prices. Hub-price markers overlay weather-zone boundaries; they are not regional price polygons.
- Resources: EIA Texas inventory mirror, services2.arcgis.com/FiaPA4ga0iQKduv3 / Power_Plants_in_the_US. Hover shows inventory period (not today's fleet). Texas includes plants outside ERCOT. Per-plant live output, ERCOT membership and plant-to-node mapping are not inferred.
- Weather: Open-Meteo forecasts and prior-day runs; NOAA airport-station temperature observations when available. Grid-point forecasts and nearby station observations differ geographically. Wind and radiation are model forecasts, not measured plant output. Missing observations remain missing.
- Battery replay: retrospective perfect-hindsight energy-only optimizer; 2.5% SOC steps, power/capacity/efficiency constraints, discharge cost and equal starting/terminal SOC. Excludes ancillary co-optimization, capital, tariffs, node basis and execution risk. Collected intervals only; no real trades.
- Paper trading: matched DAM/RT interval settlement P&L, not execution or a revenue forecast.

## Persistence

runtime-data/ stores market history and forecast captures across restarts and is excluded from Git and static serving. Market series retain 30 days; nodal snapshots retain 7 days. Collection runs every minute only while the server runs. There is no historical nodal backfill. Forecast snapshots record capture time, not issuance. Export collected history from the footer.

Failures retain earlier readings with original timestamps, never substitute mock data. Check Data health for publication dates, failures and coverage.

## Routes

/api/market — aggregate cached state and history.
/api/refresh — refresh public feeds.
/api/contour — official map backdrop.
/api/health — configuration/token status; ?probe=1 checks authentication.
Legacy /api/live and authenticated /api/ercot/products, /api/ercot/product and /api/ercot/report remain available.

Work stays on codex/ercot-api-validation. No automatic merge to main.
