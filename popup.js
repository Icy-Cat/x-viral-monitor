const DEFAULT_THRESHOLDS = { trending: 1000, viral: 10000 };
const DEFAULT_FEATURES = { featureVelocityLeaderboard: false };
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

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const leaderboardToggle = document.getElementById('feat-leaderboard');

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
});

leaderboardToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureVelocityLeaderboard: leaderboardToggle.checked }, () => {
    flash(leaderboardToggle.checked ? 'Leaderboard ON ✓' : 'Leaderboard OFF');
  });
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
