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

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
    item.classList.add('active');
  });
});

document.querySelector('#refresh-button').addEventListener('click', () => {
  showToast('View refreshed. Live data connections are not configured yet.');
});
