const fs = require("node:fs");
const path = require("node:path");
const ROOT = __dirname;
const DATA = path.join(ROOT, "runtime-data");
fs.mkdirSync(DATA, { recursive: true });
const n = (v) =>
  v === null || v === undefined || v === ""
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
const ctDay = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const iso = (t) =>
  t
    ? String(t)
        .replace(" ", "T")
        .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    : null;
const last = (a) => a?.at(-1) || null;
const rows = (p) =>
  (p?.data || []).map((r) =>
    Array.isArray(r)
      ? Object.fromEntries(p.fields.map((f, i) => [f.name, r[i]]))
      : r,
  );
function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name + ".json"), "utf8"));
  } catch {
    return fallback;
  }
}
function save(name, value) {
  const file = path.join(DATA, name + ".json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(value));
  fs.renameSync(file + ".tmp", file);
}
const dashboardUrl = (name) =>
  "https://www.ercot.com/api/1/services/read/dashboards/" + name + ".json";
const PUBLIC = {
  prices: "system-wide-prices",
  demand: "system-wide-demand",
  supply: "supply-demand",
  fuel: "fuel-mix",
  storage: "energy-storage-resources",
  outages: "generation-outages",
  reserves: "daily-prc",
  ancillary: "ancillary-services",
  weather: "weather-forecast",
};
const REPORTS = {
  regional: ["np6-345-cd/act_sys_load_by_wzn", { size: 96 }],
  asDam: ["np4-188-cd/dam_clear_price_for_cap", { size: 500 }],
  asRt: ["np6-331-cd/rt_clear_price_cap", { size: 1000 }],
  asSold: ["np4-532-cd/dam_as_sold", { size: 120 }],
  constraints: ["np6-86-cd/shdw_prices_bnd_trns_const", { size: 500 }],
  yesterdayPrices: [
    "np6-905-cd/spp_node_zone_hub",
    { size: 1000, settlementPoint: "HB_HUBAVG" },
  ],
};

module.exports = function createMarketData({
  fetchPublicJson,
  fetchErcot,
  fetchWithTimeout,
}) {
  let feeds = read("feeds", {}),
    reports = read("reports", {}),
    history = read("history", {}),
    nodes = read("nodes", []);
  let geography = read("geography", null),
    resources = read("resources", null),
    weather = read("weather", null);
  let refreshing = null,
    reportBusy = false,
    assetBusy = false,
    weatherBusy = false;
  let lastReport = 0,
    lastAssets = 0,
    lastWeather = 0;
  function merge(name, values, key = "timestamp") {
    if (!Array.isArray(values)) return;
    const all = new Map((history[name] || []).map((r) => [r[key], r]));
    for (const row of values) if (row[key]) all.set(row[key], row);
    const cutoff = Date.now() - 30 * 86400000;
    history[name] = [...all.values()]
      .filter((r) => Date.parse(iso(r[key])) >= cutoff)
      .sort((a, b) => Date.parse(iso(a[key])) - Date.parse(iso(b[key])));
  }
  async function updateReports() {
    if (reportBusy || Date.now() - lastReport < 900000) return;
    reportBusy = true;
    lastReport = Date.now();
    for (const [name, [endpoint, params]] of Object.entries(REPORTS)) {
      try {
        const q = { ...params };
        if (name === "yesterdayPrices") {
          const d = new Date(Date.now() - 86400000);
          q.deliveryDateFrom = ctDay(d);
          q.deliveryDateTo = ctDay(d);
        }
        const p = await fetchErcot(
          "https://api.ercot.com/api/public-reports/" +
            endpoint +
            "?" +
            new URLSearchParams(q),
          900,
        );
        if (!p.fields || !Array.isArray(p.data))
          throw new Error("Unexpected report schema");
        reports[name] = {
          ok: true,
          rows: rows(p),
          fetchedAt: new Date().toISOString(),
          totalRecords: p._meta?.totalRecords,
          pageSize: p._meta?.pageSize,
          source: endpoint,
        };
      } catch (e) {
        reports[name] = { ...reports[name], ok: false, error: e.message };
      }
      save("reports", reports);
      await new Promise((resolve) => setTimeout(resolve, 6500));
    }
    reportBusy = false;
  }
  async function updateNodes() {
    try {
      const response = await fetchWithTimeout(
        "https://www.ercot.com/content/cdr/contours/rtmLmp.html",
      );
      if (!response.ok) throw new Error("Node map unavailable");
      const html = await response.text();
      const ts = html.match(/Last Updated:\s*([^<]+)/)?.[1]?.trim();
      const points = [
        ...html.matchAll(
          /coords="(\d+),(\d+),\d+"\s+title="([^:]+):\s*\$(-?[\d.]+)"/g,
        ),
      ].map((m) => ({ x: +m[1], y: +m[2], name: m[3], price: +m[4] }));
      if(!points.length || !ts)throw new Error('Nodal map schema unavailable');
      feeds.nodes={ok:true,lastUpdated:ts,fetchedAt:new Date().toISOString()};
      if (points.length && last(nodes)?.timestamp !== ts) {
        nodes.push({
          timestamp: ts,
          capturedAt: new Date().toISOString(),
          points,
        });
        nodes = nodes.filter(
          (r) => Date.parse(r.capturedAt) > Date.now() - 7 * 86400000,
        );
        save("nodes", nodes);
      }
    } catch (e) {
      feeds.nodes = { ...feeds.nodes, ok: false, error: e.message };
    }
  }
  async function updateAssets() {
    if (assetBusy || Date.now() - lastAssets < 86400000) return;
    assetBusy = true;
    lastAssets = Date.now();
    try {
      const html = await (
        await fetchWithTimeout(
          "https://www.ercot.com/gridmktinfo/dashboards/weatherforecast",
        )
      ).text();
      const shapes = [
        ...html.matchAll(
          /name:\s*"([^"]*)",\s*(?:\/\/[^\n]*\n\s*)?color:\s*"[^"]*",\s*path:\s*"([^"]*)"/g,
        ),
      ].map((m) => ({ name: m[1] || "Texas", path: m[2] }));
      if (shapes.length < 8) throw new Error("Region boundaries unavailable");
      geography = {
        source: "https://www.ercot.com/gridmktinfo/dashboards/weatherforecast",
        fetchedAt: new Date().toISOString(),
        shapes,
      };
      save("geography", geography);
    } catch (e) {
      geography = { ...geography, error: e.message };
    }
    try {
      const base =
        "https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/Power_Plants_in_the_US/FeatureServer/0/query?";
      const p = await fetchPublicJson(
        base +
          new URLSearchParams({
            where: "State = 'Texas'",
            outFields: "*",
            outSR: "4326",
            f: "json",
            resultRecordCount: "2000",
          }),
      );
      if (p.error || !p.features?.length)
        throw new Error("EIA resource inventory unavailable");
      const plants = p.features
        .map((f) => {
          const a = f.attributes;
          return {
            id: a.Plant_Code,
            name: a.Plant_Name,
            lat: n(a.Latitude) || f.geometry?.y,
            lon: n(a.Longitude) || f.geometry?.x,
            county: a.County,
            fuel: a.PrimSource,
            capacity: n(a.Total_MW),
            wind: n(a.Wind_MW),
            solar: n(a.Solar_MW),
            battery: n(a.Bat_MW),
            period: a.Period,
          };
        })
        .filter((p) => p.lat && p.lon);
      resources = {
        source: base.split("/query")[0],
        fetchedAt: new Date().toISOString(),
        scope: "Texas EIA inventory mirror; ERCOT membership not verified",
        plants,
      };
      save("resources", resources);
    } catch (e) {
      resources = { ...resources, error: e.message };
    }
    assetBusy = false;
  }
  const cities = [
    ["Dallas", 32.78, -96.8, "northC"],
    ["Houston", 29.76, -95.37, "coast"],
    ["Austin", 30.27, -97.74, "southC"],
    ["San Antonio", 29.42, -98.49, "southC"],
    ["Midland", 31.99, -102.08, "farWest"],
    ["Abilene", 32.45, -99.73, "west"],
    ["Wichita Falls", 33.91, -98.49, "north"],
    ["Tyler", 32.35, -95.3, "east"],
    ["Corpus Christi", 27.8, -97.4, "southern"],
  ];
  async function updateWeather() {
    if (weatherBusy || Date.now() - lastWeather < 3600000) return;
    weatherBusy = true;
    lastWeather = Date.now();
    try {
      const q = new URLSearchParams({
        latitude: cities.map((c) => c[1]).join(","),
        longitude: cities.map((c) => c[2]).join(","),
        hourly: "temperature_2m,wind_speed_10m,shortwave_radiation",
        temperature_unit: "fahrenheit",
        wind_speed_unit: "mph",
        timezone: "America/Chicago",
        past_days: "1",
        forecast_days: "3",
      });
      const p = await fetchPublicJson(
        "https://api.open-meteo.com/v1/forecast?" + q,
      );
      const previousQ = new URLSearchParams({
        latitude: cities.map((c) => c[1]).join(","),
        longitude: cities.map((c) => c[2]).join(","),
        hourly: "temperature_2m_previous_day1",
        temperature_unit: "fahrenheit",
        timezone: "America/Chicago",
        past_days: "1",
        forecast_days: "3",
      });
      let previous = [];
      try {
        const v = await fetchPublicJson(
          "https://previous-runs-api.open-meteo.com/v1/forecast?" + previousQ,
        );
        previous = Array.isArray(v) ? v : [v];
      } catch {}
      const values = Array.isArray(p) ? p : [p];
      const cityData = values.map((v, j) => ({
        name: cities[j][0],
        lat: cities[j][1],
        lon: cities[j][2],
        zone: cities[j][3],
        utcOffsetSeconds: v.utc_offset_seconds,
        series: (v.hourly?.time || []).map((timestamp, i) => ({
          timestamp,
          temperature: n(v.hourly.temperature_2m[i]),
          wind: n(v.hourly.wind_speed_10m[i]),
          solar: n(v.hourly.shortwave_radiation[i]),
          previousForecast: n(
            previous[j]?.hourly?.temperature_2m_previous_day1?.[i],
          ),
        })),
      }));
      const stations = [
        "KDFW",
        "KIAH",
        "KAUS",
        "KSAT",
        "KMAF",
        "KABI",
        "KSPS",
        "KTYR",
        "KCRP",
      ];
      await Promise.all(
        cityData.map(async (c, j) => {
          try {
            const response = await fetchWithTimeout(
              "https://api.weather.gov/stations/" +
                stations[j] +
                "/observations?limit=500",
              {
                headers: {
                  "User-Agent": "ERCOTDashboard (local market research)",
                  Accept: "application/geo+json",
                },
              },
            );
            if (!response.ok)
              throw new Error("Station observations unavailable");
            const observations = (await response.json()).features || [];
            const byHour = new Map();
            const formatter = new Intl.DateTimeFormat("sv-SE", {
              timeZone: "America/Chicago",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              hourCycle: "h23",
            });
            for (const f of observations) {
              const p = f.properties,
                v = n(p.temperature?.value);
              if (v === null) continue;
              const key =
                formatter.format(new Date(p.timestamp)).replace(" ", "T") +
                ":00";
              if (!byHour.has(key))
                byHour.set(key, {
                  value: (v * 9) / 5 + 32,
                  timestamp: p.timestamp,
                });
            }
            c.station = stations[j];
            c.observationSource =
              "https://api.weather.gov/stations/" +
              stations[j] +
              "/observations";
            c.series = c.series.map((r) => ({
              ...r,
              observed: byHour.get(r.timestamp)?.value ?? null,
              observationTimestamp: byHour.get(r.timestamp)?.timestamp ?? null,
            }));
          } catch (err) {
            c.observationError = err.message;
          }
        }),
      );
      weather = {
        fetchedAt: new Date().toISOString(),
        source: "Open-Meteo / NOAA NWS",
        measurement:
          "Open-Meteo models; NOAA station temperature where available",
        previousRunAvailable: cityData.some((c) =>
          c.series.some((r) => r.previousForecast !== null),
        ),
        cities: cityData,
      };
      save("weather", weather);
    } catch (e) {
      weather = { ...weather, error: e.message };
    }
    weatherBusy = false;
  }
  function priceSeries(p) {
    return (p?.rtSppData || []).map((r) => ({
      timestamp: r.timestamp,
      ...Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => k.startsWith("hb") || k.startsWith("lz"))
          .map(([k, v]) => [k, n(v)]),
      ),
    }));
  }
  function fuelSeries(p) {
    return Object.values(p?.data || {}).flatMap((day) =>
      Object.entries(day).map(([timestamp, gen]) => ({
        timestamp,
        ...Object.fromEntries(
          Object.entries(gen)
            .filter(([name]) => !name.startsWith("Power Storage "))
            .map(([name, v]) => [name, n(v.gen)]),
        ),
      })),
    );
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await Promise.all(
        Object.entries(PUBLIC).map(async ([name, endpoint]) => {
          try {
            const p = await fetchPublicJson(dashboardUrl(endpoint));
            feeds[name] = {
              ok: true,
              payload: p,
              fetchedAt: new Date().toISOString(),
              lastUpdated: p.lastUpdated || p[0]?.lastUpdated,
            };
          } catch (e) {
            feeds[name] = { ...feeds[name], ok: false, error: e.message };
          }
        }),
      );
      merge("prices", priceSeries(feeds.prices?.payload));
      merge("fuel", fuelSeries(feeds.fuel?.payload));
      merge(
        "supply",
        (feeds.supply?.payload?.data || [])
          .filter((r) => Number(r.forecast) === 0)
          .map((r) => ({
            timestamp: r.timestamp,
            actual: n(r.demand),
            capacity: n(r.capacity),
          })),
      );
      const d = feeds.demand?.payload;
      merge(
        "demand",
        [...(d?.previousDay?.data || []), ...(d?.currentDay?.data || [])].map(
          (r) => ({
            timestamp: r.timestamp,
            hourEnding: r.hourEnding,
            actual: n(r.systemLoad),
            forecast: n(r.currentLoadForecast),
            dayAhead: n(r.dayAheadForecast),
            capacity: n(r.currentDayHsl),
            repeatedHour: r.dstFlag,
          }),
        ),
      );
      const s = feeds.storage?.payload;
      merge(
        "storage",
        [...(s?.previousDay?.data || []), ...(s?.currentDay?.data || [])].map(
          (r) => ({
            timestamp: r.timestamp,
            charge: n(r.totalCharging),
            discharge: n(r.totalDischarging),
            net: n(r.netOutput),
          }),
        ),
      );
      merge(
        "reserves",
        (feeds.reserves?.payload?.data || [])
          .filter((r, i) => i % 12 === 0)
          .map((r) => ({ timestamp: r.timestamp, prc: n(r.prc) })),
      );
      merge(
        "ancillary",
        (feeds.ancillary?.payload?.ascapmon || []).filter(
          (r, i) => i % 5 === 0,
        ),
      );
      const now = new Date().toISOString();
      history.forecastVintages = history.forecastVintages || [];
      if (
        d?.currentDay?.data?.length &&
        (!history.forecastVintages.length ||
          !last(history.forecastVintages).series.length ||
          Date.now() - Date.parse(last(history.forecastVintages).capturedAt) >
            3600000)
      ) {
        history.forecastVintages.push({
          capturedAt: now,
          series: d?.currentDay?.data || [],
          nextDay: d?.nextDay?.data || [],
        });
        history.forecastVintages = history.forecastVintages.slice(-720);
      }
      save("feeds", feeds);
      save("history", history);
      await updateNodes();
      save('feeds',feeds);
      enrichment = Promise.all([
        updateReports(),
        updateAssets(),
        updateWeather(),
      ]);
      enrichment.catch(console.error);
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  function current() {
    const demand = history.demand || [],
      latestDemand = last(demand.filter((r) => r.actual !== null));
    const supply = last(history.supply),
      fuel = last(history.fuel),
      prices = last(history.prices),
      storage = last(history.storage);
    const reference = latestDemand?.timestamp;
    const previous = reference
      ? demand.find(
          (r) =>
            r.timestamp?.slice(0, 10) ===
              ctDay(new Date(Date.parse(iso(reference)) - 86400000)) &&
            r.timestamp.slice(11, 16) === reference.slice(11, 16),
        )
      : null;
    const previousFuel = fuel
      ? (history.fuel || []).find(
          (r) =>
            r.timestamp.slice(0, 10) ===
              ctDay(new Date(Date.parse(iso(fuel.timestamp)) - 86400000)) &&
            r.timestamp.slice(11, 16) === fuel.timestamp.slice(11, 16),
        )
      : null;
    const currentPriceDay = prices?.timestamp.slice(0, 10);
    const latestOut = Object.values(feeds.outages?.payload?.current || {}).at(
      -1,
    );
    return {
      fetchedAt: new Date().toISOString(),
      sources: Object.fromEntries(
        Object.entries(feeds).map(([k, v]) => [
          k,
          {
            ok: v.ok,
            lastUpdated: v.lastUpdated,
            fetchedAt: v.fetchedAt,
            error: v.error,
          },
        ]),
      ),
      current: {
        prices,
        demand: latestDemand,
        supply,
        fuel,
        storage,
        condition: feeds.reserves?.payload?.current_condition,
        prc: last(feeds.reserves?.payload?.data)?.prc,
        outages: latestOut,
      },
      previous: { demand: previous, fuel: previousFuel },
      series: {
        prices: history.prices || [],
        dam: feeds.prices?.payload?.damSppData || [],
        demand: history.demand || [],
        supply: history.supply || [],
        fuel: history.fuel || [],
        storage: history.storage || [],
        reserves: history.reserves || [],
        ancillary: history.ancillary || [],
      },
      reports,
      days: [
        ...new Set((history.prices || []).map((r) => r.timestamp.slice(0, 10))),
      ].reverse(),
      operatingDay: currentPriceDay,
      forecastVintages: history.forecastVintages?.slice(-48) || [],
      nodes,
      geometry: geography,
      resources,
      weather,
      historyStarted: history.prices?.[0]?.timestamp,
    };
  }
  const timer = setInterval(() => refresh().catch(console.error), 60000);
  timer.unref();
  let enrichment = Promise.resolve();
  async function collectAll() {
    await refresh();
    await enrichment;
    return current();
  }
  return { refresh, collectAll, current, n, rows };
};

module.exports.numberOrNull = n;
module.exports.reportRows = rows;
