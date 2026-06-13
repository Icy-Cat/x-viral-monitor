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
const LANGUAGE_KEY = 'language';
const SUPPORTED_LANGUAGE_IDS = ['auto', 'zh_CN', 'en', 'ja'];

function normalizeLanguage(raw) {
  return SUPPORTED_LANGUAGE_IDS.includes(raw) ? raw : 'auto';
}

function getBrowserLocaleId() {
  try {
    const ui = chrome?.i18n?.getUILanguage?.() || navigator.language || '';
    const lower = ui.toLowerCase();
    if (lower.startsWith('zh')) return 'zh_CN';
    if (lower.startsWith('ja')) return 'ja';
  } catch (_) {}
  return 'en';
}

function getEffectiveLanguageId(pref = 'auto') {
  const normalized = normalizeLanguage(pref);
  return normalized === 'auto' ? getBrowserLocaleId() : normalized;
}

function normalizeSubstitutions(substitutions) {
  if (substitutions == null) return [];
  return Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)];
}

function formatLocaleMessage(entry, substitutions) {
  if (!entry?.message) return '';
  const subs = normalizeSubstitutions(substitutions);
  let message = String(entry.message).replace(/\$\$/g, '\u0000');
  const placeholders = entry.placeholders || {};
  for (const [name, meta] of Object.entries(placeholders)) {
    const match = String(meta?.content || '').match(/^\$(\d+)$/);
    const value = match ? (subs[Number(match[1]) - 1] ?? '') : String(meta?.content || '');
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), value);
  }
  message = message.replace(/\$(\d+)/g, (_, n) => subs[Number(n) - 1] ?? '');
  return message.replace(/\u0000/g, '$');
}

const localeBundleCache = new Map();

async function loadLocaleBundle(languageId) {
  if (localeBundleCache.has(languageId)) return localeBundleCache.get(languageId);
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${languageId}/messages.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    localeBundleCache.set(languageId, json);
    return json;
  } catch (_) {
    localeBundleCache.set(languageId, null);
    return null;
  }
}

const GROK_DEFAULTS_BY_LANGUAGE = {
  zh_CN: {
    promptTemplates: [
      { id: 'default', name: '默认评论', prompt: '[推文内容]\n\n为我生成针对该推文的10条评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'short-cn', name: '中文短评', prompt: '[推文内容]\n\n为该推文生成10条自然、简短、像真人回复的中文评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'sharp', name: '犀利观点', prompt: '[推文内容]\n\n为该推文生成10条有观点、有信息密度、但不人身攻击的评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'tieba-laoge', name: '贴吧老哥', prompt: '[推文内容]\n\n用贴吧老哥的语气为该推文生成10条评论。整体阴阳怪气，但不带脏字、不人身攻击；保持口语感，不要装文艺、不要写得像新闻评论；每条评论控制在 30 字以内，简短精悍。\n每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    ],
    articlePromptTemplates: [
      { id: 'article-default', name: '文章评论', prompt: '以下是一篇 X 长文 / Article：\n\n[推文内容]\n\n为这篇长文生成10条评论。要求：每条评论引用文章中具体的观点或论据进行回应（赞同/质疑/补充），避免笼统的"很有启发"这类空话；语气自然像真人；每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'article-deep', name: '深度回应', prompt: '以下是一篇长文：\n\n[推文内容]\n\n挑选这篇长文中最值得讨论的3-5个核心论点，针对每个论点给出1-2条有信息密度的评论（提出延伸思考、反例、或个人经验），每条评论只包含可直接发布的评论正文，用代码块包裹。' },
    ],
  },
  en: {
    promptTemplates: [
      { id: 'default', name: 'Natural replies', prompt: '[推文内容]\n\nWrite 10 natural English replies to this X post. Requirements:\n- Sound like real X replies, not marketing copy or a formal article comment\n- Each reply should make one clear point: agree, add context, ask a sharp question, or offer a mild counterpoint\n- Avoid generic praise, outrage bait, personal attacks, and hashtags\n- Keep each reply concise, roughly 8-28 words\n- Output only ready-to-post reply text, each inside its own code block.' },
      { id: 'sharp', name: 'Sharp but fair', prompt: '[推文内容]\n\nWrite 10 English replies to this X post with a sharper point of view. Requirements:\n- Be specific, thoughtful, and concise\n- You may challenge assumptions, add a counterexample, or clarify the tradeoff\n- Stay fair; no insults, no dunking, no culture-war bait\n- Keep each reply around 12-35 words\n- Output only ready-to-post reply text, each inside its own code block.' },
      { id: 'casual-en', name: 'Casual short replies', prompt: '[推文内容]\n\nWrite 10 casual English replies for this X post. Requirements:\n- Conversational and human, like a normal user replying on X\n- Short, direct, and not over-polished\n- Avoid cringe slang, hashtags, and corporate tone\n- Keep each reply under 25 words\n- Output only ready-to-post reply text, each inside its own code block.' },
    ],
    articlePromptTemplates: [
      { id: 'article-default', name: 'Article replies', prompt: 'Here is an X long-form post / Article:\n\n[推文内容]\n\nWrite 10 English replies. Requirements:\n- Each reply should respond to a specific claim, argument, example, or conclusion from the article\n- Mix agreement, critique, added context, and follow-up questions\n- Avoid vague praise like “great insights”\n- Keep each reply specific and ready to post\n- Output only the reply text, each inside its own code block.' },
      { id: 'article-deep', name: 'Deeper discussion', prompt: 'Here is an X long-form post / Article:\n\n[推文内容]\n\nIdentify 3-5 discussion-worthy points from the article and write 10 English replies. Requirements:\n- Each reply should focus on one concrete point\n- Add a useful extension, counterexample, practical constraint, or personal-experience angle\n- Sound natural, not like an essay summary\n- Output only ready-to-post reply text, each inside its own code block.' },
    ],
  },
  ja: {
    promptTemplates: [
      { id: 'default', name: '自然な返信', prompt: '[推文内容]\n\nこの X 投稿に対する自然な日本語返信を 10 件作成してください。条件：\n- 実際の X の返信らしく、宣伝文や記事コメントのようにしない\n- 各返信は、共感・補足・軽い疑問・別視点のいずれかを 1 つだけ扱う\n- 空っぽな称賛、過度な煽り、個人攻撃は避ける\n- 1 件あたり 15〜45 字程度\n- そのまま投稿できる本文だけを、各返信ごとにコードブロックで出力する。' },
      { id: 'sharp', name: '鋭めだが丁寧', prompt: '[推文内容]\n\nこの X 投稿に対する日本語返信を 10 件作成してください。少し鋭い視点で、ただし丁寧に。条件：\n- 前提への疑問、反例、補足、論点整理のいずれかを入れる\n- 皮肉、人格攻撃、決めつけは避ける\n- 1 件あたり 20〜55 字程度\n- そのまま投稿できる本文だけを、各返信ごとにコードブロックで出力する。' },
      { id: 'casual-ja', name: '短めの口語返信', prompt: '[推文内容]\n\nこの X 投稿に対する短い日本語返信を 10 件作成してください。条件：\n- 口語的で自然、AI っぽくしない\n- くだけすぎず、普通のユーザーの返信に見える文体\n- 1 件あたり 10〜30 字程度\n- そのまま投稿できる本文だけを、各返信ごとにコードブロックで出力する。' },
    ],
    articlePromptTemplates: [
      { id: 'article-default', name: '長文への返信', prompt: '以下は X の長文投稿 / Article です：\n\n[推文内容]\n\n日本語の返信を 10 件作成してください。条件：\n- 各返信は本文中の具体的な主張、根拠、例、結論のどれかに反応する\n- 賛同、疑問、補足、追加の問いをバランスよく混ぜる\n- 「勉強になりました」のような抽象的な感想だけにしない\n- 1 件あたり 30〜80 字程度\n- そのまま投稿できる本文だけを、各返信ごとにコードブロックで出力する。' },
      { id: 'article-deep', name: '深めの議論', prompt: '以下は X の長文投稿 / Article です：\n\n[推文内容]\n\n本文から議論すべきポイントを 3〜5 個選び、日本語の返信を 10 件作成してください。条件：\n- 各返信は 1 つの具体的な論点に絞る\n- 追加視点、反例、現実的な制約、個人的な経験の角度を入れる\n- 論文要約のようにせず、自然な返信文にする\n- そのまま投稿できる本文だけを、各返信ごとにコードブロックで出力する。' },
    ],
  },
};

function getLocalizedGrokDefaults(languageId = getBrowserLocaleId()) {
  const lang = GROK_DEFAULTS_BY_LANGUAGE[languageId] ? languageId : 'en';
  const defs = GROK_DEFAULTS_BY_LANGUAGE[lang];
  return {
    grokCommentPrompt: defs.promptTemplates[0].prompt,
    grokPromptTemplates: defs.promptTemplates.map((tpl) => ({ ...tpl })),
    grokArticlePromptTemplates: defs.articlePromptTemplates.map((tpl) => ({ ...tpl })),
    grokSelectedPromptId: defs.promptTemplates[0].id,
    grokSelectedArticlePromptId: defs.articlePromptTemplates[0].id,
  };
}

const LOCALIZED_GROK_DEFAULTS = getLocalizedGrokDefaults(getBrowserLocaleId());
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
  'contentLeaderboardEdgeHide',
  'contentLeaderboardEdgeShow',
  'contentLeaderboardSettings',
  'contentLeaderboardClose',
  'contentLeaderboardCloseSettings',
  'contentLeaderboardSettingsPanelTitle',
  'contentLeaderboardColumns',
  'contentLeaderboardSettingsAutoSave',
  'contentLeaderboardTotalViews',
  'featureLeaderboardShowTop',
  'featureLeaderboardEdgeHideTitle',
  'featureLeaderboardEdgeHideDesc',
  'popupColRank',
  'popupColIcon',
  'popupColHandle',
  'popupColPreview',
  'popupColViews',
  'popupColVelocity',
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
  'contentLbHotEnabledToast',
  'contentLbHotActiveNotice',
  'contentLbHotDetails',
  'contentLbHotOpenSite',
  'contentUpdateTitle',
  'contentUpdateSubtitle',
  'contentUpdateItemBookmarkFoldersTitle',
  'contentUpdateItemBookmarkFoldersBody',
  'contentUpdateItemBookmarkCountTitle',
  'contentUpdateItemBookmarkCountBody',
  'contentUpdateItemEnterReplyTitle',
  'contentUpdateItemEnterReplyBody',
  'contentUpdateItemHotOnlyTitle',
  'contentUpdateItemHotOnlyBody',
  'contentUpdateDismiss',
  'contentBookmarkMenuInFolder',
  'contentBookmarkMenuNotInAny',
  'contentBookmarkMenuCheckFailed',
  'contentBookmarkMenuChecking',
  'contentBookmarkMenuLoadingFolders',
  'contentBookmarkMenuLoadFailed',
  'contentBookmarkMenuNoFolders',
  'contentBookmarkMenuNewFolderPlaceholder',
];

const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: true,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  featureBookmarkFolders: false,
  showBookmarkCount: true,
  leaderboardEdgeHideEnabled: true,
  badgeStyle: 'pill-solid',
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
  grokCommentPrompt: LOCALIZED_GROK_DEFAULTS.grokCommentPrompt,
  grokPromptTemplates: LOCALIZED_GROK_DEFAULTS.grokPromptTemplates,
  grokArticlePromptTemplates: LOCALIZED_GROK_DEFAULTS.grokArticlePromptTemplates,
  grokSelectedPromptId: LOCALIZED_GROK_DEFAULTS.grokSelectedPromptId,
  grokSelectedArticlePromptId: LOCALIZED_GROK_DEFAULTS.grokSelectedArticlePromptId,
  grokTemporaryChat: true,
  grokEnterToReply: false,
  language: 'auto',
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };
const RELEASE_NOTES_SEEN_KEY = 'xvm_release_notes_seen_version';
const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const OP_LIST = { name: 'BookmarkFoldersSlice', qid: 'i78YDd0Tza-dV4SYs58kRg' };

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

async function getLocalizedMessages(languagePref) {
  const languageId = getEffectiveLanguageId(languagePref);
  const bundle = normalizeLanguage(languagePref) === 'auto' ? null : await loadLocaleBundle(languageId);
  const out = {};
  for (const key of CONTENT_MESSAGE_KEYS) {
    const local = formatLocaleMessage(bundle?.[key]);
    if (local) {
      out[key] = local;
      continue;
    }
    try { out[key] = chrome.i18n.getMessage(key) || key; }
    catch (_) { out[key] = key; }
  }
  return out;
}

async function pushSettings(raw) {
  window.postMessage({
    type: 'XVM_SETTINGS_UPDATE',
    thresholds: normalizeThresholds(raw),
    featureVelocityLeaderboard: !!raw?.featureVelocityLeaderboard,
    featureCopyAsMarkdown: raw?.featureCopyAsMarkdown !== false,
    featureStarChart: raw?.featureStarChart !== false,
    featureBookmarkFolders: !!raw?.featureBookmarkFolders,
    showBookmarkCount: raw?.showBookmarkCount !== false,
    leaderboardEdgeHideEnabled: raw?.leaderboardEdgeHideEnabled !== false,
    leaderboardCount: normalizeLeaderboardCount(raw?.leaderboardCount),
    leaderboardColumns: normalizeLeaderboardColumns(raw?.leaderboardColumns),
    badgeStyle: raw?.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid',
    language: normalizeLanguage(raw?.language),
    effectiveLanguage: getEffectiveLanguageId(raw?.language),
    messages: await getLocalizedMessages(raw?.language),
  }, '*');
}

function pushFolders(folders, cachedAt) {
  window.postMessage({
    type: 'XVM_FOLDERS_UPDATE',
    folders: Array.isArray(folders) ? folders : [],
    cachedAt: cachedAt || 0,
  }, '*');
}

function pushReleaseNotesIfNeeded() {
  safeChromeCall(() => {
    const version = chrome.runtime?.getManifest?.()?.version || '';
    if (!version) return;
    chrome.storage.local.get({ [RELEASE_NOTES_SEEN_KEY]: null }, (items) => {
      if (items?.[RELEASE_NOTES_SEEN_KEY] === version) return;
      window.postMessage({ type: 'XVM_RELEASE_NOTES_SHOW', version }, '*');
    });
  });
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

safeChromeCall(() => {
  chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
    const cache = items.bookmarkFoldersCache;
    if (cache?.folders) pushFolders(cache.folders, cache.cachedAt || 0);
  });
});

pushReleaseNotesIfNeeded();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;

  if (type === 'XVM_REQUEST_SETTINGS') {
    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
    });
    safeChromeCall(() => {
      chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
        const cache = items.bookmarkFoldersCache;
        if (cache?.folders) pushFolders(cache.folders, cache.cachedAt || 0);
      });
    });
    return;
  }

  if (type === 'XVM_RELEASE_NOTES_DISMISS' && typeof event.data.version === 'string') {
    safeChromeCall(() => {
      chrome.storage.local.set({ [RELEASE_NOTES_SEEN_KEY]: event.data.version });
    });
    return;
  }

  if (type === 'XVM_REQUEST_FOLDER_REFRESH') {
    refreshFolders();
    return;
  }

  if (type === 'XVM_BOOKMARK_FOLDER_MUTATION' && event.data.folderId) {
    const mutation = {
      folderId: String(event.data.folderId),
      tweetId: String(event.data.tweetId || ''),
      action: String(event.data.action || ''),
      at: Date.now(),
    };
    window.postMessage({ type: 'XVM_BOOKMARK_FOLDER_DIRTY', ...mutation }, '*');
    safeChromeCall(() => {
      chrome.storage.local.set({ bookmarkFolderMutation: mutation });
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

  if (type === 'XVM_LEADERBOARD_DISABLE') {
    safeChromeCall(() => {
      chrome.storage.sync.set({ featureVelocityLeaderboard: false }, () => {
        chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
          pushSettings(items);
        });
      });
    });
    return;
  }

  if (type === 'XVM_LEADERBOARD_SETTINGS_SAVE' && event.data.patch && typeof event.data.patch === 'object') {
    const rawPatch = event.data.patch;
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(rawPatch, 'leaderboardCount')) {
      patch.leaderboardCount = normalizeLeaderboardCount(rawPatch.leaderboardCount);
    }
    if (Object.prototype.hasOwnProperty.call(rawPatch, 'leaderboardEdgeHideEnabled')) {
      patch.leaderboardEdgeHideEnabled = rawPatch.leaderboardEdgeHideEnabled !== false;
    }
    if (Array.isArray(rawPatch.leaderboardColumns)) {
      patch.leaderboardColumns = normalizeLeaderboardColumns(rawPatch.leaderboardColumns);
    }
    if (Object.keys(patch).length) {
      safeChromeCall(() => {
        chrome.storage.sync.set(patch, () => {
          chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
            pushSettings(items);
          });
        });
      });
    }
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
        grokEnterToReply: DEFAULT_FEATURES.grokEnterToReply,
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
            enterToReply: syncItems.grokEnterToReply === true,
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
    if (areaName === 'local') {
      if (changes.bookmarkRefreshAt) {
        refreshFolders();
      }
      if (changes.bookmarkFoldersCache) {
        const cache = changes.bookmarkFoldersCache.newValue;
        if (cache?.folders) pushFolders(cache.folders, cache.cachedAt || 0);
      }
      if (changes.bookmarkFolderMutation?.newValue) {
        window.postMessage({
          type: 'XVM_BOOKMARK_FOLDER_DIRTY',
          ...changes.bookmarkFolderMutation.newValue,
        }, '*');
      }
      return;
    }

    if (areaName !== 'sync') return;
    // Theme changes: broadcast to MAIN-world content.js so leaderboard
    // recolors live. (Popup already self-syncs via its own listener.)
    if (changes.theme) {
      const pref = changes.theme.newValue || 'system';
      window.postMessage({ type: 'XVM_THEME_UPDATE', pref }, '*');
    }
    const grokTouched = changes.grokCommentPrompt || changes.grokPromptTemplates || changes.grokArticlePromptTemplates || changes.grokSelectedPromptId || changes.grokSelectedArticlePromptId || changes.grokTemporaryChat || changes.grokEnterToReply || changes.language;
    if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard && !changes.featureCopyAsMarkdown && !changes.featureStarChart && !changes.featureBookmarkFolders && !changes.showBookmarkCount && !changes.leaderboardEdgeHideEnabled && !changes.badgeStyle && !changes.leaderboardCount && !changes.leaderboardColumns && !changes.language && !grokTouched) return;

    safeChromeCall(() => {
      chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
        pushSettings(items);
      });
      if (changes.featureBookmarkFolders?.newValue === true) {
        refreshFolders();
      }
      if (grokTouched) {
        chrome.storage.sync.get({
          grokCommentPrompt: DEFAULT_FEATURES.grokCommentPrompt,
          grokPromptTemplates: DEFAULT_FEATURES.grokPromptTemplates,
          grokArticlePromptTemplates: DEFAULT_FEATURES.grokArticlePromptTemplates,
          grokSelectedPromptId: DEFAULT_FEATURES.grokSelectedPromptId,
          grokSelectedArticlePromptId: DEFAULT_FEATURES.grokSelectedArticlePromptId,
          grokTemporaryChat: DEFAULT_FEATURES.grokTemporaryChat,
          grokEnterToReply: DEFAULT_FEATURES.grokEnterToReply,
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
            enterToReply: items.grokEnterToReply === true,
          }, '*');
        });
      }
    });
  });
});

let bookmarkRefreshInFlight = null;
let bookmarkLastFetchAt = 0;

async function refreshFolders() {
  if (bookmarkRefreshInFlight) return bookmarkRefreshInFlight;
  if (Date.now() - bookmarkLastFetchAt < 3000) return null;

  bookmarkRefreshInFlight = (async () => {
    bookmarkLastFetchAt = Date.now();
    try {
      const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
      if (!ct0) return;

      const url = `/i/api/graphql/${OP_LIST.qid}/${OP_LIST.name}?variables=${encodeURIComponent('{}')}`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          authorization: X_BEARER,
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'content-type': 'application/json',
        },
      });
      if (!res.ok) {
        console.warn('[XVM] refreshFolders HTTP', res.status);
        return;
      }

      const data = await res.json();
      const slice = data?.data?.viewer?.user_results?.result?.bookmark_collections_slice;
      const errors = Array.isArray(data?.errors) ? data.errors : [];
      const errorText = errors.map((err) => err?.message || '').join(' ').toLowerCase();
      const unsupported = errors.length > 0 && /premium|blue|subscription|permission|not allowed|unauthorized/.test(errorText);

      if (unsupported) {
        const cachedAt = Date.now();
        safeChromeCall(() => {
          chrome.storage.local.set({
            bookmarkFoldersCache: { folders: [], cachedAt },
            bookmarkNotSupported: true,
          });
          chrome.storage.sync.set({ featureBookmarkFolders: false });
        });
        pushFolders([], cachedAt);
        return;
      }

      if (slice === null || slice === undefined) {
        console.warn('[XVM] refreshFolders: bookmark_collections_slice missing, treating as transient');
        return;
      }

      const folders = (slice.items || [])
        .map((item) => ({ id: item?.id, name: item?.name }))
        .filter((folder) => folder.id && folder.name);
      const cachedAt = Date.now();
      bookmarkLastFetchAt = cachedAt;
      safeChromeCall(() => {
        chrome.storage.local.set({
          bookmarkFoldersCache: { folders, cachedAt },
          bookmarkNotSupported: false,
        });
      });
      pushFolders(folders, cachedAt);
    } catch (err) {
      console.warn('[XVM] refreshFolders failed', err);
    } finally {
      bookmarkRefreshInFlight = null;
    }
  })();
  return bookmarkRefreshInFlight;
}

safeChromeCall(() => {
  chrome.storage.local.get({ bookmarkFoldersCache: null }, (items) => {
    const cache = items.bookmarkFoldersCache;
    const stale = !cache || !cache.cachedAt || Date.now() - cache.cachedAt > 6 * 3600 * 1000;
    if (stale) setTimeout(refreshFolders, 500);
  });
});
