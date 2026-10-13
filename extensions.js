window.Extensions = (() => {
  const { number: n, escape: e, valid, chart } = UI;
  let range = 48;
  function stamp(t) {
    if (!t) return "—";
    const date = new Date(
      String(t)
        .replace(" ", "T")
        .replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
    );
    if (!Number.isFinite(+date)) return t;
    const s = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(date);
    const offset = Math.round(
      (Date.parse(s.replace(" ", "T") + "Z") - date.getTime()) / 60000,
    );
    return (
      s +
      (offset < 0 ? "-" : "+") +
      String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0") +
      String(Math.abs(offset) % 60).padStart(2, "0")
    );
  }
  function rows(data) {
    const monitor = data.monitor || {},
      ref = Date.parse(
        monitor.published_at || data.publishedAt || data.fetchedAt,
      );
    return (monitor.hours || [])
      .filter(
        (h) =>
          Date.parse(h.time) > ref - range * 3600000 &&
          Date.parse(h.time) <= ref,
      )
      .map((h) => ({ ...h, timestamp: stamp(h.time) }));
  }
  async function load(data) {
    const names = ["latest", "fuels", "reports", "kalshi"];
    const out = await Promise.allSettled(
      names.map(async (name) => {
        return DataClient.json("data/" + name + ".json");
      }),
    );
    data.monitor = out[0].status === "fulfilled" ? out[0].value : null;
    data.economics = out[1].status === "fulfilled" ? out[1].value : null;
    data.editions = out[2].status === "fulfilled" ? out[2].value : [];
    data.predictions = out[3].status === "fulfilled" ? out[3].value : null;
    return data;
  }
  function events(list, table) {
    return table(
      ["Interval end (CT)", "Signal", "Deviation", "Threshold"],
      list
        .slice(0, 30)
        .map((r) => [
          stamp(r.time),
          r.type,
          n(r.value, 2) + " " + r.unit,
          "± " + n(r.threshold) + " " + r.unit,
        ]),
    );
  }
  function exportJson(value, name) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  function corr(pairs) {
    if (pairs.length < 5) return null;
    const avg = (i) => pairs.reduce((s, p) => s + p[i], 0) / pairs.length;
    const x = avg(0),
      y = avg(1),
      cov = pairs.reduce((s, p) => s + (p[0] - x) * (p[1] - y), 0),
      xx = pairs.reduce((s, p) => s + (p[0] - x) ** 2, 0),
      yy = pairs.reduce((s, p) => s + (p[1] - y) ** 2, 0);
    return xx && yy ? cov / Math.sqrt(xx * yy) : null;
  }
  function render(view, data, { panel, plot, table }) {
    const el = document.querySelector("#content"),
      monitor = data.monitor || {},
      history = rows(data);
    if (view === "forecasts") {
      el.innerHTML =
        '<div class="grid">' +
        ["load", "wind", "solar", "net_load"]
          .map((k) =>
            panel(
              k === "net_load" ? "Net load" : k[0].toUpperCase() + k.slice(1),
              plot("forecast-" + k),
              "Actual vs prior-day forecast · " + range + " hours",
            ),
          )
          .join("") +
        panel(
          "Net load surprise",
          plot("net-error"),
          "Actual − prior-day expectation · MW",
        ) +
        panel(
          "Seven-day demand outlook",
          plot("outlook"),
          "Latest published load forecast",
        ) +
        panel(
          "Forecast comparison",
          table(
            [
              "Interval end",
              "Load error MW",
              "Wind error MW",
              "Solar error MW",
              "Net error MW",
              "Houston RT − DAM",
            ],
            history
              .slice()
              .reverse()
              .slice(0, 48)
              .map((h) => [
                stamp(h.time),
                n(h.load_error),
                n(h.wind_error),
                n(h.solar_error),
                n(h.net_load_error),
                n(h.prices?.HB_HOUSTON?.spread, 2),
              ]),
          ),
          "Matched delivery hours",
          true,
        ) +
        panel(
          "Event journal",
          events(monitor.events || [], table),
          "Threshold crossings · completed price hours",
          true,
        ) +
        "</div>";
      for (const k of ["load", "wind", "solar", "net_load"])
        chart(
          "forecast-" + k,
          history,
          [
            { key: k, label: "Actual" },
            { key: k + "_forecast", label: "Prior-day forecast", dash: true },
          ],
          "MW",
        );
      chart(
        "net-error",
        history,
        [{ key: "net_load_error", label: "Net load error" }],
        "MW",
      );
      chart(
        "outlook",
        (monitor.hours || [])
          .filter((h) => Date.parse(h.time) > Date.parse(monitor.published_at))
          .map((h) => ({ ...h, timestamp: stamp(h.time) })),
        [{ key: "load_outlook", label: "Latest forecast" }],
        "MW",
      );
      return true;
    }
    if (view === "reports") {
      el.innerHTML =
        '<div class="filters"><label>Report <select id="edition">' +
        (data.editions || [])
          .map(
            (r) =>
              `<option value="${e(r.file)}">${e(stamp(r.published_at))}</option>`,
          )
          .join("") +
        '</select></label><a class="download" href="data/hourly.csv" download>' +
        icon("download") +
        'Hourly CSV</a><a class="download" href="data/latest-report.md" download>Latest Markdown</a><a class="download" id="report-json" download>Report JSON</a><a class="download" href="data/latest.json" download>Market snapshot JSON</a></div><div id="report-body"></div>';
      const show = async () => {
        const file = document.querySelector("#edition").value,
          body = document.querySelector("#report-body");
        if (!file) {
          body.textContent = "No collected report available yet.";
          return;
        }
        document.querySelector("#report-json").href = "data/" + file;
        try {
          const r = await fetch("data/" + file);
          if (!r.ok) throw Error("Report unavailable");
          const report = await r.json();
          body.innerHTML =
            '<div class="grid">' +
            [
              ["daily", "Daily review"],
              ["weekly", "Weekly review"],
            ]
              .map(([key, title]) => {
                const s = report[key];
                return panel(
                  title,
                  table(
                    ["Measure", "Value"],
                    [
                      ["Average Houston RT $/MWh", n(s.average_rt, 2)],
                      ["Highest Houston RT $/MWh", n(s.max_rt, 2)],
                      ["Peak measured demand MW", n(s.peak_load)],
                      ["Net load forecast MAE MW", n(s.net_load_mae)],
                      ["Complete price hours", s.complete_price_hours],
                      ["Measured load hours", s.observed_load_hours],
                      ["Matched forecast hours", s.forecast_comparison_hours],
                      ["Event flags", s.events],
                    ],
                  ),
                  stamp(report.published_at),
                );
              })
              .join("") +
            panel(
              "Report events",
              events(report.events || [], table),
              "",
              true,
            ) +
            panel(
              "Methods",
              Object.entries(report.methodology)
                .map(
                  ([k, v]) =>
                    `<details><summary>${e(k.replaceAll("_", " "))}</summary><p>${e(v)}</p></details>`,
                )
                .join(""),
              "",
              true,
            ) +
            "</div>";
        } catch (err) {
          body.textContent = err.message;
        }
      };
      document.querySelector("#edition").onchange = show;
      show();
      return true;
    }
    if (view === "fuels") {
      const eco = data.economics || {},
        nodes = eco.nodes || [],
        bench = eco.benchmarks || [],
        gas = bench.find((b) => b.name === "Henry Hub"),
        lng = bench.find((b) => b.name === "US LNG export price"),
        volume = bench.find((b) => b.name === "US LNG export volume");
      el.innerHTML =
        '<div class="grid">' +
        panel(
          "Settlement price by resource type",
          plot("fuel-price"),
          "Disclosure " +
            (eco.mapping?.disclosure_day || "unavailable") +
            " · median unique node price",
          true,
        ) +
        panel(
          "Resource-node comparison",
          '<label>Resource node <select id="node-pick">' +
            nodes
              .map(
                (v, i) =>
                  `<option value="${i}">${e(v.fuel + " · " + v.node)}</option>`,
              )
              .join("") +
            "</select></label>" +
            plot("node-price") +
            '<div id="node-detail" class="map-time-note"></div>',
          "Node samples mapped from ERCOT disclosure",
          true,
        ) +
        panel(
          "Henry Hub natural gas",
          plot("gas-price"),
          "Daily spot benchmark · $/MMBtu",
        ) +
        panel(
          "US LNG exports",
          plot("lng-price"),
          "Monthly cargo export average · $/Mcf",
        ) +
        panel(
          "Gas generation economics",
          '<div class="form-grid"><label>Heat rate MMBtu/MWh<input id="heat-rate" type="number" value="7" min="1" max="30" step=".1"></label><label>Variable cost $/MWh<input id="gas-vom" type="number" value="3" min="0" step=".1"></label><label>Hub<select id="gas-hub">' +
            ["HB_HOUSTON", "HB_NORTH", "HB_WEST", "HB_SOUTH", "HB_BUSAVG"]
              .map((h) => `<option>${h}</option>`)
              .join("") +
            "</select></label></div>" +
            plot("spark") +
            '<div id="spark-summary" class="map-time-note"></div>',
          "Illustrative fuel cost = heat rate × Henry Hub + variable cost",
          true,
        ) +
        panel(
          "Daily gas versus power",
          plot("gas-scatter"),
          "Matched daily Henry Hub and complete-hour hub prices",
          true,
        ) +
        panel(
          "Correlations",
          '<div id="correlations"></div>',
          "Pearson r · aligned observations · sample count shown",
          true,
        ) +
        panel(
          "Benchmark scope",
          table(
            ["Dataset", "Latest period", "Unit", "Source"],
            bench.map((b) => [
              b.name,
              b.series
                .at(-1)
                ?.timestamp?.slice(0, b.name === "Henry Hub" ? 10 : 7) ||
                "Unavailable",
              b.unit,
              b.source,
            ]),
          ),
          "LNG export average is monthly; Henry Hub is a daily US gas benchmark",
          true,
        ) +
        "</div>";
      chart(
        "fuel-price",
        (eco.disclosure?.series || []).map((r) => ({
          ...r,
          timestamp: stamp(r.timestamp),
        })),
        ["Natural Gas", "Wind", "Solar", "Coal and Lignite", "Nuclear"].map(
          (key) => ({ key, label: key }),
        ),
        "$/MWh",
      );
      const showNode = () => {
        const node = nodes[+document.querySelector("#node-pick").value];
        if (!node) return;
        chart(
          "node-price",
          node.series.map((r) => ({ ...r, timestamp: stamp(r.timestamp) })),
          [
            { key: "rt", label: "RT 15 min" },
            { key: "dam", label: "DAM hourly", dash: true },
          ],
          "$/MWh",
        );
        document.querySelector("#node-detail").textContent =
          `${node.resource} · ERCOT type ${node.type} · mapping from ${eco.mapping?.disclosure_day}. Prices are for the resource's settlement location. The sample is not representative of the entire fleet.`;
      };
      document.querySelector("#node-pick").onchange = showNode;
      showNode();
      chart(
        "gas-price",
        (gas?.series || []).map((r) => ({
          ...r,
          timestamp: r.timestamp.slice(0, 10),
        })),
        [{ key: "value", label: "Henry Hub" }],
        "$/MMBtu",
      );
      chart(
        "lng-price",
        (lng?.series || []).map((r) => ({
          ...r,
          timestamp: r.timestamp.slice(0, 10),
        })),
        [{ key: "value", label: "US LNG export average" }],
        "$/Mcf",
      );
      const gasDays = Object.fromEntries(
        (gas?.series || []).map((r) => [r.timestamp.slice(0, 10), r.value]),
      );
      const spark = () => {
        const heat = +document.querySelector("#heat-rate").value,
          vom = +document.querySelector("#gas-vom").value,
          hub = document.querySelector("#gas-hub").value;
        if (!(heat > 0 && vom >= 0)) return;
        const rows = (monitor.hours || [])
          .filter((h) => h.time <= monitor.published_at)
          .map((h) => {
            const date = stamp(
                new Date(Date.parse(h.time) - 1).toISOString(),
              ).slice(0, 10),
              g = gasDays[date],
              price = h.prices?.[hub]?.rt;
            return {
              timestamp: stamp(h.time),
              price,
              cost: valid(g) ? g * heat + vom : null,
              margin: valid(g) && valid(price) ? price - g * heat - vom : null,
            };
          });
        chart(
          "spark",
          rows,
          [
            { key: "price", label: "Electricity" },
            { key: "cost", label: "Illustrative fuel + variable cost" },
            { key: "margin", label: "Spark spread" },
          ],
          "$/MWh",
        );
        document.querySelector("#spark-summary").textContent =
          "Exact-date matches only; weekends and missing gas dates remain gaps. Henry Hub excludes Texas hub basis, pipeline transport, start costs, emissions and actual plant heat rates.";
        const dailyMeans = Object.fromEntries(
          (eco.hub_daily || [])
            .filter((r) => r.hub === hub)
            .map((r) => [r.date, r.price]),
        );
        UI.scatter(
          "gas-scatter",
          Object.entries(dailyMeans)
            .filter(([date, power]) => valid(gasDays[date]))
            .map(([date, power]) => ({ date, power, gas: gasDays[date] })),
        );
        const stats = [];
        for (const lag of [0, 1, 7]) {
          const pairs = Object.entries(dailyMeans).flatMap(([date, p]) => {
            const ref = new Date(date + "T12:00:00Z");
            ref.setUTCDate(ref.getUTCDate() - lag);
            const g = gasDays[ref.toISOString().slice(0, 10)];
            return valid(g) ? [[g, p]] : [];
          });
          stats.push([
            "Henry Hub → " + hub + " (" + lag + " day lag)",
            n(corr(pairs), 3),
            pairs.length,
            pairs.length < 30 ? "Limited sample" : "",
          ]);
        }
        const monthGas = {};
        for (const r of gas?.series || [])
          (monthGas[r.timestamp.slice(0, 7)] ??= []).push(r.value);
        for (const b of [lng, volume]) {
          const pairs = (b?.series || []).flatMap((r) => {
            const v = monthGas[r.timestamp.slice(0, 7)];
            return v?.length >= 10
              ? [[v.reduce((a, b) => a + b, 0) / v.length, r.value]]
              : [];
          });
          stats.push([
            "Monthly Henry Hub ↔ " + (b?.name || "LNG"),
            n(corr(pairs), 3),
            pairs.length,
            "Levels; descriptive association",
          ]);
          const powerMonths = {};
          for (const [date, p] of Object.entries(dailyMeans))
            (powerMonths[date.slice(0, 7)] ??= []).push(p);
          const powerPairs = (b?.series || []).flatMap((r) => {
            const v = powerMonths[r.timestamp.slice(0, 7)];
            return v?.length >= 20
              ? [[v.reduce((a, b) => a + b, 0) / v.length, r.value]]
              : [];
          });
          stats.push([
            "Monthly " + hub + " ↔ " + (b?.name || "LNG"),
            n(corr(powerPairs), 3),
            powerPairs.length,
            "At least 20 measured days per month",
          ]);
        }
        document.querySelector("#correlations").innerHTML =
          table(["Comparison", "r", "Matched periods", "Coverage"], stats) +
          '<p class="map-time-note">At least five pairs and nonzero variance are required. Correlation is descriptive; weather, congestion and supply changes can affect both series. Electricity daily means require at least 20 complete hours.</p>';
      };
      for (const id of ["heat-rate", "gas-vom", "gas-hub"])
        document.getElementById(id).onchange = spark;
      spark();
      return true;
    }
    return false;
  }
  function enhance(view, data, { panel, plot, table }) {
    const el = document.querySelector("#content"),
      m = data.monitor || {},
      history = rows(data),
      append = (html) => el.insertAdjacentHTML("beforeend", html);
    if (view === "overview") {
      const r = m.current?.net_load;
      append(
        '<div class="grid">' +
          panel(
            "Aligned net load",
            `<div class="summary-row"><strong>${n(m.current?.net_load?.value)} MW</strong><small>${e(stamp(m.current?.net_load?.time))}</small></div>` +
              plot("overview-net"),
            "Load − wind − solar · common observation timestamps",
          ) +
          panel(
            "Event journal",
            events(m.events || [], table),
            "RT–DAM, basis and forecast deviations",
          ) +
          "</div>",
      );
      chart(
        "overview-net",
        history,
        [
          { key: "net_load", label: "Actual" },
          { key: "net_load_forecast", label: "Prior-day forecast", dash: true },
        ],
        "MW",
      );
    }
    if (view === "prices") {
      append(
        '<div class="grid">' +
          panel(
            "Matched hub prices",
            '<label>Hub <select id="archive-hub">' +
              (m.hubs || [])
                .map((h) => `<option>${e(h.hub)}</option>`)
                .join("") +
              "</select></label>" +
              plot("archive-prices") +
              plot("archive-spread"),
            "Hourly RT mean · four intervals per complete hour",
            true,
          ) +
          panel(
            "West − Houston basis",
            plot("basis"),
            "Matched geographic price difference",
          ) +
          panel(
            "Upcoming day-ahead curve",
            plot("forward"),
            "Published DAM prices",
          ) +
          panel(
            "Hub settlements",
            table(
              ["Hub", "RT $/MWh", "Matched DAM", "Spread", "Interval end"],
              (m.hubs || []).map((h) => [
                h.hub,
                n(h.value, 2),
                n(h.dam, 2),
                n(h.spread, 2),
                stamp(h.time),
              ]),
            ),
            "Archived native 15-minute values",
            true,
          ) +
          "</div>",
      );
      const redraw = () => {
        const hub = document.querySelector("#archive-hub").value;
        chart(
          "archive-prices",
          history.map((h) => ({ timestamp: h.timestamp, ...h.prices?.[hub] })),
          [
            { key: "rt", label: "RT hourly mean" },
            { key: "dam", label: "DAM", dash: true },
          ],
          "$/MWh",
        );
        chart(
          "archive-spread",
          history.map((h) => ({ timestamp: h.timestamp, ...h.prices?.[hub] })),
          [{ key: "spread", label: "RT − DAM" }],
          "$/MWh",
        );
        chart(
          "forward",
          (m.hours || [])
            .filter(
              (h) => h.time > m.published_at && valid(h.prices?.[hub]?.dam),
            )
            .map((h) => ({
              timestamp: stamp(h.time),
              dam: h.prices?.[hub]?.dam,
            })),
          [{ key: "dam", label: "DAM" }],
          "$/MWh",
        );
      };
      document.querySelector("#archive-hub").onchange = redraw;
      redraw();
      chart(
        "basis",
        history,
        [{ key: "basis", label: "West − Houston" }],
        "$/MWh",
      );
    }
    if (view === "resources") {
      append(
        '<div class="grid">' +
          panel(
            "Storage and solar context",
            plot("storage-solar"),
            "Archived solar output · MW",
          ) +
          panel(
            "Storage price context",
            plot("storage-price"),
            "Houston hourly real-time price",
          ) +
          "</div>",
      );
      chart(
        "storage-solar",
        history,
        [{ key: "solar", label: "Solar actual" }],
        "MW",
      );
      chart(
        "storage-price",
        history.map((h) => ({
          timestamp: h.timestamp,
          price: h.prices?.HB_HOUSTON?.rt,
        })),
        [{ key: "price", label: "Houston RT" }],
        "$/MWh",
      );
    }
    if (view === "weather") {
      append(
        panel(
          "NWS weather outlook",
          '<label>Station region <select id="nws-city">' +
            (m.weather || [])
              .map((c, i) => `<option value="${i}">${e(c.city)}</option>`)
              .join("") +
            '</select></label><div id="nws-readings"></div><div class="grid">' +
            plot("nws-temperature") +
            plot("nws-rain") +
            plot("nws-cloud") +
            plot("nws-humidity") +
            "</div>",
          "Official hourly forecasts and current station observations",
          true,
        ),
      );
      const draw = () => {
        const city = m.weather?.[+document.querySelector("#nws-city").value];
        if (!city) return;
        document.querySelector("#nws-readings").innerHTML = table(
          ["Station reading", "Value", "Observation time"],
          Object.entries(city.actual).map(([k, v]) => [
            k.replaceAll("_", " "),
            n(v.value, 2) + " " + v.unit,
            stamp(v.time),
          ]),
        );
        const series = city.forecast.map((r) => ({
          ...r,
          timestamp: stamp(r.time),
        }));
        for (const [id, key, unit] of [
          ["nws-temperature", "temperature", "°C"],
          ["nws-rain", "precip_probability", "%"],
          ["nws-cloud", "cloud_cover", "%"],
          ["nws-humidity", "humidity", "%"],
        ])
          chart(id, series, [{ key, label: key.replaceAll("_", " ") }], unit);
      };
      document.querySelector("#nws-city").onchange = draw;
      draw();
    }
    if (view === "health") {
      document.querySelector("#content").insertAdjacentHTML(
        "afterbegin",
        panel(
          "Publication and update cadence",
          table(
            ["Metric", "Latest"],
            [
              ["Publication", stamp(data.publishedAt || data.fetchedAt)],
              [
                "Latest market price source time",
                data.current.prices?.timestamp || "—",
              ],
              [
                "Collector target",
                "Every 30 minutes on GitHub Pages; hourly local archive",
              ],
              [
                "Browser refresh",
                "Checks every minute while visible; fetches changed publications",
              ],
              [
                "Scheduler reliability",
                "Best effort · inspected scheduled runs had several-hour gaps",
              ],
              [
                "Archive",
                n(m.archive_records) +
                  " observations; full history is outside browser payloads",
              ],
            ],
          ) +
            '<p><a class="download" href="https://github.com/nikhilvinod23/ercot-market-dashboard/actions/workflows/market-monitoring.yml" target="_blank" rel="noopener">Collector runs / Run workflow ↗</a></p><details><summary>Keeping publication consistent</summary><p>Reloading this static site checks the latest published files. For strict freshness, use an independent hosted scheduler or an always-on collector. A collector_tick repository dispatch can recover a stale edition without putting credentials in the browser.</p><a class="download" href="https://github.com/nikhilvinod23/ercot-market-dashboard/blob/ercot-market-monitoring/docs/OPERATIONS.md" target="_blank" rel="noopener">Operations and scaling guide ↗</a></details>',
        ),
      );
      append(
        panel(
          "Archive collection",
          table(
            ["Source", "Status", "Rows", "Updated / checked"],
            (m.sources || []).map((s) => [
              s.name,
              s.status,
              s.records,
              stamp(s.updated || s.checked),
            ]),
          ),
          n(m.archive_records) + " observations",
        ) +
          panel(
            "Calculation methods",
            Object.entries(m.methodology || {})
              .map(
                ([k, v]) =>
                  `<details><summary>${e(k.replaceAll("_", " "))}</summary><p>${e(v)}</p></details>`,
              )
              .join("") +
              "<p>Python archives raw responses, observations and forecast vintages in SQLite. Public collection targets 30 minutes; local market feeds refresh every minute.</p>",
            "",
          ),
      );
    }
  }
  return {
    load,
    render,
    enhance,
    stamp,
    setRange: (value) => (range = +value),
    exportJson,
    corr,
  };
})();
