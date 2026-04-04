// === Tweet Data Store ===
const tweetDataStore = new Map();

// === Fetch Hook ===
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (url && /graphql\/.*\/(HomeTimeline|HomeLatestTimeline)/.test(url)) {
    const clone = response.clone();
    clone.json().then(parseTweetsFromResponse).catch(() => {});
  }
  return response;
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
  const tweet = result.tweet || result;
  const legacy = tweet.legacy;
  if (!legacy) return null;

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

    // Ensure article is positioned for absolute badge
    article.style.position = article.style.position || 'relative';

    const { velocity, score, isHot } = computeScore(data);
    const prefix = isHot ? '\u{1F525} ' : '\u26A1 ';
    const colorClass = score >= 60 ? 'xvm-badge--red' : score >= 30 ? 'xvm-badge--orange' : 'xvm-badge--green';

    const badge = document.createElement('div');
    badge.className = `xvm-badge ${colorClass}`;
    badge.textContent = `${prefix}${formatVelocity(velocity)}/h | ${score}%`;

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

    article.appendChild(badge);
  }
}

function getTweetIdFromArticle(article) {
  const link = article.querySelector('a[href*="/status/"]');
  if (!link) return null;
  const match = link.getAttribute('href').match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

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

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});
