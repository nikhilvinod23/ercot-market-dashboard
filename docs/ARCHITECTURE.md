# Consolidated market platform

The same frontend is served locally by Node and publicly by GitHub Pages. Public mode reads relative data/dashboard.json, latest.json, fuels.json and reports.json. Local mode reads /api/market and the same archived feature/report files. The collector is independent of the browser.

## Data path

Python ingestion → SQLite observation ledger → forecast and price alignment → archived features and reports → one dashboard.

The Node supplemental adapter collects nodal map captures, geography, plant inventory, current weather comparisons and ancillary capacity/price reports. Python runs the adapter and archives its observations. Local Node feeds can refresh every minute; the portable archive is updated hourly. The public workflow collects and publishes hourly at minute 17, subject to GitHub schedule availability.

## Observation identity

Each observation records dataset, metric, location, physical interval end, duration, kind, value, unit, issued time, source publication time, first collection time and source. Forecast vintages remain distinct. Repeated unchanged actual observations do not inflate the ledger; later corrections append a new record, including a correction back to a prior value. The publisher selects the latest revision.

All times are stored in UTC and displayed in Central Time. ERCOT repeated-hour flags select the correct physical DST interval. Native RT settlement prices are 15 minutes; DAM prices are hourly. RT hourly means track interval counts; four intervals are required for completed-hour event detection. Native prices are also exported for the geographic dashboard and battery replay.

Forecast expectations use the latest source-posted vintage before delivery-day midnight in Central Time. This is not the DAM bid cutoff. Source-designated day-ahead display forecasts without an issue timestamp remain distinguished from posted vintages. Historical source posting does not imply this project collected that forecast before delivery.

Net load is load minus wind minus solar. All three values must be available at matching observation times. Forecast errors are actual minus the baseline. Missing values remain missing.

## Features and sources

- NP6-905-CD RT and NP4-190-CD DAM hub and selected resource-node prices.
- NP3-560-CD seven-day load outlook; NP4-732-CD wind and NP4-737-CD solar posted forecast vintages and actuals.
- Public ERCOT supply, load, generation, storage, reserves and ancillary dashboards.
- NP6-345-CD delayed actual weather-zone load; NP4-188-CD and NP6-331-CD ancillary capacity prices; NP4-532-CD DAM quantities; NP6-86-CD constraints.
- Official ERCOT nodal LMP map snapshots and embedded weather-zone geometry.
- EIA Texas plant inventory mirror, with source period and unverified ERCOT membership.
- NOAA observations, hourly forecasts, humidity, precipitation probability and grid-span cloud forecasts; Open-Meteo current/prior-run weather models.
- NP3-966-ER delayed DAM resource disclosure gives explicit resource names, types, settlement nodes and prices. Medians deduplicate settlement nodes within a type and interval. Current node samples use that mapping; mapping date and raw codes remain visible.
- EIA Henry Hub daily spot price, monthly US LNG export price and monthly LNG export volume. Public XLS files are parsed with xlrd. Gas and LNG units are not conflated.

## Persistence and deployment

The market-data branch is a data ledger, with daily observations/collections JSONL and compressed original responses. SQLite is rebuilt from the ledger. Supplemental captures and verified resource mappings are restored between workflows. No credentials or authentication responses are archived.

The validation branch incorporates both earlier application histories. ercot-market-monitoring is the sole publication source and default scheduled-workflow branch. There is one frontend and one Pages artifact at the existing repository URL. Earlier frontend implementations remain recoverable through Git history only. Daily report editions remain historical records, not alternative apps.

## Subsequent modeling

The archive supports learning relationships among fundamentals, nodal basis, price spreads and battery dispatch. The current battery replay establishes a constrained hindsight energy baseline. A future predictive dispatch model should use only data available at decision time, add resource-specific limits and ancillary opportunity cost, and compare its realized outcomes against this baseline.

True resource capture prices require aligned metered generation; offered prices and settlement prices should be modeled separately. Henry Hub is an input benchmark. Texas fuel basis, LNG export demand, weather and congestion are potential explanatory variables rather than proof of a causal pricing relationship.
