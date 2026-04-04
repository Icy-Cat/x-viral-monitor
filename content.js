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

// Placeholder — implemented in Task 4
function renderBadges() {}
