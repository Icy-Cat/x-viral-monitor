const LANGUAGE_KEY = 'language';
const SUPPORTED_LANGUAGE_IDS = ['auto', 'zh_CN', 'en', 'ja'];
const LANGUAGE_LABELS = {
  auto: 'Auto / 跟随系统',
  zh_CN: '中文',
  en: 'English',
  ja: '日本語',
};
const LANGUAGE_TOGGLE_TEXT = {
  auto: 'A',
  zh_CN: '中',
  en: 'EN',
  ja: '日',
};

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

function getEffectiveLanguageId(pref = normalizeLanguage(localStorage.getItem(LANGUAGE_KEY))) {
  return pref === 'auto' ? getBrowserLocaleId() : normalizeLanguage(pref);
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

function loadLocaleBundleSync(languageId) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', chrome.runtime.getURL(`_locales/${languageId}/messages.json`), false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText);
  } catch (_) {}
  return null;
}

const initialLanguagePref = normalizeLanguage(localStorage.getItem(LANGUAGE_KEY));
const initialLanguageId = getEffectiveLanguageId(initialLanguagePref);
const overrideMessages = initialLanguagePref === 'auto' ? null : loadLocaleBundleSync(initialLanguageId);
const nativeGetMessage = chrome?.i18n?.getMessage?.bind(chrome.i18n);

if (overrideMessages && nativeGetMessage) {
  try {
    chrome.i18n.getMessage = (key, substitutions) => {
      const formatted = formatLocaleMessage(overrideMessages[key], substitutions);
      return formatted || nativeGetMessage(key, substitutions);
    };
  } catch (_) {}
}

const GROK_DEFAULTS_BY_LANGUAGE = {
  zh_CN: {
    promptTemplates: [
      { id: 'default', name: '默认评论', prompt: '[推文内容]\n\n为我生成针对该推文的10条评论,每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'short-cn', name: '中文短评', prompt: '[推文内容]\n\n为该推文生成10条自然、简短、像真人回复的中文评论,每条评论只包含可直接发布的评论正文，用代码块包裹。' },
      { id: 'sharp', name: '犀利观点', prompt: '[推文内容]\n\n为该推文生成10条有观点、有信息密度、但不人身攻击的评论,每条评论只包含可直接发布的评论正文，用代码块包裹。' },
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

function getLocalizedGrokDefaults(languageId = initialLanguageId) {
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

const LOCALIZED_GROK_DEFAULTS = getLocalizedGrokDefaults(initialLanguageId);
function isUnmodifiedBundledGrokTemplateSet(templates, key) {
  if (!Array.isArray(templates) || templates.length === 0) return true;
  for (const defs of Object.values(GROK_DEFAULTS_BY_LANGUAGE)) {
    const bundled = defs[key] || [];
    if (templates.length !== bundled.length) continue;
    const matches = templates.every((tpl, idx) => (
      String(tpl?.id || '') === bundled[idx].id
      && String(tpl?.name || '') === bundled[idx].name
      && String(tpl?.prompt || '') === bundled[idx].prompt
    ));
    if (matches) return true;
  }
  return false;
}

const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };
const DEFAULT_COLUMNS = [
  { id: 'rank',     visible: true  },
  { id: 'icon',     visible: true  },
  { id: 'handle',   visible: false },
  { id: 'preview',  visible: true  },
  { id: 'views',    visible: true  },
  { id: 'velocity', visible: true  },
];
const COLUMN_LABEL_KEYS = {
  rank: 'popupColRank',
  icon: 'popupColIcon',
  handle: 'popupColHandle',
  preview: 'popupColPreview',
  views: 'popupColViews',
  velocity: 'popupColVelocity',
};
const KNOWN_COLUMN_IDS = DEFAULT_COLUMNS.map((c) => c.id);
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: true,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
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
  language: initialLanguagePref,
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

// Apply chrome.i18n translations to any element marked with data-i18n.
// Falls back to the hardcoded English text in the HTML if a key is missing.
function t(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || '';
  } catch (e) {
    return '';
  }
}
document.querySelectorAll('[data-i18n]').forEach((el) => {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

function tr(key, substitutions) {
  return t(key, substitutions) || key;
}

const customSelectState = new WeakMap();

function initCustomSelect(input) {
  if (!input || customSelectState.has(input)) return customSelectState.get(input);
  const root = input.closest('.xvm-select');
  if (!root) return null;
  const trigger = root.querySelector('.xvm-select-trigger');
  const valueEl = root.querySelector('.xvm-select-value');
  const menu = root.querySelector('.xvm-select-menu');
  if (!trigger || !valueEl || !menu) return null;

  const state = { root, trigger, valueEl, menu, options: [] };
  customSelectState.set(input, state);

  const menuId = `${input.id || 'xvm-select'}-listbox`;
  menu.id = menuId;
  trigger.setAttribute('aria-controls', menuId);

  trigger.addEventListener('click', () => {
    if (root.dataset.open === '1') {
      closeCustomSelect(input);
    } else {
      openCustomSelect(input);
    }
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openCustomSelect(input);
      focusSelectedCustomSelectOption(input);
    }
  });
  menu.addEventListener('keydown', (e) => {
    const buttons = [...menu.querySelectorAll('.xvm-select-option')];
    const current = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCustomSelect(input);
      trigger.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[Math.min(current + 1, buttons.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[Math.max(current - 1, 0)]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.activeElement?.click?.();
    }
  });

  if (!document.__xvmCustomSelectOutside) {
    document.__xvmCustomSelectOutside = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.xvm-select[data-open="1"]').forEach((openRoot) => {
        if (!openRoot.contains(e.target)) closeCustomSelect(openRoot.querySelector('input[type="hidden"]'));
      });
    });
  }

  return state;
}

function closeCustomSelect(input) {
  const state = customSelectState.get(input);
  if (!state) return;
  state.root.dataset.open = '0';
  state.trigger.setAttribute('aria-expanded', 'false');
}

function openCustomSelect(input) {
  const state = initCustomSelect(input);
  if (!state) return;
  document.querySelectorAll('.xvm-select[data-open="1"]').forEach((openRoot) => {
    const openInput = openRoot.querySelector('input[type="hidden"]');
    if (openInput !== input) closeCustomSelect(openInput);
  });
  state.root.dataset.open = '1';
  state.trigger.setAttribute('aria-expanded', 'true');
}

function focusSelectedCustomSelectOption(input) {
  const state = customSelectState.get(input);
  if (!state) return;
  const selected = state.menu.querySelector('.xvm-select-option[aria-selected="true"]')
    || state.menu.querySelector('.xvm-select-option');
  selected?.focus();
}

function setCustomSelectValue(input, value, opts = {}) {
  const state = initCustomSelect(input);
  if (!state) {
    if (input) input.value = value;
    return;
  }
  const next = String(value ?? '');
  input.value = next;
  const active = state.options.find((item) => item.value === next) || state.options[0];
  state.valueEl.textContent = active?.label || '';
  state.menu.querySelectorAll('.xvm-select-option').forEach((btn) => {
    const selected = btn.dataset.value === next;
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  if (opts.dispatch) input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setCustomSelectOptions(input, options, selectedValue = input?.value) {
  const state = initCustomSelect(input);
  if (!state) return;
  state.options = options.map((item) => ({
    value: String(item.value),
    label: String(item.label),
  }));
  state.menu.innerHTML = '';
  state.options.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xvm-select-option';
    btn.setAttribute('role', 'option');
    btn.dataset.value = item.value;
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      setCustomSelectValue(input, item.value, { dispatch: true });
      closeCustomSelect(input);
      state.trigger.focus();
    });
    state.menu.appendChild(btn);
  });
  const hasSelected = state.options.some((item) => item.value === String(selectedValue ?? ''));
  setCustomSelectValue(input, hasSelected ? selectedValue : state.options[0]?.value || '');
}

function normalizeColumns(raw) {
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    if (!c || typeof c.id !== 'string' || !KNOWN_COLUMN_IDS.includes(c.id)) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, visible: !!c.visible });
  }
  for (const def of DEFAULT_COLUMNS) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const leaderboardToggle = document.getElementById('feat-leaderboard');
const leaderboardEdgeHideToggle = document.getElementById('lb-edge-hide');
const copyMdToggle = document.getElementById('feat-copy-md');
const starChartToggle = document.getElementById('feat-starchart');
const bookmarkCountToggle = document.getElementById('feat-bookmark-count');
const leaderboardCountInput = document.getElementById('lb-count');
const badgeStyleSelect = document.getElementById('badge-style');
const languageSelect = document.getElementById('language-select');
const languageToggle = document.getElementById('language-toggle');
const colListEl = document.getElementById('lb-col-list');
const grokTemplateSelect = document.getElementById('grok-template-select');
const grokTemplateNameInput = document.getElementById('grok-template-name');
const grokPromptInput = document.getElementById('grok-prompt');
const grokPromptSaveBtn = document.getElementById('grok-prompt-save');
const grokPromptResetBtn = document.getElementById('grok-prompt-reset');
const grokPromptAddBtn = document.getElementById('grok-prompt-add');
const grokPromptDeleteBtn = document.getElementById('grok-prompt-delete');
const grokTempChatToggle = document.getElementById('grok-temp-chat');
// Parallel set for article-length sources.
const grokArticleTemplateSelect = document.getElementById('grok-article-template-select');
const grokArticleTemplateNameInput = document.getElementById('grok-article-template-name');
const grokArticlePromptInput = document.getElementById('grok-article-prompt');
const grokArticlePromptSaveBtn = document.getElementById('grok-article-prompt-save');
const grokArticlePromptResetBtn = document.getElementById('grok-article-prompt-reset');
const grokArticlePromptAddBtn = document.getElementById('grok-article-prompt-add');
const grokArticlePromptDeleteBtn = document.getElementById('grok-article-prompt-delete');

setCustomSelectOptions(badgeStyleSelect, [
  { value: 'pill-solid', label: tr('badgeStylePillSolid') || 'Pill solid' },
  { value: 'inline-classic', label: tr('badgeStyleInlineClassic') || 'Inline classic' },
], 'pill-solid');

setCustomSelectOptions(languageSelect, [
  { value: 'auto', label: tr('languageAuto') || LANGUAGE_LABELS.auto },
  { value: 'zh_CN', label: tr('languageZh') || LANGUAGE_LABELS.zh_CN },
  { value: 'en', label: tr('languageEn') || LANGUAGE_LABELS.en },
  { value: 'ja', label: tr('languageJa') || LANGUAGE_LABELS.ja },
], initialLanguagePref);

function getLanguageDisplayName(language) {
  const normalized = normalizeLanguage(language);
  const key = normalized === 'auto' ? 'languageAuto'
    : normalized === 'zh_CN' ? 'languageZh'
    : normalized === 'ja' ? 'languageJa'
    : 'languageEn';
  return tr(key) || LANGUAGE_LABELS[normalized] || LANGUAGE_LABELS.auto;
}

function updateLanguageToggle(language) {
  if (!languageToggle) return;
  const normalized = normalizeLanguage(language);
  const label = getLanguageDisplayName(normalized);
  languageToggle.querySelector('.language-toggle-text').textContent = LANGUAGE_TOGGLE_TEXT[normalized] || LANGUAGE_TOGGLE_TEXT.auto;
  languageToggle.title = `${tr('languageLabel')}: ${label}`;
  languageToggle.setAttribute('aria-label', `${tr('languageLabel')}: ${label}`);
}

function buildLanguageStoragePatch(language) {
  const normalized = normalizeLanguage(language);
  const effective = getEffectiveLanguageId(normalized);
  const next = { language: normalized };
  if (isUnmodifiedBundledGrokTemplateSet(grokTemplatesState, 'promptTemplates')) {
    const defs = getLocalizedGrokDefaults(effective);
    next.grokCommentPrompt = defs.grokCommentPrompt;
    next.grokPromptTemplates = defs.grokPromptTemplates;
    next.grokSelectedPromptId = defs.grokSelectedPromptId;
  }
  if (isUnmodifiedBundledGrokTemplateSet(grokArticleTemplatesState, 'articlePromptTemplates')) {
    const defs = getLocalizedGrokDefaults(effective);
    next.grokArticlePromptTemplates = defs.grokArticlePromptTemplates;
    next.grokSelectedArticlePromptId = defs.grokSelectedArticlePromptId;
  }
  return next;
}

function applyLanguageChange(language) {
  const normalized = normalizeLanguage(language);
  updateLanguageToggle(normalized);
  setCustomSelectValue(languageSelect, normalized);
  try { localStorage.setItem(LANGUAGE_KEY, normalized); } catch (_) {}
  chrome.storage.sync.set(buildLanguageStoragePatch(normalized), () => {
    location.reload();
  });
}
updateLanguageToggle(initialLanguagePref);

let columnsState = normalizeColumns(null);
let grokTemplatesState = DEFAULT_FEATURES.grokPromptTemplates.map((tpl) => ({ ...tpl }));
let grokSelectedTemplateId = DEFAULT_FEATURES.grokSelectedPromptId;
let grokArticleTemplatesState = DEFAULT_FEATURES.grokArticlePromptTemplates.map((tpl) => ({ ...tpl }));
let grokSelectedArticleTemplateId = DEFAULT_FEATURES.grokSelectedArticlePromptId;

function normalizeCount(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, n));
}

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

function normalizeGrokTemplates(raw, legacyPrompt) {
  const source = Array.isArray(raw) && raw.length
    ? raw
    : [{ id: 'default', name: tr('grokDefaultTemplateName'), prompt: legacyPrompt || DEFAULT_FEATURES.grokCommentPrompt }];
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
      name: String(item?.name || tr('grokCustomTemplateName', [String(out.length + 1)])).trim() || tr('grokCustomTemplateName', [String(out.length + 1)]),
      prompt,
    });
  }
  return out.length ? out : DEFAULT_FEATURES.grokPromptTemplates.map((tpl) => ({ ...tpl }));
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
  leaderboardToggle.checked = !!items.featureVelocityLeaderboard;
  leaderboardEdgeHideToggle.checked = items.leaderboardEdgeHideEnabled !== false;
  copyMdToggle.checked = items.featureCopyAsMarkdown !== false;
  starChartToggle.checked = items.featureStarChart !== false;
  bookmarkCountToggle.checked = items.showBookmarkCount !== false;
  leaderboardCountInput.value = normalizeCount(items.leaderboardCount);
  setCustomSelectValue(badgeStyleSelect, items.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid');
  const storedLanguage = normalizeLanguage(items.language || initialLanguagePref);
  if (storedLanguage !== initialLanguagePref) {
    try { localStorage.setItem(LANGUAGE_KEY, storedLanguage); } catch (_) {}
    location.reload();
    return;
  }
  setCustomSelectValue(languageSelect, storedLanguage);
  updateLanguageToggle(storedLanguage);
  grokTemplatesState = normalizeGrokTemplates(items.grokPromptTemplates, items.grokCommentPrompt);
  grokSelectedTemplateId = items.grokSelectedPromptId || grokTemplatesState[0]?.id || 'default';
  if (!grokTemplatesState.some((tpl) => tpl.id === grokSelectedTemplateId)) {
    grokSelectedTemplateId = grokTemplatesState[0]?.id || 'default';
  }
  grokArticleTemplatesState = normalizeGrokTemplates(items.grokArticlePromptTemplates);
  if (!grokArticleTemplatesState.length) {
    grokArticleTemplatesState = DEFAULT_FEATURES.grokArticlePromptTemplates.map((t) => ({ ...t }));
  }
  grokSelectedArticleTemplateId = items.grokSelectedArticlePromptId || grokArticleTemplatesState[0]?.id || 'article-default';
  if (!grokArticleTemplatesState.some((tpl) => tpl.id === grokSelectedArticleTemplateId)) {
    grokSelectedArticleTemplateId = grokArticleTemplatesState[0]?.id || 'article-default';
  }
  if (grokTempChatToggle) grokTempChatToggle.checked = items.grokTemporaryChat !== false;
  renderGrokTemplateEditor();
  renderGrokArticleTemplateEditor();
  columnsState = normalizeColumns(items.leaderboardColumns);
  renderColList();
});

function renderGrokTemplateEditor() {
  if (!grokTemplateSelect || !grokPromptInput || !grokTemplateNameInput) return;
  setCustomSelectOptions(
    grokTemplateSelect,
    grokTemplatesState.map((tpl) => ({ value: tpl.id, label: tpl.name })),
    grokSelectedTemplateId
  );
  const active = grokTemplatesState.find((tpl) => tpl.id === grokSelectedTemplateId) || grokTemplatesState[0];
  if (active) {
    grokSelectedTemplateId = active.id;
    setCustomSelectValue(grokTemplateSelect, active.id);
    grokTemplateNameInput.value = active.name;
    grokPromptInput.value = active.prompt;
  }
  if (grokPromptDeleteBtn) grokPromptDeleteBtn.disabled = grokTemplatesState.length <= 1;
}

function persistGrokTemplates(messageKey = 'flashGrokPromptSaved') {
  const active = grokTemplatesState.find((tpl) => tpl.id === grokSelectedTemplateId) || grokTemplatesState[0];
  chrome.storage.sync.set({
    grokCommentPrompt: active?.prompt || DEFAULT_FEATURES.grokCommentPrompt,
    grokPromptTemplates: grokTemplatesState,
    grokSelectedPromptId: active?.id || 'default',
  }, () => flash(tr(messageKey)));
}

function renderGrokArticleTemplateEditor() {
  if (!grokArticleTemplateSelect || !grokArticlePromptInput || !grokArticleTemplateNameInput) return;
  setCustomSelectOptions(
    grokArticleTemplateSelect,
    grokArticleTemplatesState.map((tpl) => ({ value: tpl.id, label: tpl.name })),
    grokSelectedArticleTemplateId
  );
  const active = grokArticleTemplatesState.find((tpl) => tpl.id === grokSelectedArticleTemplateId) || grokArticleTemplatesState[0];
  if (active) {
    grokSelectedArticleTemplateId = active.id;
    setCustomSelectValue(grokArticleTemplateSelect, active.id);
    grokArticleTemplateNameInput.value = active.name;
    grokArticlePromptInput.value = active.prompt;
  }
  if (grokArticlePromptDeleteBtn) grokArticlePromptDeleteBtn.disabled = grokArticleTemplatesState.length <= 1;
}

function persistGrokArticleTemplates(messageKey = 'flashGrokPromptSaved') {
  const active = grokArticleTemplatesState.find((tpl) => tpl.id === grokSelectedArticleTemplateId) || grokArticleTemplatesState[0];
  chrome.storage.sync.set({
    grokArticlePromptTemplates: grokArticleTemplatesState,
    grokSelectedArticlePromptId: active?.id || 'article-default',
  }, () => flash(tr(messageKey)));
}

function renderColList() {
  colListEl.innerHTML = '';
  columnsState.forEach((col, idx) => {
    const li = document.createElement('li');
    li.className = 'col-item' + (col.visible ? '' : ' col-hidden');
    li.draggable = true;
    li.dataset.idx = String(idx);
    li.dataset.id = col.id;
    li.innerHTML = `
      <span class="col-grip">⋮⋮</span>
      <input type="checkbox" ${col.visible ? 'checked' : ''}>
      <span class="col-name">${COLUMN_LABEL_KEYS[col.id] ? tr(COLUMN_LABEL_KEYS[col.id]) : col.id}</span>
    `;
    const checkbox = li.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      columnsState[idx].visible = checkbox.checked;
      li.classList.toggle('col-hidden', !checkbox.checked);
      persistColumns();
    });
    colListEl.appendChild(li);
  });
}

let draggingIdx = -1;
colListEl.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.col-item');
  if (!li) return;
  draggingIdx = Number(li.dataset.idx);
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Firefox requires data to be set to initiate drag
  e.dataTransfer.setData('text/plain', li.dataset.id);
});
colListEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const li = e.target.closest('.col-item');
  if (!li) return;
  colListEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  li.classList.add('drag-over');
});
colListEl.addEventListener('dragleave', (e) => {
  const li = e.target.closest('.col-item');
  if (li) li.classList.remove('drag-over');
});
colListEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('.col-item');
  if (!li || draggingIdx < 0) return;
  const targetIdx = Number(li.dataset.idx);
  if (targetIdx === draggingIdx) return;
  const [moved] = columnsState.splice(draggingIdx, 1);
  columnsState.splice(targetIdx, 0, moved);
  draggingIdx = -1;
  renderColList();
  persistColumns();
});
colListEl.addEventListener('dragend', () => {
  draggingIdx = -1;
  colListEl.querySelectorAll('.dragging,.drag-over').forEach((el) => {
    el.classList.remove('dragging');
    el.classList.remove('drag-over');
  });
});

function persistColumns() {
  chrome.storage.sync.set({ leaderboardColumns: columnsState }, () => flash(tr('flashColumnsSaved')));
}

leaderboardToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureVelocityLeaderboard: leaderboardToggle.checked }, () => {
    flash(tr(leaderboardToggle.checked ? 'flashLeaderboardOn' : 'flashLeaderboardOff'));
  });
});

leaderboardEdgeHideToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ leaderboardEdgeHideEnabled: leaderboardEdgeHideToggle.checked }, () => {
    flash(tr(leaderboardEdgeHideToggle.checked ? 'flashLeaderboardEdgeHideOn' : 'flashLeaderboardEdgeHideOff'));
  });
});

copyMdToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureCopyAsMarkdown: copyMdToggle.checked }, () => {
    flash(tr(copyMdToggle.checked ? 'flashCopyMdOn' : 'flashCopyMdOff'));
  });
});

starChartToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureStarChart: starChartToggle.checked }, () => {
    flash(tr(starChartToggle.checked ? 'flashStarChartOn' : 'flashStarChartOff'));
  });
});

bookmarkCountToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ showBookmarkCount: bookmarkCountToggle.checked }, () => {
    flash(tr(bookmarkCountToggle.checked ? 'flashBookmarkCountOn' : 'flashBookmarkCountOff'));
  });
});

grokTempChatToggle?.addEventListener('change', () => {
  chrome.storage.sync.set({ grokTemporaryChat: grokTempChatToggle.checked }, () => {
    flash(tr(grokTempChatToggle.checked ? 'flashGrokTempChatOn' : 'flashGrokTempChatOff'));
  });
});

grokPromptSaveBtn?.addEventListener('click', () => {
  const active = grokTemplatesState.find((tpl) => tpl.id === grokSelectedTemplateId);
  const prompt = (grokPromptInput.value || '').trim() || DEFAULT_FEATURES.grokCommentPrompt;
  if (active) {
    const fallbackName = tr('grokCustomTemplateName', [String(grokTemplatesState.indexOf(active) + 1 || 1)]);
    active.name = (grokTemplateNameInput.value || '').trim() || active.name || fallbackName;
    active.prompt = prompt;
  }
  grokPromptInput.value = prompt;
  renderGrokTemplateEditor();
  persistGrokTemplates('flashGrokPromptSaved');
});

grokPromptResetBtn?.addEventListener('click', () => {
  grokTemplatesState = DEFAULT_FEATURES.grokPromptTemplates.map((tpl) => ({ ...tpl }));
  grokSelectedTemplateId = DEFAULT_FEATURES.grokSelectedPromptId;
  renderGrokTemplateEditor();
  persistGrokTemplates('flashGrokPromptReset');
});

grokTemplateSelect?.addEventListener('change', () => {
  grokSelectedTemplateId = grokTemplateSelect.value;
  renderGrokTemplateEditor();
  persistGrokTemplates('flashGrokPromptSaved');
});

grokPromptAddBtn?.addEventListener('click', () => {
  const id = `custom-${Date.now()}`;
  grokTemplatesState.push({
    id,
    name: tr('grokCustomTemplateName', [String(grokTemplatesState.length + 1)]),
    prompt: DEFAULT_FEATURES.grokCommentPrompt,
  });
  grokSelectedTemplateId = id;
  renderGrokTemplateEditor();
  persistGrokTemplates('flashGrokPromptSaved');
});

grokPromptDeleteBtn?.addEventListener('click', () => {
  if (grokTemplatesState.length <= 1) return;
  grokTemplatesState = grokTemplatesState.filter((tpl) => tpl.id !== grokSelectedTemplateId);
  grokSelectedTemplateId = grokTemplatesState[0]?.id || 'default';
  renderGrokTemplateEditor();
  persistGrokTemplates('flashGrokPromptSaved');
});

// Article-template handlers — parallel to the tweet-template handlers above.
grokArticlePromptSaveBtn?.addEventListener('click', () => {
  const active = grokArticleTemplatesState.find((tpl) => tpl.id === grokSelectedArticleTemplateId);
  const prompt = (grokArticlePromptInput.value || '').trim()
              || DEFAULT_FEATURES.grokArticlePromptTemplates[0].prompt;
  if (active) {
    active.name = (grokArticleTemplateNameInput.value || '').trim() || active.name || tr('grokArticleFallbackName');
    active.prompt = prompt;
  }
  grokArticlePromptInput.value = prompt;
  renderGrokArticleTemplateEditor();
  persistGrokArticleTemplates('flashGrokPromptSaved');
});

grokArticlePromptResetBtn?.addEventListener('click', () => {
  grokArticleTemplatesState = DEFAULT_FEATURES.grokArticlePromptTemplates.map((tpl) => ({ ...tpl }));
  grokSelectedArticleTemplateId = DEFAULT_FEATURES.grokSelectedArticlePromptId;
  renderGrokArticleTemplateEditor();
  persistGrokArticleTemplates('flashGrokPromptReset');
});

grokArticleTemplateSelect?.addEventListener('change', () => {
  grokSelectedArticleTemplateId = grokArticleTemplateSelect.value;
  renderGrokArticleTemplateEditor();
  persistGrokArticleTemplates('flashGrokPromptSaved');
});

grokArticlePromptAddBtn?.addEventListener('click', () => {
  const id = `article-custom-${Date.now()}`;
  grokArticleTemplatesState.push({
    id,
    name: tr('grokArticleCustomTemplateName', [String(grokArticleTemplatesState.length + 1)]),
    prompt: DEFAULT_FEATURES.grokArticlePromptTemplates[0].prompt,
  });
  grokSelectedArticleTemplateId = id;
  renderGrokArticleTemplateEditor();
  persistGrokArticleTemplates('flashGrokPromptSaved');
});

grokArticlePromptDeleteBtn?.addEventListener('click', () => {
  if (grokArticleTemplatesState.length <= 1) return;
  grokArticleTemplatesState = grokArticleTemplatesState.filter((tpl) => tpl.id !== grokSelectedArticleTemplateId);
  grokSelectedArticleTemplateId = grokArticleTemplatesState[0]?.id || 'article-default';
  renderGrokArticleTemplateEditor();
  persistGrokArticleTemplates('flashGrokPromptSaved');
});

leaderboardCountInput.addEventListener('change', () => {
  const n = normalizeCount(leaderboardCountInput.value);
  leaderboardCountInput.value = n;
  chrome.storage.sync.set({ leaderboardCount: n }, () => flash(tr('flashShowingTop', [String(n)])));
});

badgeStyleSelect.addEventListener('change', () => {
  const style = badgeStyleSelect.value === 'inline-classic' ? 'inline-classic' : 'pill-solid';
  chrome.storage.sync.set({ badgeStyle: style }, () => flash(tr('flashBadgeStyleSaved')));
});

languageSelect?.addEventListener('change', () => {
  applyLanguageChange(languageSelect.value);
});

languageToggle?.addEventListener('click', () => {
  const current = normalizeLanguage(languageSelect?.value || initialLanguagePref);
  const idx = SUPPORTED_LANGUAGE_IDS.indexOf(current);
  const next = SUPPORTED_LANGUAGE_IDS[(Math.max(idx, 0) + 1) % SUPPORTED_LANGUAGE_IDS.length];
  applyLanguageChange(next);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = normalize({ trending: trendingInput.value, viral: viralInput.value });
  const style = badgeStyleSelect.value === 'inline-classic' ? 'inline-classic' : 'pill-solid';
  fill(v);
  chrome.storage.sync.set({ ...v, badgeStyle: style }, () => flash(tr('flashSaved')));
});

resetBtn.addEventListener('click', () => {
  fill(DEFAULT_THRESHOLDS);
  setCustomSelectValue(badgeStyleSelect, 'pill-solid');
  chrome.storage.sync.set({ ...DEFAULT_THRESHOLDS, badgeStyle: 'pill-solid' }, () => flash(tr('flashReset')));
});

// #45 dev3 add-on: leaderboard "reset position" button. Clears the three
// persisted dimensions (pos / width / height) so the panel returns to its
// default on the next page load. Simple version — user must refresh; the
// live-reset path goes through bridge → content.js and is queued as a
// follow-up task in #dev.
const lbResetBtn = document.getElementById('lb-reset-pos');
const lbResetMsg = document.getElementById('lb-reset-msg');
lbResetBtn?.addEventListener('click', () => {
  chrome.storage.local.remove(
    ['xvmLeaderboardPos', 'xvmLeaderboardWidth', 'xvmLeaderboardHeight'],
    () => {
      if (!lbResetMsg) return;
      lbResetMsg.textContent = tr('featureLeaderboardResetDone');
      setTimeout(() => { lbResetMsg.textContent = ''; }, 2500);
    }
  );
});

// Footer version: read from manifest so it never drifts from the actual
// shipped build.
const versionEl = document.getElementById('popup-version');
if (versionEl) {
  try { versionEl.textContent = chrome.runtime.getManifest().version; } catch (_) {}
}
