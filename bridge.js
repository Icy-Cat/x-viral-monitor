const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
const DEFAULT_FEATURES = {
  featureBookmarkFolders: false,
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const OP_LIST = { name: 'BookmarkFoldersSlice', qid: 'i78YDd0Tza-dV4SYs58kRg' };

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
    featureBookmarkFolders: !!raw?.featureBookmarkFolders,
  }, '*');
}

function pushFolders(folders, cachedAt) {
  window.postMessage({
    type: 'XVM_FOLDERS_UPDATE',
    folders: folders || [],
    cachedAt: cachedAt || 0,
  }, '*');
}

// Guard all chrome.* calls against extension context invalidation
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

safeChromeCall(() => {
  chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
    const c = items.bookmarkFoldersCache;
    if (c?.folders) pushFolders(c.folders, c.cachedAt || 0);
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;

  if (type === 'XVM_REQUEST_SETTINGS') {
    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => pushSettings(items));
    });
    safeChromeCall(() => {
      chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
        const c = items.bookmarkFoldersCache;
        if (c?.folders) pushFolders(c.folders, c.cachedAt || 0);
      });
    });
    return;
  }

  if (type === 'XVM_REQUEST_FOLDER_REFRESH') {
    refreshFolders();
    return;
  }
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      if (changes.trending || changes.viral || changes.featureBookmarkFolders) {
        safeChromeCall(() => {
          chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => pushSettings(items));
        });
      }
    }
    if (areaName === 'local') {
      if (changes.bookmarkRefreshAt) {
        refreshFolders();
      }
      if (changes.bookmarkFoldersCache) {
        const c = changes.bookmarkFoldersCache.newValue;
        if (c?.folders) pushFolders(c.folders, c.cachedAt || 0);
      }
    }
  });
});

// === Folder fetch / cache ===
let refreshInFlight = null;
let lastFetchAt = 0;

async function refreshFolders() {
  if (refreshInFlight) return refreshInFlight;
  if (Date.now() - lastFetchAt < 3000) return; // debounce

  refreshInFlight = (async () => {
    // Stamp now so failures still benefit from the debounce window and we
    // don't hammer X on repeated 401/500 responses.
    lastFetchAt = Date.now();
    try {
      const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
      if (!ct0) {
        console.warn('[XVM] refreshFolders: no ct0 cookie, user not logged in');
        return;
      }
      const url = `/i/api/graphql/${OP_LIST.qid}/${OP_LIST.name}?variables=${encodeURIComponent('{}')}`;
      const r = await fetch(url, {
        credentials: 'include',
        headers: {
          'authorization': X_BEARER,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'content-type': 'application/json',
        },
      });
      if (!r.ok) {
        console.warn('[XVM] refreshFolders HTTP', r.status);
        return;
      }
      const d = await r.json();

      // Detect non-Premium / unsupported account. Premium users return an
      // object with `items` (possibly empty). Non-Premium responses are
      // either an errors field mentioning premium/permission, or a null
      // bookmark_collections_slice, or a missing field entirely.
      const slice = d?.data?.viewer?.user_results?.result?.bookmark_collections_slice;
      const errs = Array.isArray(d?.errors) ? d.errors : [];
      const errText = errs.map((e) => e?.message || '').join(' ').toLowerCase();
      const unsupported = (
        slice === null ||
        slice === undefined ||
        /premium|blue|subscription|permission|not allowed/.test(errText)
      );

      if (unsupported) {
        console.warn('[XVM] bookmark folders unsupported for this account', errs);
        safeChromeCall(() => {
          chrome.storage.local.set({
            bookmarkFoldersCache: { folders: [], cachedAt: Date.now() },
            bookmarkNotSupported: true,
          });
        });
        // Auto-disable the toggle so it can't be turned on without Premium.
        safeChromeCall(() => {
          chrome.storage.sync.set({ featureBookmarkFolders: false });
        });
        pushFolders([], Date.now());
        return;
      }

      const items = slice?.items || [];
      const folders = items.map((i) => ({ id: i.id, name: i.name }));
      const cachedAt = Date.now();
      lastFetchAt = cachedAt;
      safeChromeCall(() => {
        // Clear any stale "not supported" flag — the account now works.
        chrome.storage.local.set({
          bookmarkFoldersCache: { folders, cachedAt },
          bookmarkNotSupported: false,
        });
      });
      pushFolders(folders, cachedAt);
    } catch (e) {
      console.warn('[XVM] refreshFolders failed', e);
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Initial fetch if cache is empty or older than 6 hours
safeChromeCall(() => {
  chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
    const c = items.bookmarkFoldersCache;
    const stale = !c || !c.cachedAt || (Date.now() - c.cachedAt > 6 * 3600 * 1000);
    if (stale) {
      setTimeout(refreshFolders, 500);
    }
  });
});
