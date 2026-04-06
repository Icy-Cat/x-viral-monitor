const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};

function normalizeThresholds(raw) {
  const trending = Number.parseInt(raw?.trending, 10);
  const viral = Number.parseInt(raw?.viral, 10);
  const next = {
    trending: Number.isFinite(trending) && trending > 0 ? trending : DEFAULT_THRESHOLDS.trending,
    viral: Number.isFinite(viral) && viral > 0 ? viral : DEFAULT_THRESHOLDS.viral,
  };
  if (next.viral <= next.trending) {
    next.viral = Math.max(next.trending + 1, DEFAULT_THRESHOLDS.viral);
  }
  return next;
}

function pushSettings(raw) {
  window.postMessage({
    type: 'XVM_SETTINGS_UPDATE',
    thresholds: normalizeThresholds(raw),
  }, '*');
}

chrome.storage.sync.get(DEFAULT_THRESHOLDS, (items) => {
  pushSettings(items);
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_REQUEST_SETTINGS') return;

  chrome.storage.sync.get(DEFAULT_THRESHOLDS, (items) => {
    pushSettings(items);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (!changes.trending && !changes.viral) return;

  chrome.storage.sync.get(DEFAULT_THRESHOLDS, (items) => {
    pushSettings(items);
  });
});

// === Collection mode: relay messages between content.js (MAIN) ↔ background/sidePanel ===

// From sidePanel (via background) → content.js (MAIN world)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'XVM_START_COLLECT' || msg.type === 'XVM_STOP_COLLECT') {
    window.postMessage(msg, '*');
  }
});

// From content.js (MAIN world) → sidePanel (via background)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'XVM_COLLECT_DATA' || event.data?.type === 'XVM_SCROLL_DONE') {
    chrome.runtime.sendMessage({ ...event.data, target: 'sidepanel' });
  }
});
