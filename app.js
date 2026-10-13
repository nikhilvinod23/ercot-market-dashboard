const state = { data: null, activeView: 'overview', loading: false };
const toast = document.querySelector('#toast');
let toastTimer;

const viewCopy = {
  overview: { label: 'Overview', title: 'Market overview', copy: 'Real-time operating conditions, price signals, and supply movement.' },
  prices: { label: 'Prices', title: 'Price explorer', copy: 'Track hub and zone prices across the latest ERCOT intervals.' },
  demand: { label: 'Demand & load', title: 'Demand and load', copy: 'Compare the current load forecast with day-ahead expectations.' },
  supply: { label: 'Supply', title: 'Supply stack', copy: 'See what is generating, offline, and moving through storage.' },
  reliability: { label: 'Reliability', title: 'Reliability monitor', copy: 'Follow reserve conditions, outages, and system headroom.' },
  congestion: { label: 'Congestion', title: 'Spread monitor', copy: 'Surface location-driven price separation from the live price feed.' },
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function number(value, decimals = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function mw(value, decimals = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return `${number(parsed, decimals)} MW`;
}

function price(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `$${number(parsed, 2)}` : '—';
}

function percent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${number(parsed, 1)}%` : '—';
}

function signedPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return `${parsed >= 0 ? '+' : '−'}${price(Math.abs(parsed))}`;
}

function timeLabel(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateLabel(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function liveBadge(text = 'Live') {
  return `<span class="live-badge"><i class="live-dot"></i>${escapeHtml(text)}</span>`;
}

function emptyState(message = 'No live reading available') {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function lineChart(series, keys, colors, formatter = (value) => number(value), options = {}) {
  const width = 860;
  const height = options.height || 250;
  const allValues = series.flatMap((item) => keys.map((key) => Number(item[key])).filter(Number.isFinite));
  if (!allValues.length) return emptyState('No live series available');
  const min = options.zero ? 0 : Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(max - min, 1);
  const pad = span * 0.12;
  const low = min - (options.zero ? 0 : pad);
  const high = max + pad;
  const x = (index) => series.length === 1 ? width / 2 : (index / (series.length - 1)) * width;
  const y = (value) => height - ((value - low) / (high - low)) * (height - 22) - 10;
  const guides = [0, 0.33, 0.66, 1].map((ratio) => {
    const value = high - ratio * (high - low);
    const lineY = y(value);
    return `<line x1="0" y1="${lineY.toFixed(1)}" x2="${width}" y2="${lineY.toFixed(1)}" class="chart-grid"/><text x="0" y="${(lineY - 6).toFixed(1)}" class="chart-axis-label">${escapeHtml(formatter(value))}</text>`;
  }).join('');
  const paths = keys.map((key, index) => {
    const points = series.map((item, pointIndex) => `${x(pointIndex).toFixed(1)},${y(Number(item[key])).toFixed(1)}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${colors[index]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  const legend = keys.map((key, index) => `<span><i style="background:${colors[index]}"></i>${escapeHtml(options.labels?.[key] || key)}</span>`).join('');
  return `<div class="chart-shell"><svg class="data-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Live market series">${guides}${paths}</svg><div class="chart-legend">${legend}</div><div class="chart-scale"><span>${timeLabel(series[0].timestamp)}</span><span>${timeLabel(series[Math.floor(series.length / 2)].timestamp)}</span><span>${timeLabel(series.at(-1).timestamp)}</span></div></div>`;
}

function horizontalBars(items, maxValue, formatter = (value) => mw(value)) {
  if (!items.length) return emptyState();
  return `<div class="bar-list">${items.map((item) => `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatter(item.value))}</strong></div><div class="bar-track"><i style="width:${Math.max(3, Math.min(100, (item.value / maxValue) * 100))}%"></i></div></div>`).join('')}</div>`;
}

function metricCard(label, value, detail, tone = '') {
  return `<article class="metric-card ${tone}"><span class="metric-label">${escapeHtml(label)}</span><strong>${value}</strong><span class="metric-detail">${escapeHtml(detail)}</span></article>`;
}

function panel(title, eyebrow, content, extra = '') {
  return `<article class="panel"><div class="panel-heading"><div><p class="panel-kicker">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2></div>${extra}</div>${content}</article>`;
}

function latestData() {
  const data = state.data || {};
  const latestPrice = data.prices?.latest || {};
  const latestDemand = data.demand?.latest || {};
  const latestStorage = data.storage?.latest || {};
  const latestReserve = data.reserve?.latest || {};
  const generation = data.fuel?.generation || [];
  const renewable = generation.filter((item) => ['Wind', 'Solar', 'Hydro'].includes(item.label)).reduce((sum, item) => sum + Number(item.mw || 0), 0);
  return { latestPrice, latestDemand, latestStorage, latestReserve, generation, renewable };
}

function renderOverview() {
  const data = state.data || {};
  const { latestPrice, latestDemand, latestStorage, latestReserve, generation, renewable } = latestData();
  const topGeneration = [...generation].sort((a, b) => b.mw - a.mw).slice(0, 7);
  const maxGeneration = Math.max(...topGeneration.map((item) => item.mw), 1);
  const prices = data.prices?.series || [];
  const reserve = data.reserve?.condition;
  document.querySelector('#overview-content').innerHTML = `
    <div class="metric-grid">
      ${metricCard('HB Hub average', price(latestPrice.hub), `RTM · ${timeLabel(latestPrice.timestamp)}`, 'coral')}
      ${metricCard('Load forecast', mw(latestDemand.loadForecast), `Hour ending ${latestDemand.hourEnding ?? '—'}`, 'teal')}
      ${metricCard('Renewable output', `${percent((renewable / Math.max(data.fuel?.totalMw || 1, 1)) * 100)}`, mw(renewable), 'gold')}
      ${metricCard('Reserve / PRC', mw(latestReserve.mw), reserve?.title || 'Live condition', 'purple')}
    </div>
    <div class="dashboard-grid overview-grid">
      ${panel('Hub price movement', 'Real-time price', lineChart(prices, ['hub', 'houston', 'north', 'west'], ['#e66d4a', '#2b8c88', '#7b61a8', '#d09a3d'], (value) => price(value), { labels: { hub: 'HB Hub', houston: 'Houston', north: 'North', west: 'West' } }), liveBadge('Live'))}
      ${panel('Generation stack', 'Current output', horizontalBars(topGeneration.map((item) => ({ label: item.label, value: item.mw })), maxGeneration), liveBadge('Live'))}
    </div>
    <div class="dashboard-grid overview-grid lower-grid">
      ${panel('Operating condition', 'Power balance', `<div class="condition-card"><div class="condition-state"><span class="condition-orb"></span><div><strong>${escapeHtml(reserve?.title || 'Condition unavailable')}</strong><span>${escapeHtml(reserve?.condition_note || 'No condition note available')}</span></div></div><div class="condition-metrics"><div><span>Outages</span><strong>${mw(data.outages?.totalMw)}</strong></div><div><span>Storage net</span><strong>${mw(latestStorage.netOutput)}</strong></div><div><span>EEA level</span><strong>${reserve?.eea_level ?? '—'}</strong></div></div></div>`, liveBadge('Live'))}
      ${panel('Live sources', 'Data health', sourceHealthMarkup(), `<span class="source-health-dot"></span>`)}
    </div>`;
}

function priceRows(data) {
  const latest = data.prices?.latest || {};
  const locations = [['HB_HOUSTON', latest.houston], ['HB_NORTH', latest.north], ['HB_SOUTH', latest.south], ['HB_WEST', latest.west], ['HB_HUB_AVG', latest.hub]];
  return locations.map(([label, value]) => {
    const spread = Number(value) - Number(latest.hub);
    return `<div class="data-row"><span><strong>${label}</strong><small>RTM SPP</small></span><strong>${price(value)}</strong><b class="${spread >= 0 ? 'positive' : 'negative'}">${signedPrice(spread)}</b></div>`;
  }).join('');
}

function renderPrices() {
  const data = state.data || {};
  const series = data.prices?.series || [];
  const latest = data.prices?.latest || {};
  document.querySelector('#prices-content').innerHTML = `
    <div class="metric-grid compact-metrics">
      ${metricCard('HB Hub average', price(latest.hub), timeLabel(latest.timestamp), 'coral')}
      ${metricCard('Houston spread', signedPrice(Number(latest.houston) - Number(latest.hub)), 'vs HB Hub', 'teal')}
      ${metricCard('North spread', signedPrice(Number(latest.north) - Number(latest.hub)), 'vs HB Hub', 'purple')}
      ${metricCard('West spread', signedPrice(Number(latest.west) - Number(latest.hub)), 'vs HB Hub', 'gold')}
    </div>
    <div class="dashboard-grid two-columns">
      ${panel('RTM price curve', 'Latest 24 hours', lineChart(series, ['hub', 'houston', 'north', 'south', 'west'], ['#e66d4a', '#2b8c88', '#7b61a8', '#d09a3d', '#546e7a'], (value) => price(value), { labels: { hub: 'HB Hub', houston: 'Houston', north: 'North', south: 'South', west: 'West' } }), liveBadge('Live'))}
      ${panel('Settlement points', 'Current interval', `<div class="data-table"><div class="data-row table-head"><span>Location</span><span>RTM</span><span>Δ hub</span></div>${priceRows(data)}</div><p class="data-foot">Source timestamp: ${escapeHtml(latest.timestamp || '—')}</p>`, liveBadge('Live'))}
    </div>`;
}

function renderDemand() {
  const data = state.data || {};
  const demand = data.demand || {};
  const latest = demand.latest || {};
  const maxLoad = Math.max(...(demand.series || []).map((item) => Number(item.loadForecast) || 0), 1);
  document.querySelector('#demand-content').innerHTML = `
    <div class="metric-grid compact-metrics">
      ${metricCard('Current load forecast', mw(latest.loadForecast), `HE ${latest.hourEnding ?? '—'}`, 'teal')}
      ${metricCard('Day-ahead forecast', mw(latest.dayAheadForecast), 'Current interval', 'purple')}
      ${metricCard('Forecast delta', mw(Number(latest.loadForecast) - Number(latest.dayAheadForecast)), 'Current minus DAM', 'coral')}
      ${metricCard('Available capacity', mw(latest.capacity), 'Current-day HSL', 'gold')}
    </div>
    <div class="dashboard-grid two-columns">
      ${panel('Load forecast curve', demand.dayDate || 'Current operating day', lineChart(demand.series || [], ['loadForecast', 'dayAheadForecast'], ['#2b8c88', '#7b61a8'], (value) => `${number(value / 1000, 0)}k`, { labels: { loadForecast: 'Current forecast', dayAheadForecast: 'Day-ahead' }, height: 280 }), liveBadge('Live'))}
      ${panel('Hourly outlook', 'Current day', `<div class="data-table"><div class="data-row table-head"><span>HE</span><span>Current</span><span>Day-ahead</span></div>${(demand.series || []).slice(-8).map((item) => `<div class="data-row"><span><strong>${String(item.hourEnding).padStart(2, '0')}</strong></span><span>${mw(item.loadForecast)}</span><span>${mw(item.dayAheadForecast)}</span></div>`).join('')}</div>`, liveBadge('Live'))}
    </div>`;
}

function renderSupply() {
  const data = state.data || {};
  const generation = data.fuel?.generation || [];
  const sorted = [...generation].sort((a, b) => b.mw - a.mw);
  const max = Math.max(...sorted.map((item) => item.mw), 1);
  const storage = data.storage || {};
  document.querySelector('#supply-content').innerHTML = `
    <div class="metric-grid compact-metrics">
      ${metricCard('Total generation', mw(data.fuel?.totalMw), timeLabel(data.fuel?.timestamp), 'teal')}
      ${metricCard('Wind output', mw(generation.find((item) => item.label === 'Wind')?.mw), 'Current mix', 'gold')}
      ${metricCard('Solar output', mw(generation.find((item) => item.label === 'Solar')?.mw), 'Current mix', 'coral')}
      ${metricCard('Storage net output', mw(storage.latest?.netOutput), 'Discharge minus charge', 'purple')}
    </div>
    <div class="dashboard-grid two-columns">
      ${panel('Generation by fuel', 'Current output', horizontalBars(sorted, max), liveBadge('Live'))}
      ${panel('Storage dispatch', 'Last 8 intervals', lineChart(storage.series?.slice(-8) || [], ['netOutput', 'discharging'], ['#7b61a8', '#2b8c88'], (value) => mw(value), { labels: { netOutput: 'Net output', discharging: 'Discharging' }, height: 280 }), liveBadge('Live'))}
    </div>
    <div class="dashboard-grid two-columns lower-grid">
      ${panel('Capacity reference', 'Monthly installed capacity', horizontalBars(Object.entries(data.fuel?.capacity || {}).map(([label, value]) => ({ label, value })), Math.max(...Object.values(data.fuel?.capacity || {}).map(Number), 1), (value) => mw(value)), liveBadge('Live'))}
      ${panel('Generation outages', 'Current operating day', `<div class="outage-stack"><div><span>Dispatchable</span><strong>${mw(data.outages?.latest?.dispatchable?.total)}</strong><small>${mw(data.outages?.latest?.dispatchable?.unplanned)} unplanned</small></div><div><span>Renewable</span><strong>${mw(data.outages?.latest?.renewable?.total)}</strong><small>${mw(data.outages?.latest?.renewable?.unplanned)} unplanned</small></div><div class="outage-total"><span>Total</span><strong>${mw(data.outages?.totalMw)}</strong></div></div>`, liveBadge('Live'))}
    </div>`;
}

function renderReliability() {
  const data = state.data || {};
  const reserve = data.reserve || {};
  const condition = reserve.condition || {};
  document.querySelector('#reliability-content').innerHTML = `
    <div class="metric-grid compact-metrics">
      ${metricCard('PRC', mw(reserve.latest?.mw), timeLabel(reserve.latest?.timestamp), 'teal')}
      ${metricCard('EEA level', condition.eea_level ?? '—', condition.title || 'Current condition', 'gold')}
      ${metricCard('Generation outages', mw(data.outages?.totalMw), 'Planned + unplanned', 'coral')}
      ${metricCard('Available HSL', mw(data.demand?.latest?.capacity), 'Current-day capacity', 'purple')}
    </div>
    <div class="dashboard-grid two-columns">
      ${panel('Physical responsive capability', 'PRC history', lineChart(reserve.series || [], ['mw'], ['#2b8c88'], (value) => mw(value / 1000, 0), { labels: { mw: 'PRC' }, height: 280, zero: true }), liveBadge('Live'))}
      ${panel('System condition', 'Current status', `<div class="condition-card large-condition"><div class="condition-state"><span class="condition-orb"></span><div><strong>${escapeHtml(condition.title || 'Unavailable')}</strong><span>${escapeHtml(condition.condition_note || 'No condition note available')}</span></div></div><div class="condition-level"><span>Energy level</span><strong>${condition.energy_level_value ?? '—'}</strong></div></div><div class="notice-line"><span>Last outage reading</span><strong>${escapeHtml(data.outages?.latest?.deliveryTime || '—')}</strong></div>`, liveBadge('Live'))}
    </div>`;
}

function renderCongestion() {
  const data = state.data || {};
  const latest = data.prices?.latest || {};
  const locations = [['Houston', latest.houston], ['North', latest.north], ['South', latest.south], ['West', latest.west]].filter((item) => Number.isFinite(Number(item[1])));
  const high = [...locations].sort((a, b) => b[1] - a[1]);
  document.querySelector('#congestion-content').innerHTML = `
    <div class="metric-grid compact-metrics">
      ${metricCard('Highest hub', high[0]?.[0] || '—', price(high[0]?.[1]), 'coral')}
      ${metricCard('Lowest hub', high.at(-1)?.[0] || '—', price(high.at(-1)?.[1]), 'teal')}
      ${metricCard('Max spread', signedPrice((high[0]?.[1] || 0) - (high.at(-1)?.[1] || 0)), 'Latest interval', 'gold')}
      ${metricCard('Outages in system', mw(data.outages?.totalMw), 'Context for spreads', 'purple')}
    </div>
    <div class="dashboard-grid two-columns">
      ${panel('Location spread board', 'RTM hub averages', `<div class="spread-board">${high.map(([label, value]) => `<div class="spread-row"><span>${label}</span><div class="spread-track"><i style="width:${Math.max(8, Math.min(100, ((value - (high.at(-1)?.[1] || 0)) / Math.max((high[0]?.[1] || 1) - (high.at(-1)?.[1] || 0), 1)) * 100))}%"></i></div><strong>${price(value)}</strong></div>`).join('')}</div>`, liveBadge('Live'))}
      ${panel('Price separation', 'Latest 24 hours', lineChart(data.prices?.series || [], ['houston', 'north', 'south', 'west'], ['#e66d4a', '#7b61a8', '#2b8c88', '#d09a3d'], (value) => price(value), { labels: { houston: 'Houston', north: 'North', south: 'South', west: 'West' }, height: 280 }), liveBadge('Live'))}
    </div>
    <div class="signal-strip"><span class="signal-mark">△</span><div><strong>Spread monitor</strong><p>Use the price gap and outage context to decide which locations need deeper nodal investigation.</p></div><span class="data-foot">${escapeHtml(latest.timestamp || '—')}</span></div>`;
}

function sourceHealthMarkup() {
  const sources = state.data?.sources || {};
  return `<div class="source-health-grid">${Object.entries(sources).map(([name, item]) => `<div><span class="source-health-dot ${item.ok ? 'ok' : 'bad'}"></span><span>${escapeHtml(name)}</span><strong>${item.ok ? 'OK' : '—'}</strong></div>`).join('')}</div>`;
}

function renderAll() {
  renderOverview();
  renderPrices();
  renderDemand();
  renderSupply();
  renderReliability();
  renderCongestion();
}

function updateShell() {
  const data = state.data;
  const sources = Object.values(data?.sources || {});
  const good = sources.filter((item) => item.ok).length;
  const status = good === sources.length ? 'Connected' : good ? 'Partial' : 'Offline';
  document.querySelector('#connection-label').textContent = status;
  document.querySelector('#source-count').textContent = `${good}/${sources.length}`;
  document.querySelector('#source-list').innerHTML = Object.entries(data?.sources || {}).map(([name, item]) => `<div><span class="source-health-dot ${item.ok ? 'ok' : 'bad'}"></span><span>${escapeHtml(name)}</span></div>`).join('');
  document.querySelector('#source-updated').textContent = `Fetched ${timeLabel(data?.fetchedAt)}`;
  document.querySelector('#last-sync').textContent = `Synced ${timeLabel(data?.fetchedAt)}`;
  document.querySelector('#footer-sync').textContent = `Updated ${timeLabel(data?.fetchedAt)}`;
  document.querySelector('#snapshot-date').textContent = dateLabel(data?.fetchedAt);
  document.querySelector('#snapshot-time').textContent = `Live snapshot · ${timeLabel(data?.fetchedAt)} CT`;
  document.querySelector('#global-error').hidden = good > 0;
  document.querySelector('#global-error').textContent = 'ERCOT feeds are unavailable. Try refresh again.';
}

function selectView(viewName, updateHash = true) {
  const selected = viewCopy[viewName] ? viewName : 'overview';
  state.activeView = selected;
  const copy = viewCopy[selected];
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === selected));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === selected));
  document.querySelector('#breadcrumb-section').textContent = copy.label;
  document.querySelector('#page-title').textContent = copy.title;
  document.querySelector('#heading-copy').textContent = copy.copy;
  if (updateHash) window.history.replaceState(null, '', `#view-${selected}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadLiveData() {
  if (state.loading) return;
  state.loading = true;
  document.querySelector('#refresh-button').classList.add('is-loading');
  try {
    const response = await fetch('/api/live', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Live feed request failed (${response.status})`);
    state.data = await response.json();
    updateShell();
    renderAll();
    showToast('Live ERCOT data refreshed');
  } catch (error) {
    document.querySelector('#global-error').hidden = false;
    document.querySelector('#global-error').textContent = error.message;
    showToast('Live data refresh failed');
  } finally {
    state.loading = false;
    document.querySelector('#refresh-button').classList.remove('is-loading');
  }
}

document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', (event) => {
  event.preventDefault();
  selectView(item.dataset.view);
}));

document.querySelector('#refresh-button').addEventListener('click', loadLiveData);
window.addEventListener('hashchange', () => selectView(window.location.hash.replace('#view-', ''), false));

const initialView = window.location.hash.replace('#view-', '');
selectView(viewCopy[initialView] ? initialView : 'overview', false);
loadLiveData();
window.setInterval(loadLiveData, 60000);
