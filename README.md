# ERCOT Market Dashboard

One dashboard, one repository, one public address:
https://nikhilvinod23.github.io/ercot-market-dashboard/

The published market monitor and the local geographic dashboard are consolidated here. Both local and public modes use the same HTML, JavaScript, dark theme and outline icons. The retired Next.js frontend is preserved only in Git history.

## Start locally

Requires Node 18+ and Python 3.12+.

    python -m pip install -r requirements.txt
    node server.js

Open http://127.0.0.1:8000. The server refreshes market feeds every minute and starts the Python archive collector on launch and hourly thereafter. Set ARCHIVE_COLLECTOR=off to disable local collection, or PYTHON_EXECUTABLE to select Python.

Copy .env.example to .env and set ERCOT_SUBSCRIPTION_KEY, ERCOT_USERNAME and ERCOT_PASSWORD. Tokens renew automatically; no hourly manual copying is required. Credentials never enter the browser or the public archive.

## Dashboard views

Overview; Prices & geography; Demand & forecasts; Forecast monitor; Weather; Generation & storage; Ancillary services; Fuel & resource prices; Trading & battery; Reports & archive; Data health.

Includes precise chart hover, keyboard inspection, expandable chart tables, maps with persistent time sliders, previous-day comparisons, matched DAM/RT prices, geographic basis, upcoming DAM curves, load/wind/solar/net-load forecast errors, seven-day demand forecasts, event journal, NOAA weather and cloud/rain forecasts, resource locations, aggregate battery activity, ancillary capacity and prices, energy dispatch replay and paper settlement calculations.

Daily and weekly report summaries show data coverage. Dated reports, market JSON, hourly CSV and Markdown downloads remain available. Historical report files are records of past data; they use the same dashboard edition.

## Collection and publication

Python orchestrates official-source ingestion and the Node map/ancillary adapter, stores original responses and observations in archive/market.sqlite, and generates public/data/. Source-posted forecast issue time, first collection time and corrections are preserved. The portable daily JSONL ledger remains on market-data; database binaries are excluded from Git. Existing observation history is retained.

The hourly GitHub Actions workflow collects and publishes this same dashboard. Existing ERCOT repository secrets are used. ERCOT_AUTOMATION_ENABLED=true enables its schedule. Manual runs of Collect and publish ERCOT dashboard also collect and publish. GitHub Pages serves saved observations: the page displays the publication and source times and reloads the newest saved snapshot every minute. Local mode also refreshes live feeds. GitHub's scheduler can delay runs.

Run the collector explicitly with:

    python -m pipeline.collect --history-days 7
    node build.js

dist/ contains the complete static site. No hosting service beyond the existing GitHub Pages site is provisioned.

## Restore and preserve history

    python -m pipeline.state restore --state /path/to/market-data
    python -m pipeline.state save --state /path/to/market-data

The workflow also preserves supplemental map captures and resource mappings. Normalized observations retain all collected history; raw responses retain 30 days, local chart series 30 days, and nodal maps 7 days. Collection pauses when neither the local server nor GitHub workflow is running. PostgreSQL mirroring is optional through DATABASE_URL.

## Price by generation source and gas economics

The Fuel & resource prices view groups resource-node DAM prices by resource type using the official 60-day DAM disclosure. It displays the median of unique nodes, with equal node weight. The report is delayed: the collector allows 62 days for publication.

Twelve node samples (two per supported type) are selected from verified disclosure mappings. Their current DAM and RT histories are collected directly from ERCOT. Raw resource codes and mapping dates are shown. The sample is not a whole-fleet price or realized revenue.

ERCOT electricity settlement prices depend on location, time and market, rather than a separate clearing price per technology. A node's published price can apply even when its generator is off. Offered prices, production costs, settlement prices, generation-weighted capture prices and profit are different measures. Plant generation-weighted capture prices require aligned plant output that is not inferred here.

Henry Hub daily spot price comes from EIA and uses dollars per MMBtu. EIA monthly US LNG export prices use dollars per thousand cubic feet (Mcf); export volumes use million cubic feet. The LNG series is a monthly cargo average, not traded JKM or TTF. Units and dates remain distinct.

Gas economics uses an entered heat rate and variable cost to estimate Henry Hub fuel cost and spark spread. Exact-date matching leaves unavailable gas dates as gaps. The estimate excludes local gas basis, transport, starts, emissions and plant-specific operating costs.

Correlations use matched observations and show sample counts: daily gas versus hub power with 0/1/7-day lags, plus monthly gas versus LNG price/volume. Daily power averages need at least 20 complete hours; at least five pairs and nonzero variance are required for a coefficient. Correlation is descriptive and does not establish causation.

## Map and modeling boundaries

Regional actual load is a delayed daily report. Hub markers overlay weather-zone boundaries without treating those boundaries as price-zone boundaries. Nodal maps use official SCED LMP image coordinates and prices; LMP differs from settlement point price. Map scales remain fixed across the loaded timeline.

EIA plant inventory covers Texas, including facilities outside ERCOT. Inventory period, capacity and coordinates appear on hover. Resource membership, plant-to-node mapping and per-plant live generation are not guessed.

Weather shows Open-Meteo models and previous runs against nearby NOAA station temperatures, plus the archived NWS hourly/cloud/rain forecasts. Nearby airport observations and model grid points have geographic differences.

Battery replay uses perfect hindsight, collected 15-minute prices, 2.5% SOC resolution, power/energy/efficiency limits, discharge cost and equal initial/terminal SOC. It excludes ancillary co-optimization, capital, tariffs and execution risk. No trades are executed.

## Verification and source ownership

    python -m unittest discover -s tests -v
    node --test analytics.test.js
    node --check app.js
    node --check extensions.js

Work is validated on codex/ercot-api-validation. The consolidated publication source is ercot-market-monitoring. Main and archival branches preserve earlier history; they do not create additional deployed dashboards.

Canonical Codex project: ERCOT 10 year analysis.
Canonical chat: Create ERCOT dashboard scaffold.
See docs/ARCHITECTURE.md and docs/PROJECT.md.

## Responsive charts, updates and prediction markets

Generation includes a signed stacked chart: positive output stacks above zero and battery charging below it. Chart axes fit their containers; tap or use arrow keys for exact values. Narrow screens use wrapping metric cards, touch-sized controls, scrolling tables and responsive maps. Chart tables are built only when expanded.

The public site checks a lightweight publication manifest each minute while visible and downloads the larger datasets only when publication changes. The collector targets minutes 23 and 53, but GitHub cron can be delayed. Data health shows publication/source times and a collector workflow link. See [operations and scaling](docs/OPERATIONS.md) for an independent scheduler, archival storage, database partitions, bounded payloads and history queries.

Demand prediction market tracks public Kalshi KXTXERCOTPEAKD quotes, threshold volumes, open interest, quoted sizes, captured bid/ask trends and settled peaks. Quote performance begins when this collector starts observing and is measured only for subsequently settled markets. Contract-day parsing uses the rule text rather than the next-day ticker. The scenario calculator uses series fee metadata and executable best-ask size; it makes no trades. No account key is needed for the public data. Strict intraday tracking needs a continuously available collector and more frequent snapshots than the Pages publication cadence.
