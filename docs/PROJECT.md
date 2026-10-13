# Single project directory

Canonical project: ERCOT 10 year analysis.
Canonical chat: Create ERCOT dashboard scaffold.
Code folder: ercot-market-dashboard in this project.
Repository: https://github.com/nikhilvinod23/ercot-market-dashboard
Public dashboard: https://nikhilvinod23.github.io/ercot-market-dashboard/

The former published monitor and local geographic dashboard now share one frontend, archive, collector, report system and publication workflow. The Python pipeline and methodology from the published monitor are preserved alongside the local maps, ancillary monitoring and trading/battery tools.

Research context from ERCOT Pricing MVP Model is represented in the architecture and roadmap here: fundamentals and forecast deviations → power price and geographic basis → paper outcomes → constrained storage dispatch. The Energy Modeling conversations contain background discussion; this folder is the implementation source of truth.

The ERCOT Power Market Game is a separate project and application. It is not part of this dashboard.

Old code remains in Git history for recovery. Only the consolidated frontend is built and published. Historical data and report editions remain in the same archive so analysis is reproducible.
