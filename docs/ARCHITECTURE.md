# ERCOT market monitoring architecture

## Free initial deployment

Official ERCOT Public API reports and public dashboard feeds, plus NOAA/NWS weather, are collected by Python. No paid API, hosted database, chart library, AI service, font service, or hosting subscription is required. GitHub Actions on this public repository performs hourly best-effort collection. GitHub Pages serves the exported Next.js/TypeScript/React site.

The project deliberately separates collection from publication. `PUBLISH_CADENCE` is a GitHub repository variable accepting `daily` (default), `weekly`, `hourly`, or `manual`. The **Collect and publish market monitor** workflow can also be run manually with **publish** enabled. Daily publication is once per UTC calendar day; weekly publication is at least seven days after the last successful edition. Actions schedules can be delayed; this is a monitoring/research pipeline, not a real-time trading feed.

Recurring collection is gated by `ERCOT_AUTOMATION_ENABLED=true`, set after the repository's encrypted ERCOT secrets are configured. The separate **Publish saved market snapshot** workflow deploys the bootstrap edition without collecting new data or transferring credentials.

## Storage and access

* `ercot-market-monitoring`: source code and a bootstrap public edition.
* `archive/pre-market-monitoring`: original prototype preserved at its original commit.
* `market-data`: daily JSONL observation ledgers, raw gzipped public responses, generated JSON editions and CSV exports. It is a **public data archive**; no credentials or authenticated request headers are included.
* GitHub Pages: HTML, CSS, JavaScript, and curated public files. The browser makes no calls to ERCOT, NOAA, or a database.

SQLite provides relational working storage without purchasing hosting or creating another account. Observations preserve dataset, metric, location, UTC target interval end, native interval minutes, actual/forecast classification, value, units, forecast issue time, source publication time, first collection time, and source. Price, load, renewable, weather, and storage SQL views expose each dataset separately. The working database is restored from the durable daily text ledger on each scheduled run, so changing database binaries do not accumulate in Git history. Repeated collections are idempotent; forecast vintages and corrected actual values remain separate records.

Raw responses have a 30-day retention window. Normalized history is retained indefinitely; the public site exposes approximately eight days of market data, upcoming forecast hours, one daily report edition per day for 90 days, and the latest 24 intraday report editions. Deleted raw files remain recoverable in Git history, so Git storage grows over time. The archive's repository size should be reviewed periodically; move the archive to local PostgreSQL before high-resolution/nodal expansion. GitHub has platform storage limits even on free public repositories.

`DATABASE_URL` optionally mirrors records to PostgreSQL using the same schema. This does **not** provision or purchase a service. Local PostgreSQL is free. `python -m pipeline.migrate_postgres` migrates all existing normalized history. A future Python/FastAPI service can query that database while the public snapshot architecture continues unchanged.

## Verified sources

* DAM: NP4-190-CD / `dam_stlmnt_pnt_prices`, hourly, five hubs.
* RT: NP6-905-CD / `spp_node_zone_hub`, native 15-minute settlement prices, five hubs.
* Load forecasts: NP3-560-CD / `7d_load_fcast_by_fzn`, all recent source-posted vintages.
* Wind: NP4-732-CD / `wpp_hrly_avrg_actl_fcast`, hourly actual/forecast values.
* Solar: NP4-737-CD / `spp_hrly_avrg_actl_fcast`, hourly actual/forecast values.
* Public feeds: `supply-demand`, `system-wide-demand`, `combine-wind-solar`, `energy-storage-resources`, and `fuel-mix` under `https://www.ercot.com/api/1/services/read/dashboards/`.
* NWS: `/points/{lat},{lon}` -> hourly/grid forecasts and station observations. Houston, DFW, Austin, San Antonio, Midland/Odessa, Abilene, Corpus Christi.

ERCOT API calls are paced to stay below approximately 30 requests/minute. API pagination is bounded and follows the live response's field names rather than fixed array column numbers. Connection failures are retried; source errors are shown without logging credentials. Source status describes collection success, not proof of freshness. Every visible reading carries an observation timestamp where available. RT settlement history and weather station observations may lag current conditions.

NWS station wind is not hub-height wind. Cloud forecasts are quantitative NWS grid forecasts, preserved at native span duration and expanded only for chart display. Solar irradiance is not synthesized; an additional free official product can be added when that modeling phase begins.

## Feature definitions

* Net load = load − wind − solar; current values use co-temporal observations.
* Forecast error = actual − forecast for the same delivery interval.
* Prior-day baseline = latest source-posted forecast before 00:00 Central on delivery day. This is **not** the DAM submission cutoff. The chart uses ERCOT's source-designated day-ahead display series only when a timestamped baseline is unavailable; missing issue times remain null.
* RT–DAM = matched RT interval/hour minus containing hourly DAM price. Hourly RT means use the available 15-minute intervals; event flags and report statistics require all four.
* Basis = HB_WEST RT − HB_HOUSTON RT at the same hourly interval. Basis alone does not identify a binding constraint.
* Storage charging is a positive magnitude; net output = discharging − charging.

Exploratory event thresholds: RT–DAM $50/MWh, net load error 3 GW, wind error 2 GW, West–Houston basis $50/MWh, all in absolute value. Missing observations are null and produce gaps, never zeros or invented data.

## Research and backtesting

Historical source-posted forecasts can be backfilled, but their publication time is not proof this project captured them before a historical trade. `collected_at` retains first-seen availability, and raw responses retain source labels. A defensible future backtest must choose an explicit decision cutoff and use only inputs available at that time, with walk-forward validation. Preserve settlement point type and interval semantics when extending from hubs to load zones/resource nodes. Use separate tables for model predictions and simulated battery actions; never replace observations with predictions.

Later additions: Houston DAM price models; forecast battery dispatch with SOC, efficiency, power/energy and degradation limits; RT–DAM models; nodal basis; outages/constraints; and energy/ancillary-service optimization. Delayed disclosures must retain actual publication dates.

## Security and operations

Credentials live only in local ignored `.env` files or GitHub Actions secrets. Automatic OAuth authentication uses the token type validated with this account. Auth responses are never archived. The browser receives only public source observations and derived statistics.

The hourly workflow serializes runs to prevent archive write races. A total source failure preserves the previous public snapshot; partial failures retain usable history and are surfaced. A successful Pages deployment records publication time only after deployment completes, allowing failed publication attempts to retry. Schema changes require a migration plan; future collectors should preserve these provenance fields.

Sources: [ERCOT API](https://developer.ercot.com/applications/pubapi/user-guide/using-api/), [ERCOT data](https://www.ercot.com/gridinfo/index), [NWS API](https://www.weather.gov/documentation/services-web-api), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub workflow schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
