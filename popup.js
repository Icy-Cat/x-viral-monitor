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
  grokArticlePromptTemplates: [
    { id: 'article-default', name: '文章评论', prompt: '以下是一篇 X 长文 / Article：\n\n[推文内容]\n\n为这篇长文生成10条评论。要求：每条评论引用文章中具体的观点或论据进行回应（赞同/质疑/补充），避免笼统的"很有启发"这类空话；语气自然像真人；每条评论用代码块包裹。' },
    { id: 'article-deep', name: '深度回应', prompt: '以下是一篇长文：\n\n[推文内容]\n\n挑选这篇长文中最值得讨论的3-5个核心论点，针对每个论点给出1-2条有信息密度的评论（提出延伸思考、反例、或个人经验），每条评论用代码块包裹。' },
  ],
  grokSelectedPromptId: 'default',
  grokSelectedArticlePromptId: 'article-default',
  grokTemporaryChat: true,
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
const copyMdToggle = document.getElementById('feat-copy-md');
const starChartToggle = document.getElementById('feat-starchart');
const leaderboardCountInput = document.getElementById('lb-count');
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
  copyMdToggle.checked = items.featureCopyAsMarkdown !== false;
  starChartToggle.checked = items.featureStarChart !== false;
  leaderboardCountInput.value = normalizeCount(items.leaderboardCount);
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
  grokTemplateSelect.innerHTML = '';
  grokTemplatesState.forEach((tpl) => {
    const option = document.createElement('option');
    option.value = tpl.id;
    option.textContent = tpl.name;
    option.selected = tpl.id === grokSelectedTemplateId;
    grokTemplateSelect.appendChild(option);
  });
  const active = grokTemplatesState.find((tpl) => tpl.id === grokSelectedTemplateId) || grokTemplatesState[0];
  if (active) {
    grokSelectedTemplateId = active.id;
    grokTemplateSelect.value = active.id;
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
  grokArticleTemplateSelect.innerHTML = '';
  grokArticleTemplatesState.forEach((tpl) => {
    const option = document.createElement('option');
    option.value = tpl.id;
    option.textContent = tpl.name;
    option.selected = tpl.id === grokSelectedArticleTemplateId;
    grokArticleTemplateSelect.appendChild(option);
  });
  const active = grokArticleTemplatesState.find((tpl) => tpl.id === grokSelectedArticleTemplateId) || grokArticleTemplatesState[0];
  if (active) {
    grokSelectedArticleTemplateId = active.id;
    grokArticleTemplateSelect.value = active.id;
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

grokTempChatToggle?.addEventListener('change', () => {
  chrome.storage.sync.set({ grokTemporaryChat: grokTempChatToggle.checked }, () => {
    flash(tr(grokTempChatToggle.checked ? 'flashGrokTempChatOn' : 'flashGrokTempChatOff'));
  });
});

grokPromptSaveBtn?.addEventListener('click', () => {
  const active = grokTemplatesState.find((tpl) => tpl.id === grokSelectedTemplateId);
  const prompt = (grokPromptInput.value || '').trim() || DEFAULT_FEATURES.grokCommentPrompt;
  if (active) {
    active.name = (grokTemplateNameInput.value || '').trim() || active.name || '模板';
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
    name: `模板 ${grokTemplatesState.length + 1}`,
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
    active.name = (grokArticleTemplateNameInput.value || '').trim() || active.name || '文章模板';
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
    name: `文章模板 ${grokArticleTemplatesState.length + 1}`,
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

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = normalize({ trending: trendingInput.value, viral: viralInput.value });
  fill(v);
  chrome.storage.sync.set(v, () => flash(tr('flashSaved')));
});

resetBtn.addEventListener('click', () => {
  fill(DEFAULT_THRESHOLDS);
  chrome.storage.sync.set(DEFAULT_THRESHOLDS, () => flash(tr('flashReset')));
});

