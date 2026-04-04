const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const resetButton = document.getElementById('reset');
const statusEl = document.getElementById('status');

function normalizeThresholds(raw) {
  const trending = Number.parseInt(raw?.trending, 10);
  const viral = Number.parseInt(raw?.viral, 10);
  const next = {
    trending: Number.isFinite(trending) && trending > 0 ? trending : DEFAULT_THRESHOLDS.trending,
    viral: Number.isFinite(viral) && viral > 0 ? viral : DEFAULT_THRESHOLDS.viral,
  };
  if (next.viral <= next.trending) {
    next.viral = next.trending + 1;
  }
  return next;
}

function renderStatus(message) {
  statusEl.textContent = message;
  window.clearTimeout(renderStatus.timeoutId);
  renderStatus.timeoutId = window.setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
}

function fillForm(values) {
  trendingInput.value = values.trending;
  viralInput.value = values.viral;
}

chrome.storage.sync.get(DEFAULT_THRESHOLDS, (items) => {
  fillForm(normalizeThresholds(items));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = normalizeThresholds({
    trending: trendingInput.value,
    viral: viralInput.value,
  });
  fillForm(values);
  chrome.storage.sync.set(values, () => {
    renderStatus('已保存');
  });
});

resetButton.addEventListener('click', () => {
  fillForm(DEFAULT_THRESHOLDS);
  chrome.storage.sync.set(DEFAULT_THRESHOLDS, () => {
    renderStatus('已恢复默认');
  });
});
