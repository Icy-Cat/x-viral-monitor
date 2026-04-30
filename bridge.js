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
];

const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
  grokCommentPrompt: '[推文内容]\n\n为我生成针对该推文的10条评论,每条评论用代码块包裹',
  grokPromptTemplates: [
    { id: 'default', name: '默认评论', prompt: '[推文内容]\n\n为我生成针对该推文的10条评论,每条评论用代码块包裹' },
    { id: 'short-cn', name: '中文短评', prompt: '[推文内容]\n\n为该推文生成10条自然、简短、像真人回复的中文评论,每条评论用代码块包裹' },
    { id: 'sharp', name: '犀利观点', prompt: '[推文内容]\n\n为该推文生成10条有观点、有信息密度、但不人身攻击的评论,每条评论用代码块包裹' },
  ],
  grokSelectedPromptId: 'default',
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

function findGrokPromptPath(obj, path = []) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj?.responses?.[0]?.message === 'string' && obj.responses[0].message.trim()) {
    return ['responses', '0', 'message'];
  }
  for (const [key, value] of Object.entries(obj)) {
    const nextPath = path.concat(key);
    if (typeof value === 'string' && /^(message|prompt|query|input|text|content)$/i.test(key) && value.trim()) {
      return nextPath;
    }
    if (value && typeof value === 'object') {
      const nested = findGrokPromptPath(value, nextPath);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeGrokEndpointTemplate(template) {
  if (!template?.url || !template?.bodyText) return null;
  if (!/(?:grok\.x\.com\/\d+\/grok\/|\/i\/api\/(?:graphql\/[^/]+\/[^/?]*grok[^/?]*|grok\b))/i.test(template.url)) {
    return null;
  }
  try {
    const body = JSON.parse(template.bodyText);
    const promptPath = Array.isArray(template.promptPath) && template.promptPath.length
      ? template.promptPath
      : findGrokPromptPath(body);
    if (!promptPath) return null;
    let cur = body;
    for (const key of promptPath) {
      if (!cur || typeof cur !== 'object') return null;
      cur = cur[key];
    }
    if (typeof cur !== 'string') return null;
    return { ...template, promptPath };
  } catch (_) {
    return null;
  }
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
        grokSelectedPromptId: DEFAULT_FEATURES.grokSelectedPromptId,
      }, (syncItems) => {
        chrome.storage.local.get({ xvmGrokEndpointTemplate: null }, (localItems) => {
          const endpointTemplate = normalizeGrokEndpointTemplate(localItems.xvmGrokEndpointTemplate);
          if (localItems.xvmGrokEndpointTemplate && !endpointTemplate) {
            chrome.storage.local.remove('xvmGrokEndpointTemplate');
          }
          const promptTemplates = normalizeGrokPromptTemplates(syncItems.grokPromptTemplates, syncItems.grokCommentPrompt);
          window.postMessage({
            type: 'XVM_GROK_SETTINGS_LOAD',
            promptTemplate: promptTemplates[0]?.prompt || DEFAULT_FEATURES.grokCommentPrompt,
            promptTemplates,
            selectedPromptId: syncItems.grokSelectedPromptId || promptTemplates[0]?.id || 'default',
            endpointTemplate,
          }, '*');
        });
      });
    });
    return;
  }

  if (type === 'XVM_GROK_TEMPLATE_CAPTURE' && event.data.template) {
    const endpointTemplate = normalizeGrokEndpointTemplate(event.data.template);
    if (!endpointTemplate) return;
    safeChromeCall(() => {
      chrome.storage.local.set({
        xvmGrokEndpointTemplate: {
          ...endpointTemplate,
          capturedAt: Date.now(),
        },
      });
    });
    return;
  }
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard && !changes.featureCopyAsMarkdown && !changes.featureStarChart && !changes.leaderboardCount && !changes.leaderboardColumns && !changes.grokCommentPrompt && !changes.grokPromptTemplates && !changes.grokSelectedPromptId) return;

    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
      if (changes.grokCommentPrompt || changes.grokPromptTemplates || changes.grokSelectedPromptId) {
        chrome.storage.sync.get({
          grokCommentPrompt: DEFAULT_FEATURES.grokCommentPrompt,
          grokPromptTemplates: DEFAULT_FEATURES.grokPromptTemplates,
          grokSelectedPromptId: DEFAULT_FEATURES.grokSelectedPromptId,
        }, (items) => {
          chrome.storage.local.get({ xvmGrokEndpointTemplate: null }, (localItems) => {
            const endpointTemplate = normalizeGrokEndpointTemplate(localItems.xvmGrokEndpointTemplate);
            if (localItems.xvmGrokEndpointTemplate && !endpointTemplate) {
              chrome.storage.local.remove('xvmGrokEndpointTemplate');
            }
            const promptTemplates = normalizeGrokPromptTemplates(items.grokPromptTemplates, items.grokCommentPrompt);
            window.postMessage({
              type: 'XVM_GROK_SETTINGS_LOAD',
              promptTemplate: promptTemplates[0]?.prompt || DEFAULT_FEATURES.grokCommentPrompt,
              promptTemplates,
              selectedPromptId: items.grokSelectedPromptId || promptTemplates[0]?.id || 'default',
              endpointTemplate,
            }, '*');
          });
        });
      }
    });
  });
});

// === History tracker relay ===
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data.type !== 'string' || !data.type.startsWith('XVM_HIST_')) return;

  if (data.type === 'XVM_HIST_SUBS_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.sync.get({ subscribed: [] }, (items) => {
        window.postMessage({ type: 'XVM_HIST_SUBS_LOAD', subscribed: items.subscribed || [] }, '*');
      });
    });
    return;
  }
  if (data.type === 'XVM_HIST_SUBS_SET' && Array.isArray(data.subscribed)) {
    safeChromeCall(() => {
      chrome.storage.sync.set({ subscribed: data.subscribed });
    });
    return;
  }
  if (data.type === 'XVM_HIST_OBSERVE') {
    safeChromeCall(() => {
      chrome.runtime.sendMessage({ type: 'XVM_HIST_OBSERVE', tweet: data.tweet }, (resp) => {
        if (chrome.runtime.lastError) {
          console.debug('[XVM-HIST] bridge: SW lastError forwarding observe:', chrome.runtime.lastError.message);
          return;
        }
        console.debug('[XVM-HIST] bridge: SW response for', data.tweet?.id, '→', resp);
      });
    });
    return;
  }
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.subscribed) return;
    window.postMessage({ type: 'XVM_HIST_SUBS_LOAD', subscribed: changes.subscribed.newValue || [] }, '*');
  });
});
