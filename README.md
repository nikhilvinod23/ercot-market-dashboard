# ERCOT Market Monitor

Public ERCOT market research dashboard built with **Next.js / React / TypeScript** and a **Python data pipeline**.

**Public dashboard:** https://nikhilvinod23.github.io/ercot-market-dashboard/

## Views

- Market overview: current demand, hub prices, wind, solar, aligned net load, generation mix, and event journal.
- Prices and basis: five hubs, matched DAM/RT settlement prices, spreads, West-Houston basis, and upcoming DAM curve.
- Forecast monitor: actual versus prior-day load/wind/solar expectations, net load surprises, and seven-day demand outlook.
- Weather: seven Texas locations, NWS observations, hourly temperature/rain forecasts, and quantitative cloud forecasts.
- Storage: charging, discharging, net fleet output, solar, and price context.
- Reports: daily/weekly summaries, coverage counts, dated editions, JSON/CSV/Markdown downloads.
- Data and methods: per-source collection status, timestamps, provenance, and calculation definitions.

## Repository branches

- `archive/pre-market-monitoring`: original interface and Node API prototype, preserved unchanged.
- `main`: historical original default branch, unchanged by this build.
- `ercot-market-monitoring`: new source and the default branch for scheduled workflows.
- `market-data`: public normalized observation ledger and raw public source responses. The working SQLite database is rebuilt from daily JSONL files; database binaries do not accumulate in Git.

## Automatic publication

Collection runs hourly at minute 17, on a best-effort GitHub Actions schedule. Publication defaults to once per UTC day. Change the repository variable **PUBLISH_CADENCE** to `weekly`, `hourly`, or `manual` if desired. Open **Actions -> Collect and publish market monitor -> Run workflow** and leave **publish** enabled for an immediate edition.

Source collection continues even when public publication is weekly or manual, preserving forecasts needed for future models. The reload button only reloads the saved public edition.

## Free resources

Only free official ERCOT and NOAA/NWS sources are used. GitHub Pages and the public-repository Actions workflow require no paid hosting. There are no paid data, AI, chart, font, database, or analytics services. Platform capacity limits still apply; monitor repository size as the archive grows. No paid service is provisioned.

## Credentials

The following **GitHub Actions secrets** are used only by the collector:

- `ERCOT_SUBSCRIPTION_KEY`
- `ERCOT_USERNAME`
- `ERCOT_PASSWORD`

Tokens are acquired automatically each run. They are never saved in public files. A local `.env` can contain the same names; `.env` files are ignored by Git.

After configuring these secrets, set the repository variable `ERCOT_AUTOMATION_ENABLED` to `true` to enable the recurring schedule. This gate keeps scheduled authenticated collection paused until credential setup is approved. **Publish saved market snapshot** can publish the verified bootstrap edition without transferring any credentials.

`DATABASE_URL` is optional. It mirrors records to PostgreSQL you control; no database account is required for the initial dashboard. Local PostgreSQL is free. Do not place credentials in repository variables, browser configuration, or public data.

## Run locally

```sh
npm ci
python -m pip install -r requirements.txt
python -m pipeline.collect --env /path/to/.env
npm run dev
```

Open http://localhost:3000. For a production GitHub Pages export:

```sh
NEXT_PUBLIC_BASE_PATH=/ercot-market-dashboard npm run build
```

The output is `out/`. All public fetches and assets respect the repository subpath.

To restore existing history, check out `market-data` into a separate `state/` folder and run `python -m pipeline.state restore`. To migrate existing normalized observations to PostgreSQL, configure `DATABASE_URL` and run `python -m pipeline.migrate_postgres`.

## Validate

```sh
python -m unittest discover -s tests -v
npm run typecheck
npm run build
npm audit
```

Tests cover physical DST intervals, missing-value handling, RT/DAM interval matching, incomplete-hour treatment, forecast vintages, and failed-publication retention.

## Interpretation

Prices are settlement point prices, not SCED LMPs. RT reports are at native 15-minute resolution; DAM is hourly. Completed-hour event flags use four RT intervals. Forecast baselines are the latest published forecasts before the delivery day starts, not the DAM bid cutoff. Historical posted forecasts are distinguished from the time this project first collected them. Source-designated day-ahead series with unavailable issue timestamps are explicitly retained separately.

Data gaps remain missing, forecasts are never substituted for actuals, and observed timestamps are shown. Current net load uses aligned observations. Storage is aggregate telemetry, not individual battery state of charge. This is a research/monitoring foundation; forecasting, backtesting, and battery optimization are later modules.

See [full architecture and methodology](docs/ARCHITECTURE.md).
