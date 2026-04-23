const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };
const DEFAULT_COLUMNS = [
  { id: 'rank',     visible: true  },
  { id: 'icon',     visible: true  },
  { id: 'handle',   visible: false },
  { id: 'preview',  visible: true  },
  { id: 'views',    visible: true  },
  { id: 'velocity', visible: true  },
];
const COLUMN_LABELS = {
  rank: 'Rank',
  icon: 'Tier icon',
  handle: 'Username',
  preview: 'Tweet preview',
  views: 'Views',
  velocity: 'Velocity',
};
const KNOWN_COLUMN_IDS = DEFAULT_COLUMNS.map((c) => c.id);
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
  featureCopyAsMarkdown: true,
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

// Apply chrome.i18n translations to any element marked with data-i18n.
// Falls back to the hardcoded English text in the HTML if a key is missing.
function t(key) {
  try {
    return chrome.i18n.getMessage(key) || '';
  } catch (e) {
    return '';
  }
}
document.querySelectorAll('[data-i18n]').forEach((el) => {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
});

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
const leaderboardCountInput = document.getElementById('lb-count');
const colListEl = document.getElementById('lb-col-list');

let columnsState = normalizeColumns(null);

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
  leaderboardCountInput.value = normalizeCount(items.leaderboardCount);
  columnsState = normalizeColumns(items.leaderboardColumns);
  renderColList();
});

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
      <span class="col-name">${COLUMN_LABELS[col.id] || col.id}</span>
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
  chrome.storage.sync.set({ leaderboardColumns: columnsState }, () => flash('Columns saved ✓'));
}

leaderboardToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureVelocityLeaderboard: leaderboardToggle.checked }, () => {
    flash(leaderboardToggle.checked ? 'Leaderboard ON ✓' : 'Leaderboard OFF');
  });
});

copyMdToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureCopyAsMarkdown: copyMdToggle.checked }, () => {
    flash(copyMdToggle.checked ? 'Copy-as-Markdown ON ✓' : 'Copy-as-Markdown OFF');
  });
});

leaderboardCountInput.addEventListener('change', () => {
  const n = normalizeCount(leaderboardCountInput.value);
  leaderboardCountInput.value = n;
  chrome.storage.sync.set({ leaderboardCount: n }, () => flash(`Showing top ${n} ✓`));
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = normalize({ trending: trendingInput.value, viral: viralInput.value });
  fill(v);
  chrome.storage.sync.set(v, () => flash(t('flashSaved') || 'Saved ✓'));
});

resetBtn.addEventListener('click', () => {
  fill(DEFAULT_THRESHOLDS);
  chrome.storage.sync.set(DEFAULT_THRESHOLDS, () => flash(t('flashReset') || 'Reset ✓'));
});
