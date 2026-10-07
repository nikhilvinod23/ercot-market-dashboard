# Interface decisions

Updated October 6, 2026.

The dashboard is an analytical workspace: demand and forecast comparison lead the overview, with prices and generation alongside them. Controls change the data directly; values use tabular numerals. Color distinguishes chart series and signed deviations rather than decorating metric cards.

| Before | After | Why |
| --- | --- | --- |
| Slogans and repeated metric descriptions | Labels, units, timestamps, and essential limitations | Keep attention on observations |
| Gradient cards and decorative circles | Solid panels with small shadows | Reduce visual noise; honor the requested depth |
| Identical chart tiles | Wider demand and net-load charts on large screens | Give the main comparisons priority |
| CSS marks and fuel bars | React-generated SVG logo, icons, marks, charts, and signed fuel bars | Keep graphics in JavaScript and tied to actual values |
| Long report paragraphs restating metrics | Metrics plus coverage counts | Preserve the context needed to compare editions |
| Repeated methodological copy | Sources page with expandable definitions | Keep technical detail available without crowding charts |

No chart entrance animations or delayed filter transitions. Press feedback is immediate; reduced-motion preferences disable movement. Native selects, focus outlines, chart tables, missing-value gaps, and source timestamps remain available. Layout, typography, and box shadows remain CSS; graphical marks are SVG created by JavaScript components.

## Recent guidance

- [Rhubarb: How to Build a Dashboard That Does Not Look Like a Generic Dashboard](https://rhubarbviz.com/learn/build-a-dashboard-that-doesnt-look-like-a-dashboard), updated August 20, 2026. Applied hierarchy, reduced interface chrome, and disclosure of longer methods. This is a vendor-authored design perspective, not independent usability research.
- [Laith Junaidy / uxskill: Why AI dashboards all look the same, and the density fix](https://uxskill.laithjunaidy.com/blog/ai-dashboard-design-generic.html), May 29, 2026. Applied tighter spacing and restrained decorative color. The user's requested small shadows take precedence over the author's recommendation to remove card shadows.
- [Emil Kowalski's design engineering skill](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng). Installed from the author's repository. Applied immediate interaction feedback, reduced-motion support, and avoiding decorative animation on frequently used data controls.

## Verification

Production export and TypeScript checks; existing pipeline calculation tests; browser checks of navigation, hub and city selection, report editions, chart tables, and narrow-screen overflow. Publishing the UI uses the saved snapshot and does not require transmitting ERCOT credentials.
