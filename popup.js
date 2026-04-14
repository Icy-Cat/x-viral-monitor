const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };
const DEFAULT_FEATURES = { featureBookmarkFolders: false };
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const bookmarkToggle = document.getElementById('feat-bookmark-folders');
const bookmarkRow = document.getElementById('feature-row-bookmark');
const cacheInfoEl = document.getElementById('folder-cache-info');
const refreshBtn = document.getElementById('refresh-folders');

function normalize(raw) {
  const trending = parseInt(raw?.trending, 10);
  const viral = parseInt(raw?.viral, 10);
  const next = {
    trending: Number.isFinite(trending) && trending > 0 ? trending : DEFAULT_THRESHOLDS.trending,
    viral: Number.isFinite(viral) && viral > 0 ? viral : DEFAULT_THRESHOLDS.viral,
  };
  if (next.viral <= next.trending) next.viral = next.trending + 1;
  return next;
}

function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(0) + 'k' : n.toString(); }

function updateRangeLabels(v) {
  document.getElementById('range-green').textContent = `< ${fmtNum(v.trending)}/h`;
  document.getElementById('range-orange').textContent = `${fmtNum(v.trending)} ~ ${fmtNum(v.viral)}/h`;
  document.getElementById('range-red').textContent = `≥ ${fmtNum(v.viral)}/h`;
}

function flash(msg) {
  statusEl.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

function fill(v) {
  trendingInput.value = v.trending;
  viralInput.value = v.viral;
  updateRangeLabels(v);
}

chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
  fill(normalize(items));
  bookmarkToggle.checked = !!items.featureBookmarkFolders;
});

function applyUnsupportedState(unsupported) {
  if (unsupported) {
    bookmarkRow.classList.add('is-unsupported');
    bookmarkToggle.checked = false;
    refreshBtn.disabled = true;
  } else {
    bookmarkRow.classList.remove('is-unsupported');
    refreshBtn.disabled = false;
  }
}

chrome.storage.local.get({ bookmarkNotSupported: false }, (items) => {
  applyUnsupportedState(!!items.bookmarkNotSupported);
});

bookmarkToggle.addEventListener('change', () => {
  if (bookmarkRow.classList.contains('is-unsupported')) {
    bookmarkToggle.checked = false;
    return;
  }
  chrome.storage.sync.set({ featureBookmarkFolders: bookmarkToggle.checked }, () => {
    flash(bookmarkToggle.checked ? 'Bookmark menu ON ✓' : 'Bookmark menu OFF');
  });
});

function renderCacheInfo(cache) {
  if (!cache?.folders?.length) {
    cacheInfoEl.textContent = 'No folders cached';
    return;
  }
  const ageMs = Date.now() - (cache.cachedAt || 0);
  const mins = Math.max(0, Math.round(ageMs / 60000));
  const ageStr = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  cacheInfoEl.textContent = `${cache.folders.length} folders · ${ageStr}`;
}

let refreshFallbackTimer = null;

function triggerRefresh() {
  refreshBtn.disabled = true;
  chrome.storage.local.set({ bookmarkRefreshAt: Date.now() });
  // Fallback in case bridge fails to respond (no logged-in tab, network
  // error, etc.) — re-enable the button so the user isn't stuck.
  clearTimeout(refreshFallbackTimer);
  refreshFallbackTimer = setTimeout(() => { refreshBtn.disabled = false; }, 5000);
}

chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
  renderCacheInfo(items.bookmarkFoldersCache);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bookmarkFoldersCache) {
    renderCacheInfo(changes.bookmarkFoldersCache.newValue);
    clearTimeout(refreshFallbackTimer);
    if (!bookmarkRow.classList.contains('is-unsupported')) {
      refreshBtn.disabled = false;
    }
  }
  if (area === 'local' && changes.bookmarkNotSupported) {
    applyUnsupportedState(!!changes.bookmarkNotSupported.newValue);
  }
  if (area === 'sync' && changes.featureBookmarkFolders) {
    // Bridge may have auto-disabled the toggle after detecting non-Premium.
    bookmarkToggle.checked = !!changes.featureBookmarkFolders.newValue;
  }
});

refreshBtn.addEventListener('click', triggerRefresh);

// Auto-refresh when popup opens
triggerRefresh();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = normalize({ trending: trendingInput.value, viral: viralInput.value });
  fill(v);
  chrome.storage.sync.set(v, () => flash('Saved ✓'));
});

resetBtn.addEventListener('click', () => {
  fill(DEFAULT_THRESHOLDS);
  chrome.storage.sync.set(DEFAULT_THRESHOLDS, () => flash('Reset ✓'));
});
