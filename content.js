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

// Hook XMLHttpRequest (X uses XHR for GraphQL requests)
const originalXHROpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this._xvm_url = url;
  return originalXHROpen.call(this, method, url, ...rest);
};

const originalXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (...args) {
  if (this._xvm_url && TIMELINE_RE.test(this._xvm_url)) {
    this.addEventListener('load', function () {
      try {
        const json = JSON.parse(this.responseText);
        parseTweetsFromResponse(json);
      } catch (e) {}
    });
  }
  return originalXHRSend.apply(this, args);
};

// === Data Extraction ===
function parseTweetsFromResponse(json) {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions;
  if (!instructions) return;
  for (const instruction of instructions) {
    const entries = instruction.entries || instruction.moduleItems || [];
    for (const entry of entries) {
      const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;
      const data = extractTweetData(tweetResult);
      if (data) {
        tweetDataStore.set(data.id, data);
      }
    }
  }
  renderBadges();
}

function extractTweetData(result) {
  // Unwrap TweetWithVisibilityResults
  const tweet = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy) return null;

  // For retweets, use the original tweet's data
  const rtResult = legacy.retweeted_status_result?.result;
  if (rtResult) {
    return extractTweetData(rtResult);
  }

  const viewCount = parseInt(tweet.views?.count, 10);
  if (!viewCount || tweet.views?.state !== 'EnabledWithCount') return null;

  // Skip promoted content
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

// === Badge Rendering ===
function renderBadges() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    if (article.hasAttribute('data-xvm-scored')) continue;

    const tweetId = getTweetIdFromArticle(article);
    if (!tweetId) continue;

    const data = tweetDataStore.get(tweetId);
    if (!data) continue;

    article.setAttribute('data-xvm-scored', '1');

    // Find the header row: walk up from caret until we find a wide flex container
    const caretBtn = article.querySelector('[data-testid="caret"]');
    if (!caretBtn) continue;
    let headerRow = caretBtn;
    while (headerRow && headerRow !== article) {
      if (headerRow.getBoundingClientRect().width > 200) break;
      headerRow = headerRow.parentElement;
    }
    if (!headerRow || headerRow === article) continue;

    const { velocity, score, isHot } = computeScore(data);
    const prefix = isHot ? '\u{1F525}' : '\u26A1';
    const colorClass = score >= 60 ? 'xvm-badge--red' : score >= 30 ? 'xvm-badge--orange' : 'xvm-badge--green';

    const badge = document.createElement('span');
    badge.className = `xvm-badge ${colorClass}`;
    badge.textContent = `${prefix} ${formatVelocity(velocity)}/h | ${score}%`;

    // Tooltip with detailed data
    const tooltip = document.createElement('div');
    tooltip.className = 'xvm-tooltip';
    tooltip.textContent =
      `Views: ${data.views.toLocaleString()}\n` +
      `Likes: ${data.likes.toLocaleString()}\n` +
      `Retweets: ${data.retweets.toLocaleString()}\n` +
      `Replies: ${data.replies.toLocaleString()}\n` +
      `Bookmarks: ${data.bookmarks.toLocaleString()}\n` +
      `Posted: ${data.createdAt}`;
    badge.appendChild(tooltip);

    // Insert badge before the last child of header row (the button group)
    headerRow.insertBefore(badge, headerRow.lastElementChild);
  }
}

function getTweetIdFromArticle(article) {
  // Collect all status links — prefer IDs that exist in our data store
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const match = link.getAttribute('href').match(/\/status\/(\d+)$/);
    if (match) {
      const id = match[1];
      if (tweetDataStore.has(id)) return id;
    }
  }
  // Fallback: return first status link ID
  const firstLink = article.querySelector('a[href*="/status/"]');
  if (!firstLink) return null;
  const match = firstLink.getAttribute('href').match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

// Periodic re-render for tweets that arrived in DOM before data was parsed
setInterval(() => {
  const unscored = document.querySelectorAll('article[data-testid="tweet"]:not([data-xvm-scored])');
  if (unscored.length > 0) {
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
