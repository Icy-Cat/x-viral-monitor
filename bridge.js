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
  'contentStarChartDoneTruncated',
  'contentStarChartError',
  'contentStarChartNoTweetFound',
  'contentStarChartModuleNotLoaded',
  'contentStarChartLegendRT',
  'contentStarChartLegendQuote',
  'contentStarChartLegendBoth',
  'contentStarChartClose',
  'contentStarChartStatRetweets',
  'contentStarChartStatQuotes',
  'contentStarChartStatSupporters',
  'contentStarChartStatSpan',
  'contentStarChartSearchPlaceholder',
  'contentStarChartRiverTitle',
  'contentStarChartRiverEmpty',
  'contentStarChartEmpty',
  'contentStarChartReset',
  'contentStarChartHeroEyebrow',
  'contentStarChartHeroTitle',
  'contentStarChartTitleLabel',
  'contentStarChartStatsSectionTitle',
  'contentStarChartPeopleSectionTitle',
  'contentStarChartFilterAll',
  'contentStarChartFilterRetweet',
  'contentStarChartFilterQuote',
  'contentStarChartFilterBoth',
  'contentStarChartRiverPrev',
  'contentStarChartRiverNext',
  // v1.7.0 #4 — leaderboard "hot only" Pro-feature toggle (content.js).
  // These must stay in lock-step with _locales/* and content.js i18n() calls.
  // Contract test in tests/popup-dashboard.test.js asserts every key
  // referenced via i18n(...) in content.js is present here.
  'contentLbHotOnly',
  'contentLbHotProTitle',
  'contentLbHotProSub',
  'contentLbHotMonthly',
  'contentLbHotAnnual',
];

const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: true,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  showBookmarkCount: true,
  badgeStyle: 'pill-solid',
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
  grokCommentPrompt: '[推文内容]\n\n为我生成针对该推文的10条评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。',
  grokPromptTemplates: [
    { id: 'default', name: '默认评论', prompt: '[推文内容]\n\n为我生成针对该推文的10条评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    { id: 'short-cn', name: '中文短评', prompt: '[推文内容]\n\n为该推文生成10条自然、简短、像真人回复的中文评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    { id: 'sharp', name: '犀利观点', prompt: '[推文内容]\n\n为该推文生成10条有观点、有信息密度、但不人身攻击的评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    { id: 'tieba-laoge', name: '贴吧老哥', prompt: '[推文内容]\n\n用贴吧老哥的语气为该推文生成10条评论。要求：\n- 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
  ],
  grokArticlePromptTemplates: [
    { id: 'article-default', name: '文章评论', prompt: '以下是一篇 X 长文 / Article：\n\n[推文内容]\n\n为这篇长文生成10条评论。要求：每条评论引用文章中具体的观点或论据进行回应（赞同/质疑/补充），避免笼统的"很有启发"这类空话；语气自然像真人；每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    { id: 'article-deep', name: '深度回应', prompt: '以下是一篇长文：\n\n[推文内容]\n\n挑选这篇长文中最值得讨论的3-5个核心论点，针对每个论点给出1-2条有信息密度的评论（提出延伸思考、反例、或个人经验），每条评论只包含可直接发布的评论正文，用代码块包裹。' },
  ],
  grokSelectedPromptId: 'default',
  grokSelectedArticlePromptId: 'article-default',
  grokTemporaryChat: true,
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

function normalizeGrokPromptTemplates(raw, legacyPrompt) {
  const source = Array.isArray(raw) && raw.length
    ? raw
    : [{ id: 'default', name: '默认评论', prompt: legacyPrompt || DEFAULT_FEATURES.grokCommentPrompt }];
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const prompt = String(item?.prompt || '').trim();
    if (!prompt) continue;
    const id = String(item?.id || `tpl-${out.length + 1}`).trim() || `tpl-${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item?.name || `模板 ${out.length + 1}`).trim() || `模板 ${out.length + 1}`,
      prompt,
    });
  }
  return out.length ? out : DEFAULT_FEATURES.grokPromptTemplates.map((tpl) => ({ ...tpl }));
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
    showBookmarkCount: raw?.showBookmarkCount !== false,
    leaderboardCount: normalizeLeaderboardCount(raw?.leaderboardCount),
    leaderboardColumns: normalizeLeaderboardColumns(raw?.leaderboardColumns),
    badgeStyle: raw?.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid',
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

  // v1.7.0 #2 — leaderboard theme sync. MAIN-world content.js asks for
  // the current theme preference; we mirror chrome.storage.sync.theme
  // back as XVM_THEME_UPDATE { pref }. content.js resolves 'system' via
  // matchMedia on its own side.
  if (type === 'XVM_THEME_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.sync.get({ theme: 'system' }, (items) => {
        window.postMessage({ type: 'XVM_THEME_UPDATE', pref: items.theme || 'system' }, '*');
      });
    });
    return;
  }

  // Leaderboard hot toggle: enable / disable rate-filter for the current
  // page's scope only. We merge into the existing blob so other scope
  // flags and threshold values stay untouched.
  if (type === 'XVM_RATE_FILTER_SET_SCOPE'
      && typeof event.data.enabled === 'boolean'
      && typeof event.data.scope === 'string') {
    const SCOPE_KEY_FOR = { home: 'scopeHome', list: 'scopeList', profile: 'scopeProfile', status: 'scopeStatus' };
    const key = SCOPE_KEY_FOR[event.data.scope];
    if (!key) return;
    safeChromeCall(() => {
      const RF_KEY = 'xvm_rate_filter_v1';
      chrome.storage.local.get({ [RF_KEY]: null }, (items) => {
        const cur = items[RF_KEY] && typeof items[RF_KEY] === 'object' ? items[RF_KEY] : {};
        // Drop legacy `enabled` field and mark migrated so old client
        // copies don't fight the new model.
        const { enabled: _legacy, ...rest } = cur;
        chrome.storage.local.set({ [RF_KEY]: { ...rest, [key]: event.data.enabled, __scopeMigratedV2: true } });
      });
    });
    return;
  }

  if (type === 'XVM_RATE_FILTER_REQUEST') {
    safeChromeCall(() => {
      const RF_KEY = 'xvm_rate_filter_v1';
      chrome.storage.local.get({ [RF_KEY]: null }, (items) => {
        const settings = items[RF_KEY] && typeof items[RF_KEY] === 'object'
          ? items[RF_KEY]
          : { enabled: false };
        window.postMessage({ type: 'XVM_RATE_SETTINGS_UPDATE', settings }, '*');
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

  if (type === 'XVM_LB_HEIGHT_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.local.get({ xvmLeaderboardHeight: null }, (items) => {
        if (Number.isFinite(items.xvmLeaderboardHeight)) {
          window.postMessage({ type: 'XVM_LB_HEIGHT_LOAD', height: items.xvmLeaderboardHeight }, '*');
        }
      });
    });
    return;
  }

  if (type === 'XVM_LB_HEIGHT_SAVE' && Number.isFinite(event.data.height)) {
    safeChromeCall(() => {
      chrome.storage.local.set({ xvmLeaderboardHeight: event.data.height });
    });
    return;
  }

  if (type === 'XVM_SC_TEMPLATES_REQUEST') {
    const ops = ['Retweeters', 'SearchTimeline', '_global'];
    const defaults = {};
    for (const op of ops) defaults[`xvmStarChartTemplate_${op}`] = null;
    safeChromeCall(() => {
      chrome.storage.local.get(defaults, (items) => {
        const templates = {};
        for (const op of ops) {
          const v = items[`xvmStarChartTemplate_${op}`];
          if (v) templates[op] = v;
        }
        window.postMessage({
          type: 'XVM_SC_TEMPLATES_LOAD',
          templates,
        }, '*');
      });
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

  if (type === 'XVM_GROK_SETTINGS_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.sync.get({
        grokCommentPrompt: DEFAULT_FEATURES.grokCommentPrompt,
        grokPromptTemplates: DEFAULT_FEATURES.grokPromptTemplates,
        grokArticlePromptTemplates: DEFAULT_FEATURES.grokArticlePromptTemplates,
        grokSelectedPromptId: DEFAULT_FEATURES.grokSelectedPromptId,
        grokSelectedArticlePromptId: DEFAULT_FEATURES.grokSelectedArticlePromptId,
        grokTemporaryChat: DEFAULT_FEATURES.grokTemporaryChat,
      }, (syncItems) => {
        chrome.storage.local.get({ xvmGrokCapturedTxId: null }, (localItems) => {
          const promptTemplates = normalizeGrokPromptTemplates(syncItems.grokPromptTemplates, syncItems.grokCommentPrompt);
          const articlePromptTemplates = normalizeGrokPromptTemplates(syncItems.grokArticlePromptTemplates) ;
          window.postMessage({
            type: 'XVM_GROK_SETTINGS_LOAD',
            promptTemplate: promptTemplates[0]?.prompt || DEFAULT_FEATURES.grokCommentPrompt,
            promptTemplates,
            articlePromptTemplates: articlePromptTemplates.length ? articlePromptTemplates : DEFAULT_FEATURES.grokArticlePromptTemplates,
            selectedPromptId: syncItems.grokSelectedPromptId || promptTemplates[0]?.id || 'default',
            selectedArticlePromptId: syncItems.grokSelectedArticlePromptId || (articlePromptTemplates[0]?.id) || DEFAULT_FEATURES.grokSelectedArticlePromptId,
            temporaryChat: syncItems.grokTemporaryChat !== false,
            capturedTxId: localItems.xvmGrokCapturedTxId,
          }, '*');
        });
      });
    });
    return;
  }

  // Persist a tx-id observed on a real X-UI add_response.json POST.
  // Stored as { txId, capturedAt } in chrome.storage.local. Used as fallback
  // when self-generated tx-ids fail signature validation (e.g. after X
  // redeploys their bundle and our algorithm port is briefly out of date).
  if (type === 'XVM_GROK_CAPTURE_SET' && typeof event.data.txId === 'string' && event.data.txId.length > 16) {
    safeChromeCall(() => {
      chrome.storage.local.set({
        xvmGrokCapturedTxId: { txId: event.data.txId, capturedAt: Date.now() },
      });
    });
    return;
  }

  if (type === 'XVM_GROK_CAPTURE_CLEAR') {
    safeChromeCall(() => chrome.storage.local.remove('xvmGrokCapturedTxId'));
    return;
  }
});

// One-time cleanup of legacy captured template (no longer used after self-gen
// rollout). Idempotent flag avoids the IPC on every page load.
safeChromeCall(() => {
  chrome.storage.local.get({ xvmLegacyGrokTemplateCleared: false }, (items) => {
    if (items.xvmLegacyGrokTemplateCleared) return;
    chrome.storage.local.remove('xvmGrokEndpointTemplate', () => {
      chrome.storage.local.set({ xvmLegacyGrokTemplateCleared: true });
    });
  });
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    // Theme changes: broadcast to MAIN-world content.js so leaderboard
    // recolors live. (Popup already self-syncs via its own listener.)
    if (changes.theme) {
      const pref = changes.theme.newValue || 'system';
      window.postMessage({ type: 'XVM_THEME_UPDATE', pref }, '*');
    }
    const grokTouched = changes.grokCommentPrompt || changes.grokPromptTemplates || changes.grokArticlePromptTemplates || changes.grokSelectedPromptId || changes.grokSelectedArticlePromptId || changes.grokTemporaryChat;
    if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard && !changes.featureCopyAsMarkdown && !changes.featureStarChart && !changes.showBookmarkCount && !changes.badgeStyle && !changes.leaderboardCount && !changes.leaderboardColumns && !grokTouched) return;

    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
      if (grokTouched) {
        chrome.storage.sync.get({
          grokCommentPrompt: DEFAULT_FEATURES.grokCommentPrompt,
          grokPromptTemplates: DEFAULT_FEATURES.grokPromptTemplates,
          grokArticlePromptTemplates: DEFAULT_FEATURES.grokArticlePromptTemplates,
          grokSelectedPromptId: DEFAULT_FEATURES.grokSelectedPromptId,
          grokSelectedArticlePromptId: DEFAULT_FEATURES.grokSelectedArticlePromptId,
          grokTemporaryChat: DEFAULT_FEATURES.grokTemporaryChat,
        }, (items) => {
          const promptTemplates = normalizeGrokPromptTemplates(items.grokPromptTemplates, items.grokCommentPrompt);
          const articlePromptTemplates = normalizeGrokPromptTemplates(items.grokArticlePromptTemplates);
          window.postMessage({
            type: 'XVM_GROK_SETTINGS_LOAD',
            promptTemplate: promptTemplates[0]?.prompt || DEFAULT_FEATURES.grokCommentPrompt,
            promptTemplates,
            articlePromptTemplates: articlePromptTemplates.length ? articlePromptTemplates : DEFAULT_FEATURES.grokArticlePromptTemplates,
            selectedPromptId: items.grokSelectedPromptId || promptTemplates[0]?.id || 'default',
            selectedArticlePromptId: items.grokSelectedArticlePromptId || articlePromptTemplates[0]?.id || DEFAULT_FEATURES.grokSelectedArticlePromptId,
            temporaryChat: items.grokTemporaryChat !== false,
          }, '*');
        });
      }
    });
  });
});
