// === Tweet Data Store ===
const tweetDataStore = new Map();
const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
let velocityThresholds = { ...DEFAULT_THRESHOLDS };

// === i18n ===
let localizedStrings = {};
function i18n(key) { return localizedStrings[key] || key; }

function applyLocalizedUi() {
  if (!leaderboardEl) return;
  const head = leaderboardEl.querySelector('.xvm-lb-head');
  const title = leaderboardEl.querySelector('.xvm-lb-title');
  const back = leaderboardEl.querySelector('.xvm-lb-back');
  if (head) head.title = i18n('contentLeaderboardDragToMove');
  if (title) title.textContent = `🔥 ${i18n('contentLeaderboardTitle')}`;
  if (back) {
    back.title = i18n('contentLeaderboardBackToPrevious');
    back.setAttribute('aria-label', i18n('contentLeaderboardBackToPrevious'));
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

let leaderboardEnabled = false;
let leaderboardCount = 10;
const DEFAULT_LB_COLUMNS = [
  { id: 'rank',     visible: true  },
  { id: 'icon',     visible: true  },
  { id: 'handle',   visible: false },
  { id: 'preview',  visible: true  },
  { id: 'views',    visible: true  },
  { id: 'velocity', visible: true  },
];
let leaderboardColumns = DEFAULT_LB_COLUMNS.map((c) => ({ ...c }));
let copyAsMarkdownEnabled = true;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_SETTINGS_UPDATE') return;

  localizedStrings = event.data.messages || localizedStrings;
  applyLocalizedUi();
  velocityThresholds = normalizeThresholds(event.data.thresholds);
  document.querySelectorAll('article[data-xvm-scored]').forEach((article) => {
    article.removeAttribute('data-xvm-scored');
  });
  document.querySelectorAll('.xvm-badge').forEach((badge) => {
    badge.remove();
  });
  renderBadges();

  const nextLb = !!event.data.featureVelocityLeaderboard;
  const nextCount = Number.isFinite(event.data.leaderboardCount) ? event.data.leaderboardCount : 10;
  const nextCols = Array.isArray(event.data.leaderboardColumns) && event.data.leaderboardColumns.length
    ? event.data.leaderboardColumns
    : leaderboardColumns;
  const countChanged = nextCount !== leaderboardCount;
  const colsChanged = JSON.stringify(nextCols) !== JSON.stringify(leaderboardColumns);
  leaderboardCount = nextCount;
  leaderboardColumns = nextCols;
  if (nextLb !== leaderboardEnabled) {
    leaderboardEnabled = nextLb;
    if (leaderboardEnabled) {
      renderLeaderboard();
    } else {
      hideLeaderboard();
    }
  } else if (leaderboardEnabled && (countChanged || colsChanged)) {
    renderLeaderboard();
  }

  copyAsMarkdownEnabled = event.data.featureCopyAsMarkdown !== false;
});

window.postMessage({ type: 'XVM_REQUEST_SETTINGS' }, '*');

// === Request Interception (fetch + XHR) ===
const GRAPHQL_RE = /\/i\/api\/graphql\//;

// Extract and report rate limit headers
function reportRateLimit(headers) {
  const remaining = headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-rate-limit-reset');
  if (remaining !== null) {
    window.postMessage({
      type: 'XVM_RATE_LIMIT',
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
    }, '*');
  }
}

// Hook fetch
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (url && GRAPHQL_RE.test(url)) {
    reportRateLimit(response.headers);
    const clone = response.clone();
    clone.json().then(scanForTweets).catch(() => {});
  }
  return response;
};

// Hook XMLHttpRequest — attach listener in open() to avoid X caching send()
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  if (typeof url === 'string' && GRAPHQL_RE.test(url)) {
    this.addEventListener('load', function () {
      try {
        // Report rate limit from XHR headers
        const remaining = this.getResponseHeader('x-rate-limit-remaining');
        const reset = this.getResponseHeader('x-rate-limit-reset');
        if (remaining !== null) {
          window.postMessage({
            type: 'XVM_RATE_LIMIT',
            remaining: parseInt(remaining, 10),
            reset: parseInt(reset, 10),
          }, '*');
        }
        scanForTweets(JSON.parse(this.responseText));
      } catch (e) {}
    });
  }
  return originalXHROpen.call(this, method, url, ...rest);
};

// === Data Extraction ===
// Recursively scan any JSON for tweet_results objects
function scanForTweets(obj) {
  if (!obj || typeof obj !== 'object') return;
  let found = false;

  if (obj.tweet_results?.result) {
    const data = extractTweetData(obj.tweet_results.result);
    if (data) { tweetDataStore.set(data.id, data); found = true; }
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) scanForTweets(item);
  } else {
    for (const key of Object.keys(obj)) {
      if (key === 'tweet_results') continue; // already handled above
      const val = obj[key];
      if (val && typeof val === 'object') scanForTweets(val);
    }
  }

  if (found) renderBadges();
}

function extractTweetData(result) {
  const tweet = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy) return null;

  const rtResult = legacy.retweeted_status_result?.result;
  if (rtResult) {
    return extractTweetData(rtResult);
  }

  const viewCount = parseInt(tweet.views?.count, 10);
  if (!viewCount || tweet.views?.state !== 'EnabledWithCount') return null;

  if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

  const urlMap = {};
  for (const u of legacy.entities?.urls || []) {
    if (u?.url && u.expanded_url) urlMap[u.url] = u.expanded_url;
  }

  // Long-form tweet body (note_tweet) overrides full_text if present
  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
  for (const u of tweet.note_tweet?.note_tweet_results?.result?.entity_set?.urls || []) {
    if (u?.url && u.expanded_url && !urlMap[u.url]) urlMap[u.url] = u.expanded_url;
  }

  // X Article (long-form essay) content
  const articleResult = tweet.article?.article_results?.result;
  let articleMd = '';
  if (articleResult) {
    articleMd = buildArticleMarkdown(articleResult);
  }
  for (const m of legacy.extended_entities?.media || legacy.entities?.media || []) {
    if (!m?.url) continue;
    if (m.type === 'photo') {
      urlMap[m.url] = `![](${m.media_url_https})`;
    } else if (m.type === 'video' || m.type === 'animated_gif') {
      const variants = m.video_info?.variants || [];
      const mp4s = variants.filter((v) => v.content_type === 'video/mp4' && v.bitrate != null);
      mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const videoUrl = mp4s[0]?.url || m.media_url_https;
      urlMap[m.url] = `[📹 video](${videoUrl})`;
    } else {
      urlMap[m.url] = m.media_url_https;
    }
  }

  return {
    id: legacy.id_str,
    views: viewCount,
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    bookmarks: legacy.bookmark_count || 0,
    createdAt: legacy.created_at,
    text: noteText || legacy.full_text || '',
    urlMap,
    articleMd,
  };
}

// Draft.js-style content_state → Markdown for X Articles
function buildArticleMarkdown(articleResult) {
  const title = articleResult.title || '';
  const coverUrl = articleResult.cover_media?.media_info?.original_img_url
    || articleResult.cover_media?.media_info?.media_url_https
    || '';

  let state = articleResult.content_state;
  if (typeof state === 'string') {
    try { state = JSON.parse(state); } catch (_) { state = null; }
  }

  const lines = [];
  if (title) lines.push(`# ${title}`, '');
  if (coverUrl) lines.push(`![](${coverUrl})`, '');

  if (state?.blocks?.length) {
    // Build a map of entityKey → entity (for LINK / IMAGE)
    const entityMap = state.entityMap || {};
    for (const block of state.blocks) {
      lines.push(renderArticleBlock(block, entityMap));
    }
  } else if (articleResult.preview_text) {
    lines.push(articleResult.preview_text);
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderArticleBlock(block, entityMap) {
  const type = block.type || 'unstyled';
  const raw = block.text || '';
  const text = applyInlineFormatting(raw, block.inlineStyleRanges || [], block.entityRanges || [], entityMap);

  switch (type) {
    case 'header-one':   return `# ${text}\n`;
    case 'header-two':   return `## ${text}\n`;
    case 'header-three': return `### ${text}\n`;
    case 'unordered-list-item': return `- ${text}`;
    case 'ordered-list-item':   return `1. ${text}`;
    case 'blockquote':   return `> ${text}`;
    case 'code-block':   return '```\n' + text + '\n```';
    case 'atomic': {
      // Image/media block — find an IMAGE entity on it
      const imgEntity = (block.entityRanges || [])
        .map((r) => entityMap[r.key])
        .find((e) => e && (e.type === 'IMAGE' || e.type === 'MEDIA'));
      const src = imgEntity?.data?.mediaInfo?.original_img_url
        || imgEntity?.data?.mediaInfo?.media_url_https
        || imgEntity?.data?.url
        || '';
      return src ? `![](${src})\n` : '';
    }
    default:
      return text ? `${text}\n` : '';
  }
}

function applyInlineFormatting(raw, inlineStyleRanges, entityRanges, entityMap) {
  if (!raw) return '';

  const boundaries = new Set([0, raw.length]);
  const addRangeBoundaries = (range) => {
    const start = Math.max(0, Math.min(raw.length, range.offset || 0));
    const end = Math.max(start, Math.min(raw.length, start + (range.length || 0)));
    boundaries.add(start);
    boundaries.add(end);
  };

  inlineStyleRanges.forEach(addRangeBoundaries);
  entityRanges.forEach(addRangeBoundaries);

  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  const parts = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;

    const slice = raw.slice(start, end);
    const styles = new Set(
      inlineStyleRanges
        .filter((r) => rangeContains(r, start, end))
        .map((r) => String(r.style || '').toUpperCase())
    );
    const entityRange = entityRanges.find((r) => rangeContains(r, start, end));
    const entity = entityRange ? entityMap[entityRange.key] : null;

    let text = applyMarkdownStyles(slice, styles);
    if (entity?.type === 'LINK') {
      const href = entity.data?.url || entity.data?.href || '';
      if (href) text = `[${text}](${href})`;
    }

    parts.push(text);
  }

  return parts.join('');
}

function rangeContains(range, start, end) {
  const rangeStart = range.offset || 0;
  const rangeEnd = rangeStart + (range.length || 0);
  return start >= rangeStart && end <= rangeEnd;
}

function applyMarkdownStyles(text, styles) {
  if (!text) return '';
  if (styles.has('CODE')) return `\`${text}\``;

  let result = text;
  if (styles.has('BOLD')) result = `**${result}**`;
  if (styles.has('ITALIC')) result = `*${result}*`;
  if (styles.has('STRIKETHROUGH')) result = `~~${result}~~`;
  if (styles.has('UNDERLINE')) result = `<u>${result}</u>`;
  return result;
}

// === Formatting ===
function formatVelocity(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}

// === Scoring ===
function computeScore(data) {
  const now = Date.now();
  const created = new Date(data.createdAt).getTime();
  const hours = Math.max((now - created) / 3600000, 0.1);
  const velocity = data.views / hours;

  const velocityScore = Math.min(velocity / 50000, 1) * 40;

  const engagements = data.likes + data.retweets + data.replies;
  const engagementRate = data.views > 0 ? engagements / data.views : 0;
  const engagementScore = Math.min(engagementRate / 0.1, 1) * 25;

  const rtRatio = data.likes > 0 ? data.retweets / data.likes : 0;
  const rtScore = Math.min(rtRatio / 0.5, 1) * 20;

  const bmRatio = data.likes > 0 ? data.bookmarks / data.likes : 0;
  const bmScore = Math.min(bmRatio / 0.3, 1) * 15;

  const totalScore = Math.round(velocityScore + engagementScore + rtScore + bmScore);

  return {
    velocity,
    score: Math.min(totalScore, 100),
    isHot: velocity >= velocityThresholds.viral,
  };
}

// === Tooltip Container (fixed, appended to body) ===
let tooltipEl = null;
function getTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'xvm-tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

// === Badge Rendering ===
function renderBadges() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    if (article.hasAttribute('data-xvm-scored')) continue;

    const tweetId = getTweetIdFromArticle(article);
    if (!tweetId) continue;

    const data = tweetDataStore.get(tweetId);
    if (!data) continue;

    // Find header row before marking scored — if DOM isn't ready, skip and retry later
    const caretBtn = article.querySelector('[data-testid="caret"]');
    if (!caretBtn) continue;
    let headerRow = caretBtn;
    while (headerRow && headerRow !== article) {
      if (headerRow.getBoundingClientRect().width > 200) break;
      headerRow = headerRow.parentElement;
    }
    if (!headerRow || headerRow === article) continue;

    // Only mark scored after we confirmed headerRow is valid
    article.setAttribute('data-xvm-scored', '1');

    const { velocity, score } = computeScore(data);
    // 🌱 normal | 🚀 trending | 🔥 viral
    const prefix = velocity >= velocityThresholds.viral ? '\u{1F525}' : velocity >= velocityThresholds.trending ? '\u{1F680}' : '\u{1F331}';
    const colorClass = velocity >= velocityThresholds.viral ? 'xvm-badge--red' : velocity >= velocityThresholds.trending ? 'xvm-badge--orange' : 'xvm-badge--green';

    const badge = document.createElement('span');
    badge.className = `xvm-badge ${colorClass}`;
    badge.dataset.prefix = prefix;
    badge.dataset.velocity = formatVelocity(velocity);

    // Tooltip: show/hide a single shared fixed element
    const postedDate = new Date(data.createdAt);
    const postedStr = postedDate.getFullYear() + ':' +
      String(postedDate.getMonth() + 1).padStart(2, '0') + ':' +
      String(postedDate.getDate()).padStart(2, '0') + ' ' +
      String(postedDate.getHours()).padStart(2, '0') + ':' +
      String(postedDate.getMinutes()).padStart(2, '0') + ':' +
      String(postedDate.getSeconds()).padStart(2, '0');
    const tooltipContent =
      `${i18n('contentViews')}: ${data.views.toLocaleString()}\n` +
      `${i18n('contentLikes')}: ${data.likes.toLocaleString()}\n` +
      `${i18n('contentRetweets')}: ${data.retweets.toLocaleString()}\n` +
      `${i18n('contentReplies')}: ${data.replies.toLocaleString()}\n` +
      `${i18n('contentBookmarks')}: ${data.bookmarks.toLocaleString()}\n` +
      `${i18n('contentVelocity')}: ${formatVelocity(velocity)}/h\n` +
      `${i18n('contentViralScore')}: ${score}/100\n` +
      `${i18n('contentPosted')}: ${postedStr}`;

    badge.addEventListener('mouseenter', () => {
      const tip = getTooltip();
      tip.textContent = tooltipContent;
      const rect = badge.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.top = (rect.bottom + 6) + 'px';
      tip.style.left = '';
      tip.style.right = '';
      // Align right edge of tooltip with right edge of badge
      const tipWidth = tip.offsetWidth;
      let left = rect.right - tipWidth;
      if (left < 8) left = 8;
      tip.style.left = left + 'px';
    });

    badge.addEventListener('mouseleave', () => {
      const tip = getTooltip();
      tip.style.display = 'none';
    });

    headerRow.insertBefore(badge, headerRow.lastElementChild);
  }

  if (leaderboardEnabled) renderLeaderboard();
}

// === Velocity Leaderboard ===
let leaderboardEl = null;
let leaderboardRaf = 0;
const LB_DEFAULT_WIDTH = 280;
const LB_MIN_WIDTH = 240;
const LB_MAX_WIDTH = 640;
let leaderboardWidth = LB_DEFAULT_WIDTH;

function ensureLeaderboard() {
  if (leaderboardEl) return leaderboardEl;
  leaderboardEl = document.createElement('div');
  leaderboardEl.className = 'xvm-lb';
  leaderboardEl.innerHTML = `
    <div class="xvm-lb-head" title="${i18n('contentLeaderboardDragToMove')}">
      <span class="xvm-lb-grip">⋮⋮</span>
      <span class="xvm-lb-title">🔥 ${i18n('contentLeaderboardTitle')}</span>
      <button class="xvm-lb-back" type="button" title="${i18n('contentLeaderboardBackToPrevious')}" aria-label="${i18n('contentLeaderboardBackToPrevious')}" hidden>
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 16 L12.5 16 Q16 16 16 12.5 L16 8.5 Q16 5 12.5 5 L5 5"></path>
          <path d="M8 2 L5 5 L8 8"></path>
        </svg>
      </button>
    </div>
    <ul class="xvm-lb-list"></ul>
    <div class="xvm-lb-resize" aria-hidden="true"></div>
  `;
  document.body.appendChild(leaderboardEl);
  applyLeaderboardWidth();
  applyLeaderboardPosition();
  installLeaderboardDrag();
  installLeaderboardResize();
  installLeaderboardBackButton();
  return leaderboardEl;
}

// === Back-to-previous-scroll ===
let savedScrollY = null;
function setBackButtonVisible(visible) {
  if (!leaderboardEl) return;
  const btn = leaderboardEl.querySelector('.xvm-lb-back');
  if (!btn) return;
  if (visible) btn.removeAttribute('hidden');
  else btn.setAttribute('hidden', '');
}
function installLeaderboardBackButton() {
  const btn = leaderboardEl.querySelector('.xvm-lb-back');
  if (!btn) return;
  // Prevent the drag handler from kicking in when pressing the button
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (savedScrollY === null) return;
    const target = savedScrollY;
    clearLink();
    window.scrollTo({ top: target, behavior: 'smooth' });
    savedScrollY = null;
    setBackButtonVisible(false);
  });
}

// === Leaderboard drag + persisted position ===
const LB_POS_KEY = 'xvmLeaderboardPos';
let leaderboardPos = null; // {left, top} in px from top-left of viewport
function clampLeaderboardWidth(width) {
  const safeWidth = Number.isFinite(width) ? width : LB_DEFAULT_WIDTH;
  const maxByViewport = Math.max(LB_MIN_WIDTH, Math.min(LB_MAX_WIDTH, window.innerWidth - 16));
  const maxByPosition = leaderboardPos && Number.isFinite(leaderboardPos.left)
    ? Math.max(LB_MIN_WIDTH, Math.min(maxByViewport, window.innerWidth - leaderboardPos.left - 8))
    : maxByViewport;
  return Math.max(LB_MIN_WIDTH, Math.min(safeWidth, maxByPosition));
}
function applyLeaderboardWidth() {
  if (!leaderboardEl) return;
  leaderboardWidth = clampLeaderboardWidth(leaderboardWidth);
  leaderboardEl.style.width = leaderboardWidth + 'px';
}
function applyLeaderboardPosition() {
  if (!leaderboardEl) return;
  if (leaderboardPos && Number.isFinite(leaderboardPos.left) && Number.isFinite(leaderboardPos.top)) {
    applyLeaderboardWidth();
    leaderboardEl.style.left = clampToViewport(leaderboardPos.left, 'x') + 'px';
    leaderboardEl.style.top = clampToViewport(leaderboardPos.top, 'y') + 'px';
    leaderboardEl.style.right = 'auto';
  } else {
    applyLeaderboardWidth();
  }
}
function clampToViewport(v, axis) {
  if (!leaderboardEl) return v;
  const rect = leaderboardEl.getBoundingClientRect();
  if (axis === 'x') return Math.max(8, Math.min(v, window.innerWidth - rect.width - 8));
  return Math.max(8, Math.min(v, window.innerHeight - rect.height - 8));
}

// Load persisted position via bridge
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type === 'XVM_LB_POS_LOAD' && event.data.pos) {
    leaderboardPos = event.data.pos;
    applyLeaderboardPosition();
    return;
  }
  if (event.data?.type === 'XVM_LB_SIZE_LOAD' && Number.isFinite(event.data.width)) {
    leaderboardWidth = event.data.width;
    applyLeaderboardWidth();
    applyLeaderboardPosition();
  }
});
window.postMessage({ type: 'XVM_LB_POS_REQUEST' }, '*');
window.postMessage({ type: 'XVM_LB_SIZE_REQUEST' }, '*');

function installLeaderboardDrag() {
  if (!leaderboardEl) return;
  const head = leaderboardEl.querySelector('.xvm-lb-head');
  if (!head) return;
  let dragState = null;
  let dragRaf = 0;
  let pendingClientX = 0;
  let pendingClientY = 0;

  const flushDrag = () => {
    dragRaf = 0;
    if (!dragState) return;
    const left = clampToViewport(pendingClientX - dragState.offsetX, 'x');
    const top = clampToViewport(pendingClientY - dragState.offsetY, 'y');
    leaderboardEl.style.left = left + 'px';
    leaderboardEl.style.top = top + 'px';
    leaderboardEl.style.right = 'auto';
    leaderboardPos = { left, top };
    if (linkState) updateLinkGeometry();
  };

  head.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = leaderboardEl.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    leaderboardEl.classList.add('xvm-lb-dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    pendingClientX = e.clientX;
    pendingClientY = e.clientY;
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(flushDrag);
  }, { passive: true });
  window.addEventListener('mouseup', () => {
    if (!dragState) return;
    dragState = null;
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = 0;
    }
    leaderboardEl.classList.remove('xvm-lb-dragging');
    if (leaderboardPos) {
      window.postMessage({ type: 'XVM_LB_POS_SAVE', pos: leaderboardPos }, '*');
    }
  });
}

function installLeaderboardResize() {
  if (!leaderboardEl) return;
  const handle = leaderboardEl.querySelector('.xvm-lb-resize');
  if (!handle) return;
  let resizeState = null;
  let resizeRaf = 0;
  let pendingClientX = 0;

  const flushResize = () => {
    resizeRaf = 0;
    if (!resizeState) return;
    leaderboardWidth = clampLeaderboardWidth(resizeState.startWidth + (pendingClientX - resizeState.startClientX));
    applyLeaderboardWidth();
    applyLeaderboardPosition();
    if (linkState) updateLinkGeometry();
  };

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    resizeState = {
      startWidth: leaderboardEl.getBoundingClientRect().width,
      startClientX: e.clientX,
    };
    leaderboardEl.classList.add('xvm-lb-resizing');
    e.stopPropagation();
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizeState) return;
    pendingClientX = e.clientX;
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(flushResize);
  }, { passive: true });
  window.addEventListener('mouseup', () => {
    if (!resizeState) return;
    resizeState = null;
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    leaderboardEl.classList.remove('xvm-lb-resizing');
    window.postMessage({ type: 'XVM_LB_SIZE_SAVE', width: leaderboardWidth }, '*');
  });
}

window.addEventListener('resize', () => {
  if (!leaderboardEl) return;
  applyLeaderboardWidth();
  applyLeaderboardPosition();
  if (linkState) updateLinkGeometry();
});

function formatViews(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function lbEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const LB_COLUMN_RENDERERS = {
  rank: (_t, i) => `<span class="xvm-lb-rank">${i + 1}</span>`,
  icon: (t) => {
    const tier = t.velocity >= velocityThresholds.viral ? 'red'
      : t.velocity >= velocityThresholds.trending ? 'orange'
      : 'green';
    const icon = tier === 'red' ? '\u{1F525}' : tier === 'orange' ? '\u{1F680}' : '\u{1F331}';
    return `<span class="xvm-lb-icon">${icon}</span>`;
  },
  handle: (t) => {
    const fallbackHandle = `(${i18n('contentFallbackTweetLabel')})`;
    const handle = (t.handle || '').trim() || fallbackHandle;
    // Let CSS text-overflow do the truncation so the full name is shown
    // whenever there's space, and only clipped when the row is actually
    // too narrow. This plays nicer with mixed CJK/Latin names.
    return `<span class="xvm-lb-handle" title="${lbEscapeHtml(handle)}">${lbEscapeHtml(handle)}</span>`;
  },
  preview: (t) => {
    const text = (t.text || '').replace(/\s+/g, ' ').trim();
    return `<span class="xvm-lb-preview" title="${lbEscapeHtml(text.slice(0, 280))}">${lbEscapeHtml(text)}</span>`;
  },
  views: (t) => `<span class="xvm-lb-views" title="${i18n('contentLeaderboardTotalViews')}">\u{1F441} ${formatViews(t.views)}</span>`,
  velocity: (t) => `<span class="xvm-lb-vel">${formatVelocity(t.velocity)}/h</span>`,
};

function hideLeaderboard() {
  if (leaderboardEl) leaderboardEl.style.display = 'none';
  clearLink();
}

function collectRanked() {
  const out = [];
  const seen = new Set();
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const id = getTweetIdFromArticle(article);
    if (!id || seen.has(id)) continue;
    const data = tweetDataStore.get(id);
    if (!data) continue;
    seen.add(id);
    const { velocity } = computeScore(data);
    let handle = '';
    const userLink = article.querySelector('a[href^="/"][role="link"] span');
    if (userLink) handle = userLink.textContent || '';
    if (!handle) {
      const m = (data.text || '').slice(0, 60);
      handle = m;
    }
    out.push({ id, article, velocity, views: data.views || 0, handle, text: data.text });
  }
  return out.sort((a, b) => b.velocity - a.velocity);
}

function renderLeaderboard() {
  cancelAnimationFrame(leaderboardRaf);
  leaderboardRaf = requestAnimationFrame(() => {
    const el = ensureLeaderboard();
    const top = collectRanked().slice(0, leaderboardCount);
    if (!top.length) {
      el.style.display = 'none';
      clearLink();
      return;
    }
    el.style.display = 'block';
    const list = el.querySelector('.xvm-lb-list');
    const visibleCols = leaderboardColumns.filter((c) => c.visible && LB_COLUMN_RENDERERS[c.id]);
    list.innerHTML = top.map((t, i) => {
      const tier = t.velocity >= velocityThresholds.viral ? 'red'
        : t.velocity >= velocityThresholds.trending ? 'orange'
        : 'green';
      const cells = visibleCols.map((c) => LB_COLUMN_RENDERERS[c.id](t, i)).join('');
      return `<li class="xvm-lb-item xvm-lb-${tier}" data-id="${t.id}">${cells}</li>`;
    }).join('');

    list.querySelectorAll('.xvm-lb-item').forEach((li) => {
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = li.dataset.id;
        const entry = collectRanked().find((e) => e.id === id);
        if (!entry?.article?.isConnected) return;
        if (linkState && linkState.tweetId === id) {
          clearLink();
          return;
        }
        // Remember current scroll position so the back button can restore it.
        // Only set if we don't already have one stacked — multiple jumps in a
        // row return to the original pre-jump position, not the last jump.
        if (savedScrollY === null) {
          savedScrollY = window.scrollY;
          setBackButtonVisible(true);
        }
        entry.article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setLink(id, li, entry.article);
      });
    });

    // Restore link highlight if the linked item is in the freshly rendered list
    if (linkState) {
      const relinkItem = list.querySelector(`.xvm-lb-item[data-id="${CSS.escape(linkState.tweetId)}"]`);
      if (relinkItem) {
        linkState.itemEl = relinkItem;
        relinkItem.classList.add('xvm-lb-item-selected');
      } else {
        clearLink();
      }
    }
  });
}

// === Leaderboard ↔ article connector (infinite-canvas style) ===
// linkState: { tweetId, itemEl, article, svg, rafHandle }
let linkState = null;
const SVG_NS = 'http://www.w3.org/2000/svg';

function ensureLinkSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'xvm-lb-link');
  svg.style.position = 'fixed';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100vw';
  svg.style.height = '100vh';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2147483645';
  svg.innerHTML = `
    <path class="xvm-lb-link-path" fill="none" />
    <circle class="xvm-lb-link-dot xvm-lb-link-start" r="5" />
    <circle class="xvm-lb-link-dot xvm-lb-link-end" r="5" />
  `;
  document.body.appendChild(svg);
  return svg;
}

function findArticleByTweetId(tweetId) {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    const id = getTweetIdFromArticle(article);
    if (id === tweetId) return article;
  }
  return null;
}

function updateLinkGeometry() {
  if (!linkState) return;
  const { tweetId, itemEl, svg } = linkState;

  // Re-resolve article each frame — React can swap the node on virtualization
  let article = linkState.article;
  if (!article || !article.isConnected) {
    article = findArticleByTweetId(tweetId);
    linkState.article = article;
  }

  if (!itemEl.isConnected || !article) {
    if (!article) svg.style.display = 'none';
    return;
  }
  svg.style.display = '';

  const itemRect = itemEl.getBoundingClientRect();
  const articleRect = article.getBoundingClientRect();

  // Re-apply article highlight (React may have stripped it on re-render)
  if (!article.classList.contains('xvm-article-linked')) {
    article.classList.add('xvm-article-linked');
  }

  // Pick the item side that faces the article
  const itemCx = itemRect.left + itemRect.width / 2;
  const articleCx = articleRect.left + articleRect.width / 2;
  const startOnRight = articleCx >= itemCx;

  const startX = startOnRight ? itemRect.right : itemRect.left;
  const startY = itemRect.top + itemRect.height / 2;

  // Clamp article endpoint vertically to the visible article region
  const articleVisibleTop = Math.max(articleRect.top, 8);
  const articleVisibleBottom = Math.min(articleRect.bottom, window.innerHeight - 8);
  const endY = Math.max(articleVisibleTop, Math.min(startY, articleVisibleBottom));
  const endX = startOnRight ? articleRect.left : articleRect.right;

  // Cubic bezier with horizontal control handles — the "canvas connection" feel
  const dx = Math.abs(endX - startX);
  const handle = Math.max(60, dx * 0.4);
  const c1x = startX + (startOnRight ? handle : -handle);
  const c2x = endX - (startOnRight ? handle : -handle);

  const path = svg.querySelector('.xvm-lb-link-path');
  path.setAttribute('d', `M ${startX},${startY} C ${c1x},${startY} ${c2x},${endY} ${endX},${endY}`);

  const s = svg.querySelector('.xvm-lb-link-start');
  s.setAttribute('cx', startX);
  s.setAttribute('cy', startY);
  const e = svg.querySelector('.xvm-lb-link-end');
  e.setAttribute('cx', endX);
  e.setAttribute('cy', endY);
}

let linkUpdateRaf = 0;
function scheduleLinkUpdate() {
  if (!linkState || linkUpdateRaf) return;
  linkUpdateRaf = requestAnimationFrame(() => {
    linkUpdateRaf = 0;
    updateLinkGeometry();
  });
}

function setLink(tweetId, itemEl, article) {
  clearLink();
  const svg = ensureLinkSvg();
  itemEl.classList.add('xvm-lb-item-selected');
  article.classList.add('xvm-article-linked');
  linkState = { tweetId, itemEl, article, svg };
  updateLinkGeometry();
}

function clearLink() {
  if (!linkState) return;
  linkState.itemEl?.classList.remove('xvm-lb-item-selected');
  linkState.article?.classList.remove('xvm-article-linked');
  // Also clean any stale highlights on the current DOM article for this id
  const stale = findArticleByTweetId(linkState.tweetId);
  stale?.classList.remove('xvm-article-linked');
  linkState.svg?.remove();
  linkState = null;
  if (linkUpdateRaf) {
    cancelAnimationFrame(linkUpdateRaf);
    linkUpdateRaf = 0;
  }
}

// Event-driven link geometry updates — no idle rAF loop burning CPU.
// Capture phase so we catch scroll events on inner scroll containers too.
window.addEventListener('scroll', scheduleLinkUpdate, { capture: true, passive: true });
window.addEventListener('resize', scheduleLinkUpdate, { passive: true });

document.addEventListener('click', (e) => {
  if (!linkState) return;
  const insideItem = linkState.itemEl && linkState.itemEl.contains(e.target);
  const insideArticle = linkState.article && linkState.article.contains(e.target);
  const insidePanel = leaderboardEl && leaderboardEl.contains(e.target);
  if (!insideItem && !insideArticle && !insidePanel) clearLink();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && linkState) clearLink();
});

function getTweetIdFromArticle(article) {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const match = link.getAttribute('href').match(/\/status\/(\d+)$/);
    if (match) {
      const id = match[1];
      if (tweetDataStore.has(id)) return id;
    }
  }
  const firstLink = article.querySelector('a[href*="/status/"]');
  if (!firstLink) return null;
  const match = firstLink.getAttribute('href').match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

// Periodic re-render for tweets whose data arrived after DOM render
setInterval(() => {
  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  if (unscored.length > 0) {
    renderBadges();
  } else if (leaderboardEnabled) {
    renderLeaderboard();
  }
}, 2000);

// Refresh leaderboard on scroll as virtualized articles come and go
let lbScrollTick = false;
window.addEventListener('scroll', () => {
  if (!leaderboardEnabled || lbScrollTick) return;
  lbScrollTick = true;
  setTimeout(() => { lbScrollTick = false; renderLeaderboard(); }, 250);
}, { passive: true });

// === MutationObserver ===
const observer = new MutationObserver((mutations) => {
  let hasNewArticles = false;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1 && (node.tagName === 'ARTICLE' || node.querySelector?.('article[data-testid="tweet"]'))) {
        hasNewArticles = true;
        break;
      }
    }
    if (hasNewArticles) break;
  }
  if (hasNewArticles) {
    renderBadges();
  }
});

function startObserver() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

if (document.body) {
  startObserver();
} else {
  document.addEventListener('DOMContentLoaded', startObserver);
}

// Reset on SPA navigation (URL change)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
  }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });

// === Copy-as-Markdown: inject entry into X's native share dropdown ===
// Remember the tweet the user was interacting with when opening a menu.
let lastShareContext = null; // { article, tweetId, permalink }

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('button[aria-haspopup="menu"], button[aria-expanded]');
  if (!btn) return;
  const article = btn.closest('article[data-testid="tweet"]');
  if (!article) return;

  const tweetId = getTweetIdFromArticle(article);
  let permalink = '';
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (m) { permalink = `https://x.com/${m[1]}/status/${m[2]}`; break; }
  }
  lastShareContext = { article, tweetId, permalink };
}, true);

function getAuthorInfo(article) {
  // User-Name block has display name + @handle
  const nameBlock = article.querySelector('[data-testid="User-Name"]');
  let displayName = '';
  let handle = '';
  if (nameBlock) {
    const spans = nameBlock.querySelectorAll('span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (!handle && t.startsWith('@')) handle = t;
      else if (!displayName && t && !t.startsWith('@') && t !== '·') displayName = t;
      if (handle && displayName) break;
    }
  }
  return { displayName, handle };
}

function formatLocalDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join(':');
}

function buildTweetMarkdown(ctx) {
  const { article, tweetId, permalink } = ctx;
  const data = tweetId ? tweetDataStore.get(tweetId) : null;

  let text = data?.text || '';
  if (!text) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    text = (textEl?.textContent || '').trim();
  }
  // Expand t.co shortlinks into their real URLs / image markdown
  const urlMap = data?.urlMap;
  if (urlMap) {
    for (const short of Object.keys(urlMap)) {
      text = text.split(short).join(urlMap[short]);
    }
  }
  // If this tweet is a long-form Article, prefer the full article body.
  if (data?.articleMd) {
    text = text ? `${data.articleMd}\n\n${text}` : data.articleMd;
  }

  const { displayName, handle } = getAuthorInfo(article);
  const url = permalink || (handle && tweetId ? `https://x.com/${handle.replace(/^@/, '')}/status/${tweetId}` : '');

  const createdAt = data?.createdAt ? new Date(data.createdAt) : null;
  const dateStr = createdAt && !isNaN(createdAt)
    ? formatLocalDateTime(createdAt)
    : '';

  const authorLabel = displayName && handle
    ? `${displayName} (${handle})`
    : (displayName || handle || i18n('contentFallbackTweetLabel'));
  const authorLine = url ? `[${authorLabel}](${url})` : authorLabel;
  const metaParts = [authorLine];
  if (dateStr) metaParts.push(dateStr);

  return `${text.trim()}\n\n— ${metaParts.join(' · ')}\n`;
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  // Fallback
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'xvm-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('xvm-toast--show'));
  setTimeout(() => {
    toast.classList.remove('xvm-toast--show');
    setTimeout(() => toast.remove(), 250);
  }, 1400);
}

function closeOpenMenus() {
  // X's dropdown listens for outside pointerdown/mousedown on document to
  // auto-dismiss. Simulate that + Escape for belt-and-suspenders.
  const opts = { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0 };
  try { document.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
  document.dispatchEvent(new MouseEvent('mousedown', opts));
  document.dispatchEvent(new MouseEvent('mouseup', opts));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  // Last resort: if the menu is still around next tick, remove its layer.
  setTimeout(() => {
    document.querySelectorAll('[data-testid="Dropdown"]').forEach((el) => {
      const layer = el.closest('[role="menu"]')?.parentElement?.parentElement;
      (layer || el).remove();
    });
  }, 60);
}

function isShareMenu(menuEl) {
  // Heuristic: the share dropdown contains a "copy link" item
  if (menuEl.querySelector('[data-testid*="copy" i], [data-testid*="Link" i]')) return true;
  const items = menuEl.querySelectorAll('[role="menuitem"]');
  for (const item of items) {
    const label = (item.getAttribute('aria-label') || item.textContent || '').toLowerCase();
    if (/copy link|copy post link|链接|リンク/.test(label)) return true;
  }
  return false;
}

function injectCopyMarkdownItem(menuEl) {
  if (!copyAsMarkdownEnabled) return;
  if (menuEl.querySelector('.xvm-copy-md-item')) return;
  const items = menuEl.querySelectorAll('[role="menuitem"]');
  if (!items.length) return;

  // Clone an existing menuitem so we inherit X's hover/active styling.
  const template = items[items.length - 1];
  const clone = template.cloneNode(true);
  clone.classList.add('xvm-copy-md-item');
  clone.removeAttribute('data-testid');
  clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));

  // Replace only the first text-bearing leaf span; append a small
  // attribution line under it so users know this entry comes from the
  // extension, not X itself.
  const textSpans = clone.querySelectorAll('span');
  let labelSpan = null;
  for (const s of textSpans) {
    if (s.children.length === 0 && (s.textContent || '').trim()) {
      labelSpan = s;
      break;
    }
  }
  if (labelSpan) {
    labelSpan.textContent = '';
    const title = document.createElement('span');
    title.textContent = i18n('contentCopyMdLabel');
    const attribution = document.createElement('span');
    attribution.className = 'xvm-copy-md-source';
    attribution.textContent = i18n('contentCopyMdAttribution');
    labelSpan.appendChild(title);
    labelSpan.appendChild(document.createElement('br'));
    labelSpan.appendChild(attribution);
  } else {
    clone.textContent = i18n('contentCopyMdLabel');
  }

  // Swap the icon with a Markdown glyph
  const svg = clone.querySelector('svg');
  if (svg) {
    const mdIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mdIcon.setAttribute('viewBox', '0 0 24 24');
    mdIcon.setAttribute('width', svg.getAttribute('width') || '18');
    mdIcon.setAttribute('height', svg.getAttribute('height') || '18');
    mdIcon.setAttribute('aria-hidden', 'true');
    mdIcon.style.fill = 'currentColor';
    mdIcon.innerHTML = '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 3v8h2v-5l2 3 2-3v5h2V8H9.5L8 10.5 6.5 8H5zm11 0v4h-2l3 4 3-4h-2V8h-2z"/>';
    svg.replaceWith(mdIcon);
  }

  // cloneNode(true) already drops React/native listeners — just preventDefault
  // for any <a> navigation and let native CSS hover/active still work.
  clone.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const ctx = lastShareContext;
    if (!ctx || !ctx.article || !ctx.article.isConnected) {
      showToast(i18n('contentCopyMdNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const md = buildTweetMarkdown(ctx);
    const ok = await copyTextToClipboard(md);
    showToast(ok ? i18n('contentCopyMdDone') : i18n('contentCopyMdCopyFailed'));
    closeOpenMenus();
  });

  // Insert as the very last menuitem, matching the original group's parent.
  const lastItem = items[items.length - 1];
  lastItem.parentNode.appendChild(clone);
}

const menuObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      const menus = [];
      if (node.matches?.('[role="menu"]')) menus.push(node);
      node.querySelectorAll?.('[role="menu"]').forEach((el) => menus.push(el));
      for (const menu of menus) {
        if (!isShareMenu(menu)) continue;
        injectCopyMarkdownItem(menu);
      }
    }
  }
});

function startMenuObserver() {
  menuObserver.observe(document.body, { childList: true, subtree: true });
}
if (document.body) startMenuObserver();
else document.addEventListener('DOMContentLoaded', startMenuObserver);
