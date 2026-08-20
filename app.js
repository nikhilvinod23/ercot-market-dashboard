const toast = document.querySelector('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

document.querySelectorAll('[data-toast]').forEach((button) => {
  button.addEventListener('click', () => showToast(button.dataset.toast));
});

document.querySelectorAll('.range-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.range-tab').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    showToast(`${tab.textContent} view selected. Demo values remain unchanged.`);
  });
});

const viewCopy = {
  overview: { label: 'Overview', title: 'Good afternoon, Alex.', copy: 'A quick read on the ERCOT market, from system demand to real-time pricing.' },
  prices: { label: 'Prices', title: 'Prices across the ERCOT system.', copy: 'Compare real-time and day-ahead pricing from the system level down to individual locations.' },
  demand: { label: 'Demand & load', title: 'Demand is building toward the evening peak.', copy: 'Track current system demand against forecasts and the evening peak window.' },
  supply: { label: 'Supply', title: 'See what is powering Texas.', copy: 'Follow the generation stack, renewable forecast variance, and storage dispatch.' },
  reliability: { label: 'Reliability', title: 'Keep an eye on grid headroom.', copy: 'Monitor available capacity, ancillary services, operating reserves, and adequacy.' },
  congestion: { label: 'Congestion & events', title: 'Find the story behind the spread.', copy: 'Investigate binding constraints, market notices, and price corrections.' },
};

function selectView(viewName, updateHash = true) {
  const selected = viewCopy[viewName] ? viewName : 'overview';
  const copy = viewCopy[selected];
  document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.toggle('active', navItem.dataset.view === selected));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === selected));
  document.querySelector('#breadcrumb-section').textContent = copy.label;
  document.querySelector('#page-title').textContent = copy.title;
  document.querySelector('#heading-copy').textContent = copy.copy;
  if (updateHash) window.history.replaceState(null, '', `#view-${selected}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    selectView(item.dataset.view);
  });
});

document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
    chip.classList.add('active');
    showToast(`${chip.textContent} layer selected. Demo values remain unchanged.`);
  });
});

const initialView = window.location.hash.replace('#view-', '');
selectView(viewCopy[initialView] ? initialView : 'overview', false);

document.querySelector('#refresh-button').addEventListener('click', () => {
  showToast('View refreshed. Live data connections are not configured yet.');
});
