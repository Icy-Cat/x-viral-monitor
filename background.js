import { openDb, upsertTweet, putSample, getTweet, listTweets, getSamples, getLastSample } from './lib/db.js';
import { decide, MAX_TRACK_AGE_MS } from './lib/sampler.js';

let dbPromise = null;
function db() { return dbPromise || (dbPromise = openDb()); }

function parseCreatedAt(raw) {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

async function observe({ tweet, subscribed }) {
  if (!tweet?.id || !tweet?.author) return { written: false, reason: 'invalid' };
  const author = String(tweet.author).toLowerCase();
  if (!subscribed.includes(author)) return { written: false, reason: 'not-subscribed' };

  const createdAt = parseCreatedAt(tweet.createdAt);
  if (!createdAt) return { written: false, reason: 'no-created-at' };
  const now = Date.now();
  const ageMs = now - createdAt;

  const d = await db();
  const last = await getLastSample(d, tweet.id);
  const decision = decide({
    last,
    current: tweet,
    ageMs,
    nowMs: now,
  });
  if (!decision.shouldWrite) {
    if (decision.reason === 'aged-out') {
      const existing = await getTweet(d, tweet.id);
      if (existing && existing.status !== 'frozen') {
        await upsertTweet(d, { ...existing, status: 'frozen' });
      }
    }
    return { written: false, reason: decision.reason };
  }

  const existing = await getTweet(d, tweet.id);
  await upsertTweet(d, {
    tweet_id: tweet.id,
    author,
    author_name: tweet.authorName || '',
    author_avatar: tweet.authorAvatar || '',
    text: tweet.text || '',
    created_at: createdAt,
    first_seen_at: existing?.first_seen_at || now,
    last_sampled_at: now,
    status: ageMs > MAX_TRACK_AGE_MS ? 'frozen' : 'active',
  });
  await putSample(d, {
    tweet_id: tweet.id,
    ts: now,
    impressions: tweet.views || 0,
    likes: tweet.likes || 0,
    retweets: tweet.retweets || 0,
    replies: tweet.replies || 0,
    bookmarks: tweet.bookmarks || 0,
    ...decision.deltas,
  });
  return { written: true, reason: decision.reason };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'XVM_HIST_OBSERVE': {
          const { subscribed = [] } = await chrome.storage.sync.get({ subscribed: [] });
          sendResponse(await observe({ tweet: msg.tweet, subscribed }));
          return;
        }
        case 'XVM_HIST_LIST_TWEETS': {
          const all = await listTweets(await db());
          sendResponse({ tweets: all });
          return;
        }
        case 'XVM_HIST_GET_SAMPLES': {
          sendResponse({ samples: await getSamples(await db(), msg.tweetId) });
          return;
        }
        case 'XVM_HIST_GET_TWEET': {
          sendResponse({ tweet: await getTweet(await db(), msg.tweetId) });
          return;
        }
        default:
          sendResponse({ error: 'unknown-type' });
      }
    } catch (e) {
      sendResponse({ error: String(e?.message || e) });
    }
  })();
  return true; // keep channel open for async response
});
