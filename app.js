(() => {
  const { escape: e, number: n, valid, chart } = UI;
  const isLocal =
    document.querySelector('meta[name="market-mode"]')?.content !==
      "published" &&
    ["127.0.0.1", "localhost", "::1"].includes(location.hostname);
  let data = null,
    view = "overview",
    day = "";
  const views = {
    overview: "Overview",
    prices: "Prices & geography",
    demand: "Demand & forecasts",
    forecasts: "Forecast monitor",
    weather: "Weather",
    resources: "Generation & storage",
    ancillary: "Ancillary services",
    fuels: "Fuel & resource prices",
    predictions: "Demand prediction market",
    analysis: "Trading & battery",
    reports: "Reports & archive",
    health: "Data health",
  };
  const content = document.querySelector("#content");
  const panel = (title, body, note = "", wide = false) =>
    `<section class="panel ${wide ? "wide" : ""}"><div class="panel-head"><h2>${title}</h2><small>${e(note)}</small></div>${body}</section>`;
  const plot = (id) => `<div class="chart" id="${id}"></div>`;
  const table = (heads, rows) =>
    `<div class="table-scroll"><table><thead><tr>${heads.map((h) => "<th>" + e(h) + "</th>").join("")}</tr></thead><tbody>${rows.map((r) => "<tr>" + r.map((v) => "<td>" + e(v) + "</td>").join("") + "</tr>").join("") || "<tr><td>No published data available</td></tr>"}</tbody></table></div>`;
  const series = (k) =>
    (data.series[k] || []).filter((r) => r.timestamp?.slice(0, 10) === day);
  const metric = (label, value, unit, previous, note) =>
    `<div class="metric"><label>${label}</label><strong>${n(value, unit === "$ / MWh" ? 2 : 0)} <small>${unit}</small></strong><small>${e(note || "")}</small><div class="comparison">${valid(previous) ? "Previous day " + n(previous, 2) + " · Δ " + n(value - previous, 2) : "Previous-day comparison unavailable"}</div></div>`;
  const priceLines = [
    { key: "hbHouston", label: "Houston" },
    { key: "hbNorth", label: "North" },
    { key: "hbSouth", label: "South" },
    { key: "hbWest", label: "West" },
  ];
  const report = (k) => data.reports[k]?.rows || [];
  function priceRows() {
    const p = series("prices");
    return p.map((r) => {
      const end = Date.parse(r.timestamp.replace(" ", "T"));
      const hourEnd = (Math.floor((end - 1) / 3600000) + 1) * 3600000;
      const dam = data.series.dam.find(
        (d) => Date.parse(d.timestamp?.replace(" ", "T")) === hourEnd,
      );
      return {
        ...r,
        dam: dam?.hbHubAvg,
        spread: valid(dam?.hbHubAvg) ? r.hbHubAvg - dam.hbHubAvg : null,
      };
    });
  }
  function render() {
    if (!data) return;
    view = location.hash.slice(1).replace("view-", "") || "overview";
    if (!views[view]) view = "overview";
    document.querySelector("#page-title").textContent = views[view];
    document.querySelector("#nav").innerHTML = Object.entries(views)
      .map(
        ([k, v]) =>
          `<a href="#${k}" ${view === k ? 'aria-current="page"' : ""}>${icon(k)}<span>${v}</span></a>`,
      )
      .join("");
    const c = data.current;
    const context = { panel, plot, table, day };
    if (window.Predictions?.render(view, data, context)) return;
    if (Extensions.render(view, data, context)) return;
    if (view === "overview") {
      const prev = report("yesterdayPrices").filter(
        (r) => r.settlementPoint === "HB_HUBAVG",
      );
      const previousPrice = prev.find(
        (r) =>
          +r.deliveryHour ===
            +c.prices?.timestamp.slice(11, 13) +
              (+c.prices?.timestamp.slice(14, 16) > 0 ? 1 : 0) &&
          +r.deliveryInterval ===
            (+c.prices?.timestamp.slice(14, 16) === 0
              ? 4
              : Math.ceil(+c.prices?.timestamp.slice(14, 16) / 15)),
      );
      content.innerHTML = `<div class="metrics">${metric("Hub average · real-time SPP", c.prices?.hbHubAvg, "$ / MWh", previousPrice?.settlementPointPrice, c.prices?.timestamp)}${metric("System demand · measured", c.supply?.actual, "MW", null, c.supply?.timestamp)}${metric("Completed-hour demand", c.demand?.actual, "MW", data.previous.demand?.actual, c.demand?.timestamp)}${metric("Available reserves", c.prc, "MW", null, "Latest ERCOT PRC")}</div><div class="grid">${panel("Hub prices", plot("prices"), "15-minute real-time settlement prices")}${panel("Demand", plot("demand"), "Actual vs day-ahead and updated forecast")}${panel("Generation mix", plot("fuel"), "Measured system output · MW")}${panel(
        "Market snapshot",
        table(
          ["Metric", "Latest"],
          [
            ["Battery net output (MW)", n(c.storage?.net)],
            ["Battery discharge (MW)", n(c.storage?.discharge)],
            ["Battery charging (MW)", n(c.storage?.charge)],
            [
              "Load forecast error (MW)",
              valid(c.demand?.actual) && valid(c.demand?.dayAhead)
                ? n(c.demand.actual - c.demand.dayAhead)
                : "—",
            ],
            [
              "Condition",
              typeof c.condition === "string"
                ? c.condition
                : c.condition?.title || "—",
            ],
          ],
        ),
      )}</div>`;
      const currentRows = data.series.prices.filter(
        (r) =>
          r.timestamp.slice(0, 10) === data.operatingDay && valid(r.hbHubAvg),
      );
      const priorRows = prev.map((r) => ({ value: +r.settlementPointPrice }));
      const stats = (rows) =>
        rows.length
          ? {
              mean:
                rows.reduce((s, r) => s + (r.hbHubAvg ?? r.value), 0) /
                rows.length,
              peak: Math.max(...rows.map((r) => r.hbHubAvg ?? r.value)),
              low: Math.min(...rows.map((r) => r.hbHubAvg ?? r.value)),
            }
          : {};
      const today = stats(currentRows),
        yesterday = stats(priorRows);
      content.insertAdjacentHTML(
        "beforeend",
        panel(
          "Daily comparison",
          table(
            ["Hub average SPP", "Today to latest", "Previous full day"],
            [
              ["Average $/MWh", n(today.mean, 2), n(yesterday.mean, 2)],
              ["High $/MWh", n(today.peak, 2), n(yesterday.peak, 2)],
              ["Low $/MWh", n(today.low, 2), n(yesterday.low, 2)],
              ["15-minute readings", currentRows.length, priorRows.length],
            ],
          ),
          "Partial current day versus completed previous day",
        ),
      );
      chart("prices", series("prices"), priceLines, "$/MWh");
      demandChart();
      fuelChart();
    } else if (view === "prices") {
      content.innerHTML = `<div class="grid">${panel("Real-time hub prices", plot("prices"), "SPP · 15 minutes", true)}${panel("Nodal LMP", '<div id="nodes"></div>', "SCED LMP · captured map history")}${panel("Regional hub prices", '<div id="hubs"></div>', "Hub markers, not regional boundary prices")}${panel(
        "Binding constraints",
        table(
          ["Time", "Constraint", "Shadow $/MW", "Limit", "Flow"],
          report("constraints")
            .filter((r) => +r.shadowPrice > 0)
            .slice(0, 30)
            .map((r) => [
              r.SCEDTimestamp,
              r.constraintName,
              n(r.shadowPrice, 2),
              n(r.limit),
              n(r.value),
            ]),
        ),
        "Published report · may lag",
        true,
      )}</div>`;
      chart("prices", series("prices"), priceLines, "$/MWh");
      Maps.nodal("nodes", data.nodes, data.contourUrl || "/api/contour");
      Maps.regional(
        "hubs",
        data.geometry,
        series("prices").map((r) => ({
          timestamp: r.timestamp,
          values: {
            hou: r.hbHouston,
            north: r.hbNorth,
            south: r.hbSouth,
            west: r.hbWest,
          },
          markers: [
            { name: "Houston", value: r.hbHouston },
            { name: "Dallas", value: r.hbNorth },
            { name: "San Antonio", value: r.hbSouth },
            { name: "Midland", value: r.hbWest },
          ],
        })),
        { unit: "$/MWh", markers: true },
      );
    } else if (view === "demand") {
      const rows = report("regional");
      const frames = rows
        .map((r) => ({
          timestamp:
            (r.operatingDay || r.deliveryDate || "") +
            " HE " +
            (r.hourEnding || r.hour || ""),
          values: {
            north: r.north,
            east: r.east,
            northC: r.northC,
            west: r.west,
            farWest: r.farWest,
            southC: r.southC,
            coast: r.coast,
            southern: r.southern,
          },
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      content.innerHTML = `<div class="grid">${panel("System demand", plot("demand"), "MW · actual and forecast", true)}${panel("Regional demand", '<div id="regions"></div>', "Actual weather-zone load · delayed daily publication")}${panel("Forecast errors", plot("errors"), "Actual minus day-ahead forecast · MW")}${panel(
        "Forecast snapshots",
        table(
          ["Captured", "Current-day hours", "Next-day hours"],
          data.forecastVintages
            .slice(-10)
            .reverse()
            .map((v) => [v.capturedAt, v.series.length, v.nextDay.length]),
        ),
        "Capture time is not forecast issuance time",
        true,
      )}</div>`;
      demandChart();
      chart(
        "errors",
        series("demand").map((r) => ({
          ...r,
          error:
            valid(r.actual) && valid(r.dayAhead) ? r.actual - r.dayAhead : null,
        })),
        [{ key: "error", label: "Day-ahead error" }],
        "MW",
      );
      Maps.regional("regions", data.geometry, frames, { unit: "MW" });
    } else if (view === "weather") {
      content.innerHTML = `<div class="filters"><label>Location <select id="city">${(data.weather?.cities || []).map((c, i) => `<option value="${i}">${e(c.name)}</option>`).join("")}</select></label><label>Map <select id="weather-mode"><option value="temperature">Temperature °F</option><option value="error">Observed − prior-day forecast °F</option><option value="wind">Wind mph</option><option value="solar">Solar radiation W/m²</option></select></label></div><div class="grid">${panel("Weather comparison", plot("weather-chart"), "NOAA station observations vs Open-Meteo forecasts")}${panel("Weather geography", '<div id="weather-map"></div>', "Station temperature error where observations exist")}${panel("Forecast source", table(["Source", "Updated", "Previous run"], [["Open-Meteo", data.weather?.fetchedAt || "Unavailable", data.weather?.previousRunAvailable ? "Available" : "Unavailable"]]), "Temperature · 10m wind · surface radiation", true)}</div>`;
      const redraw = () => {
        const cities = data.weather?.cities || [],
          city = cities[+document.querySelector("#city").value];
        chart(
          "weather-chart",
          city?.series || [],
          [
            { key: "temperature", label: "Current model" },
            {
              key: "previousForecast",
              label: "Prior-day forecast",
              dash: true,
            },
            { key: "observed", label: "NOAA observed" },
          ],
          "°F",
        );
        const mode = document.querySelector("#weather-mode").value;
        Maps.regional(
          "weather-map",
          data.geometry,
          (cities[0]?.series || []).map((r, i) => {
            const markers = cities.map((c) => {
              const v = c.series[i];
              return {
                name: c.name,
                value:
                  mode === "error"
                    ? valid(v?.previousForecast) && valid(v?.observed)
                      ? v.observed - v.previousForecast
                      : null
                    : v?.[mode],
              };
            });
            return {
              timestamp: r.timestamp,
              values: Object.fromEntries(markers.map((m) => [m.name, m.value])),
              markers,
            };
          }),
          {
            markers: true,
            unit: mode === "wind" ? "mph" : mode === "solar" ? "W/m²" : "°F",
          },
        );
      };
      document.querySelector("#city").onchange = redraw;
      document.querySelector("#weather-mode").onchange = redraw;
      redraw();
    } else if (view === "resources") {
      content.innerHTML = `<div class="filters"><label>Resources <select id="resource-filter"><option value="renewables">Wind & solar</option><option value="battery">Batteries</option><option value="all">All generation</option></select></label></div><div class="grid">${panel("Stacked generation", plot("fuel-stack"), "MW · negative storage shows charging · tap to inspect", true)}${panel("Generation locations", '<div id="plants"></div>', "EIA inventory · Texas, not exclusively ERCOT", true)}${panel("Generation mix", plot("fuel"), "System output · MW")}${panel("Battery fleet dispatch", plot("storage"), "Measured aggregate · MW")}</div>`;
      const draw = () => {
        const f = document.querySelector("#resource-filter").value;
        Maps.plants(
          "plants",
          (data.resources?.plants || []).filter((p) =>
            f === "all" || f === "battery"
              ? f === "all" || p.battery > 0
              : p.wind > 0 || p.solar > 0,
          ),
        );
      };
      document.querySelector("#resource-filter").onchange = draw;
      draw();
      fuelChart();
      const fuels = series("fuel"),
        keys = [...new Set(fuels.flatMap((r) => Object.keys(r)))].filter(
          (k) => k !== "timestamp",
        );
      UI.chart(
        "fuel-stack",
        fuels,
        keys.map((key) => ({ key, label: key })),
        "MW",
        { stacked: true },
      );
      chart(
        "storage",
        series("storage"),
        [
          { key: "charge", label: "Charging" },
          { key: "discharge", label: "Discharging" },
          { key: "net", label: "Net output" },
        ],
        "MW",
      );
    } else if (view === "ancillary") {
      const types = ["REGUP", "REGDN", "RRS", "ECRS", "NSPIN"];
      const rt = report("asRt"),
        dam = report("asDam");
      content.innerHTML = `<div class="grid">${panel("Ancillary capacity", plot("as-cap"), "Available / deployed capacity, not energy generation", true)}${panel(
        "Real-time clearing prices",
        table(
          ["Date", "Hour", "Interval", "Service", "$/MW"],
          rt
            .slice()
            .sort(
              (a, b) =>
                String(b.deliveryDate).localeCompare(String(a.deliveryDate)) ||
                b.deliveryHour - a.deliveryHour ||
                b.deliveryInt - a.deliveryInt,
            )
            .slice(0, 40)
            .map((r) => [
              r.deliveryDate,
              r.deliveryHour,
              r.deliveryInt,
              r.ASType,
              n(r.MCPC, 2),
            ]),
        ),
        "Published RT capacity prices",
      )}${panel(
        "Day-ahead clearing prices",
        table(
          ["Date", "Hour", "Service", "$/MW"],
          dam
            .slice(0, 40)
            .map((r) => [
              r.deliveryDate,
              r.hourEnding,
              r.ancillaryType,
              n(r.MCPC, 2),
            ]),
        ),
        "Capacity awards are distinct from deployment",
      )}${panel(
        "Ancillary procurement",
        table(
          Object.keys(report("asSold")[0] || {}),
          report("asSold")
            .slice(0, 24)
            .map((r) => Object.values(r)),
        ),
        "DAM services sold · published awards",
        true,
      )}</div>`;
      chart(
        "as-cap",
        series("ancillary"),
        [
          { key: "rrs", label: "RRS" },
          { key: "ecrs", label: "ECRS" },
          { key: "nsrs", label: "Non-spin" },
          { key: "undeployedRegUp", label: "Undeployed Reg Up" },
          { key: "deployedRegUp", label: "Deployed Reg Up" },
        ],
        "MW",
      );
    } else if (view === "analysis") {
      content.innerHTML = `<div class="grid">${panel(
        "Battery energy replay",
        `<form id="battery-form"><div class="form-grid">${[
          ["power", "Power MW", 100],
          ["energy", "Energy MWh", 200],
          ["efficiency", "Round-trip efficiency %", 88],
          ["initial", "Initial SOC %", 50],
          ["degradation", "Discharge cost $/MWh", 5],
        ]
          .map(
            ([id, label, v]) =>
              `<label>${label}<input name="${id}" type="number" step="any" value="${v}" required></label>`,
          )
          .join(
            "",
          )}<label>Hub<select name="hub">${priceLines.map((l) => `<option value="${l.key}">${l.label}</option>`).join("")}</select></label></div><button>Run replay</button></form><div id="battery-results"></div>`,
        "Hindsight optimization · energy only, no ancillary revenue",
        true,
      )}${panel("Real-time versus day-ahead", plot("spread"), "Hub average · $/MWh")}${panel("Paper trading", `<form id="trade-form"><div class="form-grid"><label>Side<select name="side"><option value="buy">Buy DAM / sell RT</option><option value="sell">Sell DAM / buy RT</option></select></label><label>MW<input name="mw" type="number" value="10" min="0" step="any"></label><label>Fee $/MWh<input name="fee" type="number" value="0" min="0" step="any"></label></div><button>Replay matched intervals</button></form><div id="trade-results"></div>`, "Illustrative settlement P&L · excludes credit and execution")}</div>`;
      chart(
        "spread",
        priceRows(),
        [
          { key: "hbHubAvg", label: "RT" },
          { key: "dam", label: "DAM" },
          { key: "spread", label: "RT − DAM" },
        ],
        "$/MWh",
      );
      document.querySelector("#battery-form").onsubmit = (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        const rows = series("prices")
          .filter((r) => valid(r[f.hub]))
          .map((r) => ({
            timestamp: r.timestamp,
            price: r[f.hub],
            hours: 0.25,
          }));
        const target = document.querySelector("#battery-results");
        try {
          if (!rows.length) throw Error("No price intervals for this day.");
          const result = Analytics.batteryOptimize(rows, {
            power: +f.power,
            energy: +f.energy,
            efficiency: +f.efficiency / 100,
            initial: +f.initial,
            degradation: +f.degradation,
          });
          target.innerHTML = `<div class="summary-row">Net energy value $${n(result.profit, 2)} · charged ${n(result.charged, 1)} MWh · discharged ${n(result.discharged, 1)} MWh · terminal SOC ${n(result.initialSoc, 1)}%</div><small>Collected intervals only; missing intervals omitted. SOC resolution 2.5%. Same initial and terminal SOC. Excludes capital, tariffs, ancillary services and node basis.</small>${plot("dispatch")}${plot("soc")}`;
          chart(
            "dispatch",
            result.schedule,
            [{ key: "mw", label: "Dispatch (+ discharge)" }],
            "MW",
          );
          chart(
            "soc",
            result.schedule,
            [{ key: "soc", label: "State of charge" }],
            "%",
          );
        } catch (err) {
          target.textContent = err.message;
        }
      };
      document.querySelector("#trade-form").onsubmit = (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        const rows = priceRows().filter((r) => valid(r.dam));
        const pnl = rows.reduce(
          (sum, r) =>
            sum +
            Analytics.paperPnl({
              ...f,
              mw: +f.mw,
              fee: +f.fee,
              rt: r.hbHubAvg,
              dam: r.dam,
            }),
          0,
        );
        document.querySelector("#trade-results").textContent = rows.length
          ? `P&L $${n(pnl, 2)} · ${rows.length} matched 15-minute intervals`
          : "No matched DAM and RT intervals available.";
      };
    } else {
      content.innerHTML =
        panel(
          "Source status",
          table(
            ["Feed", "Status", "Source timestamp", "Fetched", "Issue"],
            Object.entries(data.sources).map(([k, s]) => [
              k,
              s.ok ? "Available" : "Error",
              s.lastUpdated || "—",
              s.fetchedAt || "—",
              s.error || "",
            ]),
          ),
          "",
          true,
        ) +
        panel(
          "Report status",
          table(
            ["Report", "Status", "Fetched", "Rows", "Issue"],
            Object.entries(data.reports).map(([k, s]) => [
              k,
              s.ok ? "Available" : "Error",
              s.fetchedAt || "—",
              s.rows?.length || 0,
              s.error || "",
            ]),
          ),
          "Report publication times differ",
        ) +
        panel(
          "Collection",
          table(
            ["Item", "Status"],
            [
              ["Market history begins", data.historyStarted || "Pending"],
              ["Price history retention", "30 days local"],
              [
                "Nodal history retention",
                "7 days local; capture begins when app runs",
              ],
              ["Weather", data.weather?.measurement || "Unavailable"],
              ["Resource inventory", data.resources?.scope || "Unavailable"],
              [
                "Battery optimization",
                "Retrospective energy-only model; not a revenue forecast",
              ],
            ],
          ),
        );
    }
    Extensions.enhance(view, data, context);
  }
  function mergeArchive() {
    const hubs = {
      HB_HOUSTON: "hbHouston",
      HB_NORTH: "hbNorth",
      HB_WEST: "hbWest",
      HB_SOUTH: "hbSouth",
      HB_BUSAVG: "hbBusAvg",
    };
    const prices = new Map(),
      dam = new Map();
    for (const r of data.monitor?.native_prices || []) {
      const timestamp = Extensions.stamp(r.time),
        map = r.market === "RT" ? prices : dam,
        key = hubs[r.hub];
      if (!key) continue;
      const row = map.get(timestamp) || { timestamp };
      row[key] = r.value;
      row.hourEnding = +timestamp.slice(11, 13);
      map.set(timestamp, row);
    }
    for (const r of data.series.prices) {
      prices.set(r.timestamp, { ...prices.get(r.timestamp), ...r });
    }
    for (const r of data.series.dam) {
      dam.set(r.timestamp, { ...dam.get(r.timestamp), ...r });
    }
    data.series.prices = [...prices.values()].sort(
      (a, b) =>
        Date.parse(a.timestamp.replace(" ", "T")) -
        Date.parse(b.timestamp.replace(" ", "T")),
    );
    data.series.dam = [...dam.values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const demand = new Map(),
      fuel = new Map(),
      storage = new Map();
    for (const h of data.monitor?.hours || []) {
      const timestamp = Extensions.stamp(h.time);
      demand.set(timestamp, {
        timestamp,
        actual: h.load,
        dayAhead: h.load_forecast,
        forecast: h.load_outlook,
      });
    }
    for (const r of data.monitor?.native_generation || []) {
      const timestamp = Extensions.stamp(r.time),
        row = fuel.get(timestamp) || { timestamp };
      row[r.fuel] = r.value;
      fuel.set(timestamp, row);
    }
    for (const r of data.monitor?.storage || []) {
      const timestamp = Extensions.stamp(r.time);
      storage.set(timestamp, {
        timestamp,
        charge: valid(r.charging) ? -r.charging : null,
        discharge: r.discharging,
        net: r.net_storage,
      });
    }
    for (const [key, map] of [
      ["demand", demand],
      ["fuel", fuel],
      ["storage", storage],
    ]) {
      for (const r of data.series[key])
        map.set(r.timestamp, { ...map.get(r.timestamp), ...r });
      data.series[key] = [...map.values()].sort(
        (a, b) =>
          Date.parse(a.timestamp.replace(" ", "T")) -
          Date.parse(b.timestamp.replace(" ", "T")),
      );
    }
    data.days = [
      ...new Set(data.series.prices.map((r) => r.timestamp.slice(0, 10))),
    ].reverse();
  }
  function demandChart() {
    chart(
      "demand",
      series("demand"),
      [
        { key: "actual", label: "Actual" },
        { key: "dayAhead", label: "Day-ahead", dash: true },
        { key: "forecast", label: "Updated forecast", dash: true },
      ],
      "MW",
    );
  }
  function fuelChart() {
    if (view === "overview") {
      UI.fuelBars("fuel", data.current.fuel);
      return;
    }
    chart(
      "fuel",
      series("fuel"),
      [
        "Natural Gas",
        "Wind",
        "Solar",
        "Nuclear",
        "Coal and Lignite",
        "Power Storage",
      ].map((key) => ({ key, label: key })),
      "MW",
    );
  }
  let loading = false,
    publicationRevision = null;
  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    const retained = Array.from(
      document.querySelectorAll(
        "#city,#weather-mode,#resource-filter,#archive-hub,#nws-city,#node-pick,#heat-rate,#gas-vom,#gas-hub,.map-controls input",
      ),
    ).map((el) => ({
      selector: el.id ? "#" + el.id : "#" + el.closest("[id]").id + " input",
      value: el.value,
      kind: el.tagName,
    }));
    const button = document.querySelector("#refresh");
    button.disabled = true;
    try {
      let status = null;
      if (!isLocal) {
        status = await fetch("data/status.json", { cache: "no-cache" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (
          data &&
          !refresh &&
          status?.revision &&
          status.revision === publicationRevision
        ) {
          freshness();
          return;
        }
      }
      data = await DataClient.json(
        isLocal
          ? refresh
            ? "/api/refresh"
            : "/api/market"
          : "data/dashboard.json",
      );
      await Extensions.load(data);
      publicationRevision = status?.revision || null;
      mergeArchive();
      const days = data.days.length
        ? data.days
        : [
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Chicago",
            }).format(new Date()),
          ];
      if (!day || !days.includes(day)) day = days[0];
      document.querySelector("#day").innerHTML = days
        .map((d) => `<option ${d === day ? "selected" : ""}>${d}</option>`)
        .join("");
      document.querySelector("#as-of").textContent =
        (isLocal
          ? "Live · latest price "
          : "Published " +
            Extensions.stamp(data.publishedAt) +
            " · latest price ") +
        (data.current.prices?.timestamp || "pending") +
        " · Central Time";
      document.querySelector("#history-status").textContent =
        n(data.monitor?.archive_records) +
        " archived observations · " +
        (isLocal ? "hourly Python collector" : "Python archive · publication target 30 minutes");
      const failed = Object.entries(data.sources).filter(([k, v]) => !v.ok);
      document.querySelector("#feed-status").textContent = failed.length
        ? `${failed.length} feeds unavailable`
        : isLocal
          ? "Live market feeds"
          : "Published market snapshot";
      const notice = document.querySelector("#notice");
      notice.hidden = !failed.length;
      notice.textContent = failed.length
        ? "Unavailable feeds: " +
          failed.map(([k]) => k).join(", ") +
          ". Retained readings keep their source timestamps."
        : "";
      const priceAge =
        Date.now() -
        Date.parse(data.current.prices?.timestamp?.replace(" ", "T"));
      if (priceAge > 90 * 60000) {
        notice.hidden = false;
        notice.textContent +=
          " Latest price reading is " +
          n(priceAge / 3600000, 1) +
          " hours old.";
      }
      if (!isLocal && Date.now() - Date.parse(data.publishedAt) > 3 * 3600000) {
        notice.hidden = false;
        notice.textContent +=
          " This published snapshot is older than three hours.";
      }
      freshness();
      if (
        view !== "analysis" ||
        refresh ||
        !document.querySelector("#battery-form")
      ) {
        render();
        for (const saved of retained) {
          const el = document.querySelector(saved.selector);
          if (el) {
            el.value = saved.value;
            el.dispatchEvent(
              new Event(saved.kind === "SELECT" ? "change" : "input"),
            );
          }
        }
      }
    } catch (err) {
      document.querySelector("#notice").hidden = false;
      document.querySelector("#notice").textContent = err.message;
    } finally {
      button.disabled = false;
      loading = false;
    }
  }
  document.querySelector("#day").onchange = (ev) => {
    day = ev.target.value;
    render();
  };
  document.querySelector("#refresh").onclick = () => load(true);
  document.querySelector("#refresh").innerHTML =
    icon("refresh") +
    "<span>" +
    (isLocal ? "Refresh" : "Reload snapshot") +
    "</span>";
  document.querySelector("#export").innerHTML =
    icon("download") + "<span>Export history</span>";
  document.querySelector("#range").onchange = (ev) => {
    Extensions.setRange(ev.target.value);
    render();
  };
  window.onhashchange = () => {
    render();
    window.scrollTo(0, 0);
  };
  document.querySelector("#export").onclick = () => {
    const blob = new Blob(
        [
          JSON.stringify(
            {
              series: data.series,
              nodes: data.nodes,
              forecastVintages: data.forecastVintages,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "ercot-market-history.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  load();
  function freshness() {
    if (!data) return;
    const age =
      (Date.now() - Date.parse(data.publishedAt || data.fetchedAt)) / 60000;
    const notice = document.querySelector("#notice");
    if (!isLocal && age > 75) {
      notice.hidden = false;
      notice.textContent = `Published data is ${n(age / 60, 1)} hours old. Scheduled publication targets 30 minutes; the scheduler can be delayed. See Data health for update status and the manual collector link.`;
    }
  }
  setInterval(() => {
    if (!document.hidden) load();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load();
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 200);
  });
})();
