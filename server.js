const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { URL } = require('node:url');

const ROOT = __dirname;
const ERCOT_API_ROOT = 'https://api.ercot.com/api/public-reports';
const ERCOT_AUTH_URL = 'https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token';
const ERCOT_CLIENT_ID = 'fec253ea-0d06-4272-a5e6-b478baeecd70';
const ERCOT_SCOPE = 'openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access';
const cache = new Map();

loadDotEnv();
const PORT = Number(process.env.PORT || 8000);

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match || match[1].startsWith('#') || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function jwtExpiry(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).exp * 1000;
  } catch {
    return 0;
  }
}

class ErcotTokenManager {
  constructor() {
    this.token = process.env.ERCOT_ID_TOKEN || '';
    this.expiresAt = jwtExpiry(this.token);
    this.refreshing = null;
  }

  mode() {
    if (process.env.ERCOT_USERNAME && process.env.ERCOT_PASSWORD) return 'automatic';
    if (this.token) return 'manual-token';
    return 'missing';
  }

  async getToken() {
    if (!process.env.ERCOT_SUBSCRIPTION_KEY) throw new Error('ERCOT_SUBSCRIPTION_KEY is not configured.');
    if (this.token && this.expiresAt > Date.now() + 120000) return this.token;
    if (!process.env.ERCOT_USERNAME || !process.env.ERCOT_PASSWORD) {
      throw new Error('ERCOT_ID_TOKEN is missing or expired. Add ERCOT_USERNAME and ERCOT_PASSWORD for automatic token renewal.');
    }
    if (!this.refreshing) this.refreshing = this.authenticate().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async authenticate() {
    const body = new URLSearchParams({
      username: process.env.ERCOT_USERNAME,
      password: process.env.ERCOT_PASSWORD,
      grant_type: 'password',
      scope: ERCOT_SCOPE,
      client_id: ERCOT_CLIENT_ID,
      response_type: 'id_token',
    });
    const response = await fetchWithTimeout(ERCOT_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await readResponse(response);
    if (!response.ok) throw new Error(`ERCOT authentication failed (${response.status}).`);
    const token = payload.id_token || payload.access_token;
    if (!token) throw new Error('ERCOT authentication response did not include a token.');
    this.token = token;
    this.expiresAt = jwtExpiry(token) || Date.now() + 3600000;
    return token;
  }
}

const tokenManager = new ErcotTokenManager();

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
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { return JSON.parse(text); } catch { /* return the raw payload below */ }
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
      'Ocp-Apim-Subscription-Key': process.env.ERCOT_SUBSCRIPTION_KEY,
      Accept: 'application/json, text/plain, */*',
    },
  });
  const payload = await readResponse(response);
  if (!response.ok) throw new Error(`ERCOT request failed (${response.status}).`);
  cache.set(cacheKey, { value: payload, expiresAt: Date.now() + cacheSeconds * 1000 });
  return payload;
}

function validProductId(value) {
  return /^[a-z0-9-]+$/i.test(value || '');
}

function productFromPayload(payload) {
  return payload?._embedded?.product || payload?._embedded?.products?.[0] || payload;
}

async function getProduct(emilId) {
  if (!validProductId(emilId)) throw new Error('Invalid EMIL product ID.');
  return productFromPayload(await fetchErcot(`${ERCOT_API_ROOT}/${encodeURIComponent(emilId.toLowerCase())}`, 60));
}

async function getArtifact(emilId, artifactIndex, searchParams) {
  const product = await getProduct(emilId);
  const artifacts = product?.artifacts || product?._embedded?.artifacts || [];
  const artifact = artifacts[Number(artifactIndex) || 0];
  const endpoint = artifact?._links?.endpoint?.href;
  if (!endpoint) throw new Error(`No artifact endpoint was found for ${emilId}. Inspect /api/ercot/product first.`);
  const artifactUrl = new URL(endpoint);
  for (const [key, value] of searchParams) {
    if (!['emilId', 'artifact'].includes(key)) artifactUrl.searchParams.set(key, value);
  }
  return { product, artifact, data: await fetchErcot(artifactUrl.toString(), 15) };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function contentType(filePath) {
  return { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }[path.extname(filePath)] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  if (!relative || relative.startsWith('.') || relative.includes('..') || relative === 'server.js') {
    res.writeHead(404); res.end('Not found'); return;
  }
  const filePath = path.resolve(ROOT, relative);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
    res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

async function handleApi(req, res, requestUrl) {
  if (requestUrl.pathname === '/api/health') {
    const configured = Boolean(process.env.ERCOT_SUBSCRIPTION_KEY && (tokenManager.token || (process.env.ERCOT_USERNAME && process.env.ERCOT_PASSWORD)));
    return json(res, 200, { ok: true, configured, tokenMode: tokenManager.mode(), tokenExpiresAt: tokenManager.expiresAt || null, cacheEntries: cache.size });
  }
  try {
    if (requestUrl.pathname === '/api/ercot/products') return json(res, 200, await fetchErcot(ERCOT_API_ROOT, 60));
    if (requestUrl.pathname === '/api/ercot/product') return json(res, 200, await getProduct(requestUrl.searchParams.get('emilId')));
    if (requestUrl.pathname === '/api/ercot/report') return json(res, 200, await getArtifact(requestUrl.searchParams.get('emilId'), requestUrl.searchParams.get('artifact'), requestUrl.searchParams));
    return json(res, 404, { error: 'Unknown API route.' });
  } catch (error) {
    const status = /not configured|missing or expired|authentication failed/i.test(error.message) ? 401 : 502;
    return json(res, status, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (requestUrl.pathname.startsWith('/api/')) return handleApi(req, res, requestUrl);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  serveStatic(req, res, requestUrl.pathname);
});

server.listen(PORT, '127.0.0.1', () => console.log(`ERCOT dashboard listening at http://127.0.0.1:${PORT}`));
