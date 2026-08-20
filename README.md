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

Open `index.html` in a browser. No build step or package installation is required.
