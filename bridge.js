const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
const DEFAULT_COLUMNS = [
  { id: 'rank',     visible: true  },
  { id: 'icon',     visible: true  },
  { id: 'handle',   visible: false },
  { id: 'preview',  visible: true  },
  { id: 'views',    visible: true  },
  { id: 'velocity', visible: true  },
];
const KNOWN_COLUMN_IDS = DEFAULT_COLUMNS.map((c) => c.id);
const CONTENT_MESSAGE_KEYS = [
  'contentViews',
  'contentLikes',
  'contentRetweets',
  'contentReplies',
  'contentBookmarks',
  'contentVelocity',
  'contentViralScore',
  'contentPosted',
  'contentLeaderboardTitle',
  'contentLeaderboardDragToMove',
  'contentLeaderboardBackToPrevious',
  'contentLeaderboardTotalViews',
  'contentCopyMdLabel',
  'contentCopyMdDone',
  'contentCopyMdAttribution',
  'contentCopyMdNoTweetFound',
  'contentCopyMdCopyFailed',
  'contentFallbackTweetLabel',
  'contentStarChartMenuLabel',
  'contentStarChartAttribution',
  'contentStarChartTitle',
  'contentStarChartLoading',
  'contentStarChartProgress',
  'contentStarChartRateLimited',
  'contentStarChartDone',
  'contentStarChartError',
  'contentStarChartNoTweetFound',
  'contentStarChartLegendRT',
  'contentStarChartLegendQuote',
  'contentStarChartLegendBoth',
  'contentStarChartClose',
];

const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

function normalizeLeaderboardCount(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, n));
}

function normalizeLeaderboardColumns(raw) {
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    if (!c || typeof c.id !== 'string') continue;
    if (!KNOWN_COLUMN_IDS.includes(c.id)) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, visible: !!c.visible });
  }
  // Append any columns the user's stored config is missing (forward compat)
  for (const def of DEFAULT_COLUMNS) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}

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

function getLocalizedMessages() {
  const out = {};
  for (const key of CONTENT_MESSAGE_KEYS) {
    try {
      out[key] = chrome.i18n.getMessage(key) || key;
    } catch (_) {
      out[key] = key;
    }
  }
  return out;
}

function pushSettings(raw) {
  window.postMessage({
    type: 'XVM_SETTINGS_UPDATE',
    thresholds: normalizeThresholds(raw),
    featureVelocityLeaderboard: !!raw?.featureVelocityLeaderboard,
    featureCopyAsMarkdown: raw?.featureCopyAsMarkdown !== false,
    featureStarChart: raw?.featureStarChart !== false,
    leaderboardCount: normalizeLeaderboardCount(raw?.leaderboardCount),
    leaderboardColumns: normalizeLeaderboardColumns(raw?.leaderboardColumns),
    messages: getLocalizedMessages(),
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
  const type = event.data?.type;

  if (type === 'XVM_REQUEST_SETTINGS') {
    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
    });
    return;
  }

  if (type === 'XVM_LB_POS_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.local.get({ xvmLeaderboardPos: null }, (items) => {
        if (items.xvmLeaderboardPos) {
          window.postMessage({ type: 'XVM_LB_POS_LOAD', pos: items.xvmLeaderboardPos }, '*');
        }
      });
    });
    return;
  }

  if (type === 'XVM_LB_SIZE_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.local.get({ xvmLeaderboardWidth: null }, (items) => {
        if (Number.isFinite(items.xvmLeaderboardWidth)) {
          window.postMessage({ type: 'XVM_LB_SIZE_LOAD', width: items.xvmLeaderboardWidth }, '*');
        }
      });
    });
    return;
  }

  if (type === 'XVM_LB_POS_SAVE' && event.data.pos) {
    safeChromeCall(() => {
      chrome.storage.local.set({ xvmLeaderboardPos: event.data.pos });
    });
    return;
  }

  if (type === 'XVM_LB_SIZE_SAVE' && Number.isFinite(event.data.width)) {
    safeChromeCall(() => {
      chrome.storage.local.set({ xvmLeaderboardWidth: event.data.width });
    });
    return;
  }

  if (type === 'XVM_SC_TEMPLATE_CAPTURE' && event.data.op && event.data.template) {
    const storageKey = `xvmStarChartTemplate_${event.data.op}`;
    safeChromeCall(() => {
      chrome.storage.local.get({ [storageKey]: {} }, (items) => {
        const cur = items[storageKey] || {};
        const next = { ...cur, ...event.data.template, capturedAt: Date.now() };
        chrome.storage.local.set({ [storageKey]: next });
      });
    });
    return;
  }
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard && !changes.featureCopyAsMarkdown && !changes.featureStarChart && !changes.leaderboardCount && !changes.leaderboardColumns) return;

    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
    });
  });
});
