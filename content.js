// === Tweet Data Store ===
const tweetDataStore = new Map();
const DEFAULT_THRESHOLDS = {
  trending: 1000,
  viral: 10000,
};
let velocityThresholds = { ...DEFAULT_THRESHOLDS };

// === i18n ===
const I18N = {
  en: {
    views: 'Views', likes: 'Likes', retweets: 'Retweets',
    replies: 'Replies', bookmarks: 'Bookmarks', velocity: 'Velocity',
    viralScore: 'Viral Score', posted: 'Posted',
  },
  zh: {
    views: '浏览量', likes: '点赞', retweets: '转发',
    replies: '回复', bookmarks: '收藏', velocity: '流速',
    viralScore: '爆帖指数', posted: '发布时间',
  },
  ja: {
    views: '表示回数', likes: 'いいね', retweets: 'リポスト',
    replies: '返信', bookmarks: 'ブックマーク', velocity: '流速',
    viralScore: 'バズ指数', posted: '投稿日時',
  },
};
const userLang = (navigator.language || 'en').split('-')[0];
const strings = I18N[userLang] || I18N.en;
function i18n(key) { return strings[key] || key; }

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

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'XVM_SETTINGS_UPDATE') return;

  velocityThresholds = normalizeThresholds(event.data.thresholds);
  document.querySelectorAll('article[data-xvm-scored]').forEach((article) => {
    article.removeAttribute('data-xvm-scored');
  });
  document.querySelectorAll('.xvm-badge').forEach((badge) => {
    badge.remove();
  });
  renderBadges();
});

window.postMessage({ type: 'XVM_REQUEST_SETTINGS' }, '*');

// === Request Interception (fetch + XHR) ===
const GRAPHQL_RE = /\/i\/api\/graphql\//;

// Hook fetch
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (url && GRAPHQL_RE.test(url)) {
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

  return {
    id: legacy.id_str,
    views: viewCount,
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    bookmarks: legacy.bookmark_count || 0,
    createdAt: legacy.created_at,
  };
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
    badge.textContent = `${prefix} ${formatVelocity(velocity)}/h`;

    // Tooltip: show/hide a single shared fixed element
    const postedDate = new Date(data.createdAt);
    const postedStr = postedDate.getFullYear() + ':' +
      String(postedDate.getMonth() + 1).padStart(2, '0') + ':' +
      String(postedDate.getDate()).padStart(2, '0') + ' ' +
      String(postedDate.getHours()).padStart(2, '0') + ':' +
      String(postedDate.getMinutes()).padStart(2, '0') + ':' +
      String(postedDate.getSeconds()).padStart(2, '0');
    const tooltipContent =
      `${i18n('views')}: ${data.views.toLocaleString()}\n` +
      `${i18n('likes')}: ${data.likes.toLocaleString()}\n` +
      `${i18n('retweets')}: ${data.retweets.toLocaleString()}\n` +
      `${i18n('replies')}: ${data.replies.toLocaleString()}\n` +
      `${i18n('bookmarks')}: ${data.bookmarks.toLocaleString()}\n` +
      `${i18n('velocity')}: ${formatVelocity(velocity)}/h\n` +
      `${i18n('viralScore')}: ${score}/100\n` +
      `${i18n('posted')}: ${postedStr}`;

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
}

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

// === Fallback: fetch TweetDetail for missing tweets ===
const fetchedIds = new Set();

function fetchMissingTweets() {
  const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
  if (!ct0) return;

  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  const missingIds = [];
  for (const a of unscored) {
    const links = a.querySelectorAll('a[href*="/status/"]');
    for (const l of links) {
      const m = l.href.match(/status\/(\d+)/);
      if (m && !tweetDataStore.has(m[1]) && !fetchedIds.has(m[1])) {
        missingIds.push(m[1]);
        fetchedIds.add(m[1]);
      }
    }
  }
  if (missingIds.length === 0) return;

  const headers = {
    'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    'x-csrf-token': ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'content-type': 'application/json'
  };
  const features = encodeURIComponent(JSON.stringify({
    view_counts_everywhere_api_enabled:true,rweb_video_screen_enabled:false,
    profile_label_improvements_pcf_label_in_post_enabled:true,
    responsive_web_graphql_timeline_navigation_enabled:true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,
    creator_subscriptions_tweet_preview_api_enabled:true,
    longform_notetweets_consumption_enabled:true,
    responsive_web_enhance_cards_enabled:false
  }));

  for (const tweetId of missingIds.slice(0, 10)) {
    const variables = encodeURIComponent(JSON.stringify({
      focalTweetId: tweetId, withCommunity: true, withBirdwatchNotes: false, withVoice: false
    }));
    fetch(`/i/api/graphql/rU08O-YiXdr0IZfE7qaUMg/TweetDetail?variables=${variables}&features=${features}`, {
      credentials: 'include', headers
    }).then(r => r.json()).then(scanForTweets).catch(() => {});
  }
}

// Periodic re-render + fallback fetch if needed
setInterval(() => {
  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  if (unscored.length > 0) {
    fetchMissingTweets();
    renderBadges();
  }
}, 2000);

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
    fetchedIds.clear();
  }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });
