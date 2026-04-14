const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };
const DEFAULT_FEATURES = { featureBookmarkFolders: false };
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const bookmarkToggle = document.getElementById('feat-bookmark-folders');
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

bookmarkToggle.addEventListener('change', () => {
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

function triggerRefresh() {
  refreshBtn.disabled = true;
  chrome.storage.sync.set({ bookmarkRefreshAt: Date.now() });
  setTimeout(() => {
    chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
      renderCacheInfo(items.bookmarkFoldersCache);
      refreshBtn.disabled = false;
    });
  }, 1500);
}

chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
  renderCacheInfo(items.bookmarkFoldersCache);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bookmarkFoldersCache) {
    renderCacheInfo(changes.bookmarkFoldersCache.newValue);
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
