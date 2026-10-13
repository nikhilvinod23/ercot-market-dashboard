const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { URL } = require("node:url");

const ROOT = __dirname;
const ERCOT_API_ROOT = "https://api.ercot.com/api/public-reports";
const ERCOT_AUTH_URL =
  "https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token";
const ERCOT_CLIENT_ID = "fec253ea-0d06-4272-a5e6-b478baeecd70";
const ERCOT_SCOPE =
  "openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access";
const cache = new Map();
const LIVE_CACHE_KEY = "__normalized-live-dashboard__";
const LIVE_SOURCES = {
  fuelMix: "https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json",
  prices:
    "https://www.ercot.com/api/1/services/read/dashboards/system-wide-prices.json",
  demand:
    "https://www.ercot.com/api/1/services/read/dashboards/system-wide-demand.json",
  outages:
    "https://www.ercot.com/api/1/services/read/dashboards/generation-outages.json",
  storage:
    "https://www.ercot.com/api/1/services/read/dashboards/energy-storage-resources.json",
  reserve:
    "https://www.ercot.com/api/1/services/read/dashboards/daily-prc.json",
};

loadDotEnv();
const PORT = Number(process.env.PORT || 8000);

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith("#") || process.env[match[1]]) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (
      JSON.parse(Buffer.from(payload, "base64").toString("utf8")).exp * 1000
    );
  } catch {
    return 0;
  }
}

class ErcotTokenManager {
  constructor() {
    this.token = process.env.ERCOT_ID_TOKEN || "";
    this.expiresAt = jwtExpiry(this.token);
    this.refreshing = null;
  }

  mode() {
    if (process.env.ERCOT_USERNAME && process.env.ERCOT_PASSWORD)
      return "automatic";
    if (this.token) return "manual-token";
    return "missing";
  }

  async getToken() {
    if (!process.env.ERCOT_SUBSCRIPTION_KEY)
      throw new Error("ERCOT_SUBSCRIPTION_KEY is not configured.");
    if (this.token && this.expiresAt > Date.now() + 120000) return this.token;
    if (!process.env.ERCOT_USERNAME || !process.env.ERCOT_PASSWORD) {
      throw new Error(
        "ERCOT_ID_TOKEN is missing or expired. Add ERCOT_USERNAME and ERCOT_PASSWORD for automatic token renewal.",
      );
    }
    if (!this.refreshing)
      this.refreshing = this.authenticate().finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async authenticate() {
    const body = new URLSearchParams({
      username: process.env.ERCOT_USERNAME,
      password: process.env.ERCOT_PASSWORD,
      grant_type: "password",
      scope: ERCOT_SCOPE,
      client_id: ERCOT_CLIENT_ID,
      response_type: "id_token",
    });
    const response = await fetchWithTimeout(ERCOT_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await readResponse(response);
    if (!response.ok)
      throw new Error(`ERCOT authentication failed (${response.status}).`);
    const token = payload.id_token || payload.access_token;
    if (!token)
      throw new Error("ERCOT authentication response did not include a token.");
    this.token = token;
    this.expiresAt = jwtExpiry(token) || Date.now() + 3600000;
    return token;
  }
}

const tokenManager = new ErcotTokenManager();
const marketData = require("./market-data")({
  fetchPublicJson,
  fetchErcot,
  fetchWithTimeout,
});

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") || "";
  if (
    contentType.includes("json") ||
    text.trim().startsWith("{") ||
    text.trim().startsWith("[")
  ) {
    try {
      return JSON.parse(text);
    } catch {
      /* return the raw payload below */
    }
  }
  return { contentType, raw: text };
}

async function fetchErcot(url, cacheSeconds = 30) {
  const cacheKey = String(url);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const token = await tokenManager.getToken();
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": process.env.ERCOT_SUBSCRIPTION_KEY,
      Accept: "application/json, text/plain, */*",
    },
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    const detail = payload?.error_description || payload?.error || payload?.raw;
    throw new Error(
      `ERCOT request failed (${response.status})${detail ? `: ${String(detail).slice(0, 180)}` : "."}`,
    );
  }
  cache.set(cacheKey, {
    value: payload,
    expiresAt: Date.now() + cacheSeconds * 1000,
  });
  return payload;
}

async function fetchPublicJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  });
  const payload = await readResponse(response);
  if (!response.ok)
    throw new Error(`Public ERCOT feed failed (${response.status}).`);
  return payload;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestObjectValue(object) {
  if (!object || typeof object !== "object") return null;
  const keys = Object.keys(object).sort();
  return keys.length ? object[keys[keys.length - 1]] : null;
}

function sourceMeta(payload, lastUpdated) {
  return { ok: Boolean(payload), lastUpdated: lastUpdated || null };
}

function normalizeFuelMix(payload) {
  const date = Object.keys(payload?.data || {})
    .sort()
    .at(-1);
  const day = date ? payload.data[date] : null;
  const timestamp = day ? Object.keys(day).sort().at(-1) : null;
  const reading = timestamp ? day[timestamp] : null;
  const excluded = new Set([
    "Power Storage Charging",
    "Power Storage Discharging",
  ]);
  const generation = Object.entries(reading || {})
    .filter(
      ([label, item]) =>
        !excluded.has(label) && numberOrNull(item?.gen) !== null,
    )
    .map(([label, item]) => ({ label, mw: numberOrNull(item.gen) }))
    .filter((item) => item.mw >= 0);
  const totalMw = generation.reduce((sum, item) => sum + item.mw, 0);
  return {
    timestamp,
    totalMw,
    generation: generation.map((item) => ({
      ...item,
      share: totalMw ? (item.mw / totalMw) * 100 : 0,
    })),
    capacity: payload?.monthlyCapacity || {},
  };
}

function normalizePrices(payload) {
  const series = (payload?.rtSppData || []).slice(-96).map((item) => ({
    timestamp: item.timestamp,
    intervalEnding: item.intervalEnding,
    houston: numberOrNull(item.hbHouston),
    north: numberOrNull(item.hbNorth),
    south: numberOrNull(item.hbSouth),
    west: numberOrNull(item.hbWest),
    hub: numberOrNull(item.hbHubAvg),
  }));
  return {
    lastUpdated: payload?.lastUpdated || null,
    latest: series.at(-1) || null,
    series,
  };
}

function normalizeDemand(payload) {
  const day = payload?.currentDay;
  const series = (day?.data || []).map((item) => ({
    timestamp: item.timestamp,
    hourEnding: item.hourEnding,
    loadForecast: numberOrNull(item.currentLoadForecast),
    dayAheadForecast: numberOrNull(item.dayAheadForecast),
    capacity: numberOrNull(item.currentDayHsl),
  }));
  return {
    lastUpdated: payload?.lastUpdated || null,
    dayDate: day?.dayDate || null,
    latest: series.at(-1) || null,
    series,
  };
}

function normalizeOutages(payload) {
  const latest = latestObjectValue(payload?.current);
  return {
    lastUpdated: payload?.lastUpdated || null,
    totalMw: numberOrNull(payload?.currentOutages),
    latest: latest
      ? {
          deliveryTime: latest.deliveryTime,
          combined: latest.Combined || null,
          dispatchable: latest.Dispatchable || null,
          renewable: latest.Renewable || null,
        }
      : null,
  };
}

function normalizeStorage(payload) {
  const series = (payload?.currentDay?.data || []).slice(-96).map((item) => ({
    timestamp: item.timestamp,
    charging: numberOrNull(item.totalCharging),
    discharging: numberOrNull(item.totalDischarging),
    netOutput: numberOrNull(item.netOutput),
  }));
  return {
    lastUpdated: payload?.lastUpdated || null,
    latest: series.at(-1) || null,
    series,
  };
}

function normalizeReserve(payload) {
  const series = (payload?.data || []).slice(-96).map((item) => ({
    timestamp: item.timestamp,
    mw: numberOrNull(item.prc),
  }));
  return {
    lastUpdated: payload?.lastUpdated || null,
    condition: payload?.current_condition || null,
    latest: series.at(-1) || null,
    series,
  };
}

async function getLiveDashboard() {
  const cached = cache.get(LIVE_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const entries = await Promise.all(
    Object.entries(LIVE_SOURCES).map(async ([name, url]) => {
      try {
        return [name, { ok: true, payload: await fetchPublicJson(url) }];
      } catch (error) {
        return [name, { ok: false, error: error.message }];
      }
    }),
  );
  const feeds = Object.fromEntries(entries);
  const fuel = feeds.fuelMix.ok
    ? normalizeFuelMix(feeds.fuelMix.payload)
    : null;
  const prices = feeds.prices.ok ? normalizePrices(feeds.prices.payload) : null;
  const demand = feeds.demand.ok ? normalizeDemand(feeds.demand.payload) : null;
  const outages = feeds.outages.ok
    ? normalizeOutages(feeds.outages.payload)
    : null;
  const storage = feeds.storage.ok
    ? normalizeStorage(feeds.storage.payload)
    : null;
  const reserve = feeds.reserve.ok
    ? normalizeReserve(feeds.reserve.payload)
    : null;
  const result = {
    fetchedAt: new Date().toISOString(),
    sources: {
      fuelMix: feeds.fuelMix.ok
        ? sourceMeta(feeds.fuelMix.payload, feeds.fuelMix.payload.lastUpdated)
        : { ok: false, error: feeds.fuelMix.error },
      prices: feeds.prices.ok
        ? sourceMeta(feeds.prices.payload, feeds.prices.payload.lastUpdated)
        : { ok: false, error: feeds.prices.error },
      demand: feeds.demand.ok
        ? sourceMeta(feeds.demand.payload, feeds.demand.payload.lastUpdated)
        : { ok: false, error: feeds.demand.error },
      outages: feeds.outages.ok
        ? sourceMeta(feeds.outages.payload, feeds.outages.payload.lastUpdated)
        : { ok: false, error: feeds.outages.error },
      storage: feeds.storage.ok
        ? sourceMeta(feeds.storage.payload, feeds.storage.payload.lastUpdated)
        : { ok: false, error: feeds.storage.error },
      reserve: feeds.reserve.ok
        ? sourceMeta(feeds.reserve.payload, feeds.reserve.payload.lastUpdated)
        : { ok: false, error: feeds.reserve.error },
    },
    fuel,
    prices,
    demand,
    outages,
    storage,
    reserve,
  };
  cache.set(LIVE_CACHE_KEY, { value: result, expiresAt: Date.now() + 30000 });
  return result;
}

function validProductId(value) {
  return /^[a-z0-9-]+$/i.test(value || "");
}

function productFromPayload(payload) {
  return (
    payload?._embedded?.product || payload?._embedded?.products?.[0] || payload
  );
}

async function getProduct(emilId) {
  if (!validProductId(emilId)) throw new Error("Invalid EMIL product ID.");
  return productFromPayload(
    await fetchErcot(
      `${ERCOT_API_ROOT}/${encodeURIComponent(emilId.toLowerCase())}`,
      60,
    ),
  );
}

async function getArtifact(emilId, artifactIndex, searchParams) {
  const product = await getProduct(emilId);
  const artifacts = product?.artifacts || product?._embedded?.artifacts || [];
  const artifact = artifacts[Number(artifactIndex) || 0];
  const endpoint = artifact?._links?.endpoint?.href;
  if (!endpoint)
    throw new Error(
      `No artifact endpoint was found for ${emilId}. Inspect /api/ercot/product first.`,
    );
  const artifactUrl = new URL(endpoint);
  for (const [key, value] of searchParams) {
    if (!["emilId", "artifact"].includes(key))
      artifactUrl.searchParams.set(key, value);
  }
  return {
    product,
    artifact,
    data: await fetchErcot(artifactUrl.toString(), 15),
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function contentType(filePath) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[path.extname(filePath)] || "application/octet-stream"
  );
}

function serveStatic(req, res, pathname) {
  const relative =
    pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const publicData =
    /^data\/(?:[A-Za-z0-9_-]+\.(?:json|csv|md|png)|reports\/[A-Za-z0-9_-]+\.json)$/.test(
      relative,
    );
  if (
    !publicData &&
    ![
      "index.html",
      "app.js",
      "styles.css",
      "charts.js",
      "maps.js",
      "analytics.js",
      "extensions.js",
      "predictions.js",
      "icons.js",
    ].includes(relative)
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (
    !relative ||
    relative.startsWith(".") ||
    relative.includes("..") ||
    relative === "server.js"
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path.resolve(
    publicData ? path.join(ROOT, "public") : ROOT,
    relative,
  );
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

async function handleApi(req, res, requestUrl) {
  if (requestUrl.pathname === "/api/health") {
    const configured = Boolean(
      process.env.ERCOT_SUBSCRIPTION_KEY &&
        (tokenManager.token ||
          (process.env.ERCOT_USERNAME && process.env.ERCOT_PASSWORD)),
    );
    let authentication = null;
    if (requestUrl.searchParams.get("probe") === "1") {
      try {
        await tokenManager.getToken();
        authentication = { ok: true, mode: tokenManager.mode() };
      } catch (error) {
        authentication = { ok: false, error: error.message };
      }
    }
    return json(res, 200, {
      ok: true,
      configured,
      tokenMode: tokenManager.mode(),
      tokenExpiresAt: tokenManager.expiresAt || null,
      cacheEntries: cache.size,
      authentication,
    });
  }
  try {
    if (requestUrl.pathname === "/api/market")
      return json(res, 200, marketData.current());
    if (requestUrl.pathname === "/api/refresh") {
      await marketData.refresh();
      return json(res, 200, marketData.current());
    }
    if (requestUrl.pathname === "/api/contour") {
      const upstream = await fetchWithTimeout(
        "https://www.ercot.com/content/cdr/contours/rtmLmp.png",
      );
      if (!upstream.ok)
        return json(res, 502, { error: "Map image unavailable" });
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "max-age=300",
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    if (requestUrl.pathname === "/api/live")
      return json(res, 200, await getLiveDashboard());
    if (requestUrl.pathname === "/api/ercot/products")
      return json(res, 200, await fetchErcot(ERCOT_API_ROOT, 60));
    if (requestUrl.pathname === "/api/ercot/product")
      return json(
        res,
        200,
        await getProduct(requestUrl.searchParams.get("emilId")),
      );
    if (requestUrl.pathname === "/api/ercot/report")
      return json(
        res,
        200,
        await getArtifact(
          requestUrl.searchParams.get("emilId"),
          requestUrl.searchParams.get("artifact"),
          requestUrl.searchParams,
        ),
      );
    return json(res, 404, { error: "Unknown API route." });
  } catch (error) {
    const status =
      /not configured|missing or expired|authentication failed/i.test(
        error.message,
      )
        ? 401
        : 502;
    return json(res, status, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "127.0.0.1"}`,
  );
  if (requestUrl.pathname.startsWith("/api/"))
    return handleApi(req, res, requestUrl);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }
  serveStatic(req, res, requestUrl.pathname);
});

module.exports = { marketData, fetchWithTimeout };
if (require.main === module) {
  server.listen(PORT, "127.0.0.1", () =>
    console.log(`ERCOT dashboard listening at http://127.0.0.1:${PORT}`),
  );
  marketData.refresh().catch(console.error);
  const { spawn } = require("node:child_process");
  let collecting = false;
  const collect = () => {
    if (collecting || process.env.ARCHIVE_COLLECTOR === "off") return;
    collecting = true;
    const child = spawn(
      process.env.PYTHON_EXECUTABLE || "python",
      ["-m", "pipeline.collect", "--history-days", "7"],
      { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
    );
    child.on("error", () => {
      collecting = false;
      console.error("Python collector unavailable. See README setup.");
    });
    child.on("exit", () => {
      collecting = false;
    });
  };
  collect();
  setInterval(collect, 3600000).unref();
}
