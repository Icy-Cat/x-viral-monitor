const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

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
    featureVelocityLeaderboard: !!raw?.featureVelocityLeaderboard,
  }, '*');
}

// Guard all chrome.* calls against extension context invalidation
// (happens when extension is reloaded while page is still open)
function safeChromeCall(fn) {
  try {
    if (chrome?.runtime?.id) fn();
  } catch (e) {}
}

safeChromeCall(() => {
  chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
    pushSettings(items);
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_REQUEST_SETTINGS') return;

  safeChromeCall(() => {
    chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
      pushSettings(items);
    });
  });
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard) return;

    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
    });
  });
});
