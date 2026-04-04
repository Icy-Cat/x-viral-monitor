// === Tweet Data Store ===
const tweetDataStore = new Map();

// === Request Interception (fetch + XHR) ===
const TIMELINE_RE = /graphql\/.*\/(HomeTimeline|HomeLatestTimeline)/;

// Hook fetch
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (url && TIMELINE_RE.test(url)) {
    const clone = response.clone();
    clone.json().then(parseTweetsFromResponse).catch(() => {});
  }
  return response;
};

// Hook XMLHttpRequest — attach listener in open() to avoid X caching send()
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  if (typeof url === 'string' && TIMELINE_RE.test(url)) {
    this.addEventListener('load', function () {
      try {
        parseTweetsFromResponse(JSON.parse(this.responseText));
      } catch (e) {}
    });
  }
  return originalXHROpen.call(this, method, url, ...rest);
};

// === Data Extraction ===
function parseTweetsFromResponse(json) {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions;
  if (!instructions) return;
  for (const instruction of instructions) {
    const entries = instruction.entries || instruction.moduleItems || [];
    for (const entry of entries) {
      // Direct tweet entry
      const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const data = extractTweetData(tweetResult);
        if (data) tweetDataStore.set(data.id, data);
      }
      // Module entry (conversation threads, multi-tweet groups)
      const moduleItems = entry?.content?.items;
      if (moduleItems) {
        for (const item of moduleItems) {
          const modTweetResult = item?.item?.itemContent?.tweet_results?.result;
          if (!modTweetResult) continue;
          const data = extractTweetData(modTweetResult);
          if (data) tweetDataStore.set(data.id, data);
        }
      }
    }
  }
  renderBadges();
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
    isHot: velocity >= 10000,
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
    const prefix = velocity >= 10000 ? '\u{1F525}' : velocity >= 1000 ? '\u{1F680}' : '\u{1F331}';
    const colorClass = velocity >= 10000 ? 'xvm-badge--red' : velocity >= 1000 ? 'xvm-badge--orange' : 'xvm-badge--green';

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
      `Views: ${data.views.toLocaleString()}\n` +
      `Likes: ${data.likes.toLocaleString()}\n` +
      `Retweets: ${data.retweets.toLocaleString()}\n` +
      `Replies: ${data.replies.toLocaleString()}\n` +
      `Bookmarks: ${data.bookmarks.toLocaleString()}\n` +
      `Velocity: ${formatVelocity(velocity)}/h\n` +
      `Viral Score: ${score}/100\n` +
      `Posted: ${postedStr}`;

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

// === Fallback: fetch timeline data if initial XHR was missed ===
let fallbackAttempted = false;

function fetchTimelineFallback() {
  if (fallbackAttempted) return;
  const ct0 = document.cookie.match(/ct0=([^;]+)/)?.[1];
  if (!ct0) return;
  fallbackAttempted = true;

  const variables = encodeURIComponent(JSON.stringify({count:20,includePromotedContent:true,requestContext:"launch",withCommunity:true}));
  const features = encodeURIComponent(JSON.stringify({
    view_counts_everywhere_api_enabled:true,rweb_video_screen_enabled:false,
    profile_label_improvements_pcf_label_in_post_enabled:true,responsive_web_profile_redirect_enabled:false,
    rweb_tipjar_consumption_enabled:false,verified_phone_label_enabled:false,
    creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled:false,premium_content_api_read_enabled:false,
    communities_web_enable_tweet_community_results_fetch:true,c9s_tweet_anatomy_moderator_badge_enabled:true,
    responsive_web_edit_tweet_api_enabled:true,graphql_is_translatable_rweb_tweet_is_translatable_enabled:true,
    longform_notetweets_consumption_enabled:true,responsive_web_twitter_article_tweet_consumption_enabled:true,
    responsive_web_enhance_cards_enabled:false
  }));
  const url = `/i/api/graphql/J62e-zdBz8cxFVOjBcq1WA/HomeTimeline?variables=${variables}&features=${features}`;

  fetch(url, {
    credentials: 'include',
    headers: {
      'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      'x-csrf-token': ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json'
    }
  }).then(r => r.json()).then(parseTweetsFromResponse).catch(() => {});
}

// Periodic re-render + fallback fetch if needed
setInterval(() => {
  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  if (unscored.length > 0) {
    // If we have unscored articles with no matching data, try fallback fetch
    let anyMissing = false;
    for (const a of unscored) {
      const link = a.querySelector('a[href*="/status/"]');
      const id = link?.href?.match(/status\/(\d+)/)?.[1];
      if (id && !tweetDataStore.has(id)) { anyMissing = true; break; }
    }
    if (anyMissing) {
      fetchTimelineFallback();
    }
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

// Reset fallback on SPA navigation (URL change)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    fallbackAttempted = false;
  }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });
