import { openDb, upsertTweet, putSample, getTweet, listTweets, getSamples, getLastSample } from './lib/db.js';
import { decide, MAX_TRACK_AGE_MS } from './lib/sampler.js';

console.debug('[XVM-HIST][SW] background service worker booted');

let dbPromise = null;
function db() { return dbPromise || (dbPromise = openDb()); }

const TWITTER_DATE_RE = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/;
const MONTH = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseCreatedAt(raw) {
  if (!raw) return null;
  // Try numeric (epoch ms) directly
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  // Try native Date.parse
  const native = Date.parse(raw);
  if (Number.isFinite(native)) return native;
  // Fallback: explicit parse for Twitter's "Wed Apr 29 09:00:00 +0000 2026"
  const m = String(raw).match(TWITTER_DATE_RE);
  if (m) {
    const [, mon, day, hh, mm, ss, tz, year] = m;
    const monthIdx = MONTH[mon];
    if (monthIdx === undefined) return null;
    const tzSign = tz[0] === '-' ? -1 : 1;
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(3, 5), 10);
    const tzOffsetMs = tzSign * (tzH * 60 + tzM) * 60_000;
    // Date.UTC interprets components as UTC; subtract the timezone offset to get the right epoch
    const utc = Date.UTC(parseInt(year, 10), monthIdx, parseInt(day, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10));
    return utc - tzOffsetMs;
  }
  console.debug('[XVM-HIST][SW] parseCreatedAt failed for', raw);
  return null;
}

async function observe({ tweet, subscribed }) {
  if (!tweet?.id || !tweet?.author) {
    console.debug('[XVM-HIST][SW] observe rejected: missing id or author', { id: tweet?.id, author: tweet?.author });
    return { written: false, reason: 'invalid' };
  }
  const author = String(tweet.author).toLowerCase();
  if (!subscribed.includes(author)) {
    console.debug('[XVM-HIST][SW] observe rejected: not subscribed', author, 'subs=', subscribed);
    return { written: false, reason: 'not-subscribed' };
  }

  const createdAt = parseCreatedAt(tweet.createdAt);
  if (!createdAt) {
    console.debug('[XVM-HIST][SW] observe rejected: no created_at', tweet.id, 'raw=', tweet.createdAt);
    return { written: false, reason: 'no-created-at' };
  }
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
  console.debug('[XVM-HIST][SW] decision for', tweet.id, '@'+author, '→', decision.reason, 'shouldWrite=', decision.shouldWrite, 'ageH=', (ageMs/3600000).toFixed(1));

  if (!decision.shouldWrite) {
    if (decision.reason === 'aged-out') {
      const existing = await getTweet(d, tweet.id);
      if (existing && existing.status !== 'frozen') {
        await upsertTweet(d, { ...existing, status: 'frozen' });
        console.debug('[XVM-HIST][SW] froze aged-out tweet', tweet.id);
      }
    }
    return { written: false, reason: decision.reason };
  }

  const existing = await getTweet(d, tweet.id);
  await upsertTweet(d, {
    tweet_id: tweet.id,
    author,
    author_name: tweet.authorName || existing?.author_name || '',
    author_avatar: tweet.authorAvatar || existing?.author_avatar || '',
    text: tweet.text || existing?.text || '',
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
  console.debug('[XVM-HIST][SW] WROTE sample for', tweet.id, '@'+author, 'reason=', decision.reason, 'views=', tweet.views);
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
