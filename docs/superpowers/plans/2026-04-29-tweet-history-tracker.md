# Tweet History Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add long-running per-tweet history tracking for subscribed authors and a standalone dashboard page that visualizes impression growth alongside engagement events.

**Architecture:** A new MV3 service worker owns an IndexedDB time-series store. The existing `content.js` GraphQL interceptor extracts each tweet's metrics (now also `author`) and forwards them through `bridge.js` to the worker, which applies the sampling rules (adaptive interval + change-trigger). A new `history.html` page reads back from the worker via `chrome.runtime.sendMessage` and renders a two-pane dashboard: blogger sidebar + tweet list, plus a SVG detail view (impression curve + 3 engagement swim lanes). Subscriptions live in `chrome.storage.sync`.

**Tech Stack:** Chrome Extension MV3, vanilla JS, IndexedDB (no library), inline SVG charts, vitest for unit tests of pure modules.

**Spec:** `docs/superpowers/specs/2026-04-29-tweet-history-tracker-design.md`

---

## File Structure

**New files:**
- `lib/subscriptions.js` — Subscription list normalize/add/remove (pure, exports for tests + content scripts).
- `lib/sampler.js` — Pure decision logic: given (last_sample, current_metrics, age_ms) → `{ shouldWrite, deltas, reason }`. No I/O, fully unit-testable.
- `lib/db.js` — IndexedDB wrapper. `openDb()`, `putSample()`, `upsertTweet()`, `getTweet()`, `listTweets()`, `getSamples(tweetId)`. Used only by service worker.
- `background.js` — MV3 service worker. Owns DB. Handles `XVM_HIST_*` runtime messages.
- `history.html` / `history.js` / `history.css` — Standalone dashboard page.
- `lib/chart.js` — SVG chart renderer for detail view (curve + lanes + interactions).
- `tests/sampler.test.js`, `tests/subscriptions.test.js`, `tests/db.test.js` — vitest tests.
- `package.json`, `vitest.config.js` — minimal test infra.

**Modified files:**
- `manifest.json` — register service worker, add `lib/subscriptions.js` to content_scripts isolated-world bundle, declare `history.html` as web_accessible_resource, add `tabs` permission.
- `bridge.js` — relay `XVM_HIST_*` messages between page (`window.postMessage`) and service worker (`chrome.runtime.sendMessage`); expose subscription read/write API.
- `content.js` — (a) extend `extractTweetData()` to also return `author` (handle), `authorName`, `authorAvatar`; (b) after extracting, post `XVM_HIST_OBSERVE` via window; (c) inject ☆/★ subscribe button on tweet author rows.
- `popup.html` / `popup.js` — add "📊 Open History Dashboard" button.
- `_locales/*/messages.json` — strings for new UI.

**Why split this way:** the three pure modules (`subscriptions`, `sampler`, `db`) are small, isolated, and the only places where logic mistakes are expensive — they get TDD. `background.js`, `bridge.js`, and `content.js` are integration glue best verified by loading the extension. `history.js` + `chart.js` are UI; `chart.js` is split out because it has its own complexity (event marker math, interactions) and can be developed against fixture data first.

---

## Task 1: Test infrastructure

**Files:**
- Create: `package.json`, `vitest.config.js`, `tests/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "x-viral-monitor",
  "version": "1.5.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "fake-indexeddb": "^5.0.2"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 4: Sanity-check vitest runs**

Run: `npx vitest run`
Expected: "No test files found" — runner OK.

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.js tests/.gitkeep
git commit -m "feat: add vitest infrastructure for pure-module tests"
```

---

## Task 2: Subscription module

**Files:**
- Create: `lib/subscriptions.js`, `tests/subscriptions.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/subscriptions.test.js
import { describe, it, expect } from 'vitest';
import { normalizeHandle, addSubscription, removeSubscription, isSubscribed } from '../lib/subscriptions.js';

describe('normalizeHandle', () => {
  it('strips leading @ and lowercases', () => {
    expect(normalizeHandle('@ElonMusk')).toBe('elonmusk');
    expect(normalizeHandle('sama')).toBe('sama');
  });
  it('extracts handle from x.com URL', () => {
    expect(normalizeHandle('https://x.com/paulg/status/123')).toBe('paulg');
    expect(normalizeHandle('https://twitter.com/sama')).toBe('sama');
  });
  it('returns null for invalid input', () => {
    expect(normalizeHandle('')).toBe(null);
    expect(normalizeHandle('   ')).toBe(null);
    expect(normalizeHandle(null)).toBe(null);
  });
});

describe('addSubscription / removeSubscription / isSubscribed', () => {
  it('adds, dedupes, and removes', () => {
    let list = [];
    list = addSubscription(list, '@Foo');
    list = addSubscription(list, 'foo'); // dedupe
    list = addSubscription(list, '@bar');
    expect(list).toEqual(['foo', 'bar']);
    expect(isSubscribed(list, '@FOO')).toBe(true);
    list = removeSubscription(list, '@foo');
    expect(list).toEqual(['bar']);
  });
  it('ignores invalid handles', () => {
    expect(addSubscription(['foo'], '')).toEqual(['foo']);
    expect(addSubscription(['foo'], null)).toEqual(['foo']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/subscriptions.test.js`
Expected: FAIL — `Cannot find module '../lib/subscriptions.js'`.

- [ ] **Step 3: Implement `lib/subscriptions.js`**

```js
// lib/subscriptions.js
const URL_RE = /(?:^|\/\/)(?:www\.|m\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/;
const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;

export function normalizeHandle(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const urlMatch = s.match(URL_RE);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const hMatch = s.match(HANDLE_RE);
  if (hMatch) return hMatch[1].toLowerCase();
  return null;
}

export function isSubscribed(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return list.includes(h);
}

export function addSubscription(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return list;
  if (list.includes(h)) return list;
  return [...list, h];
}

export function removeSubscription(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return list;
  return list.filter((x) => x !== h);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/subscriptions.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/subscriptions.js tests/subscriptions.test.js
git commit -m "feat: subscription list normalize/add/remove module"
```

---

## Task 3: Sampler decision logic

**Files:**
- Create: `lib/sampler.js`, `tests/sampler.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/sampler.test.js
import { describe, it, expect } from 'vitest';
import { decide, MAX_TRACK_AGE_MS } from '../lib/sampler.js';

const baseMetrics = { impressions: 100, likes: 1, retweets: 0, replies: 0, bookmarks: 0 };

describe('decide()', () => {
  it('writes the first sample as baseline (no deltas counted as events)', () => {
    const r = decide({ last: null, current: baseMetrics, ageMs: 5 * 60_000, nowMs: 1000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('baseline');
    expect(r.deltas).toEqual({ d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
  });

  it('rejects sample after MAX_TRACK_AGE_MS', () => {
    const r = decide({ last: { ts: 0, ...baseMetrics }, current: baseMetrics, ageMs: MAX_TRACK_AGE_MS + 1, nowMs: 1 });
    expect(r.shouldWrite).toBe(false);
    expect(r.reason).toBe('aged-out');
  });

  it('writes when interval-floor reached (0-1h: 60s)', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: baseMetrics, ageMs: 30 * 60_000, nowMs: 1000 + 60_000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('interval');
  });

  it('does NOT write within interval-floor when no engagement change', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: { ...baseMetrics, impressions: 105 }, ageMs: 30 * 60_000, nowMs: 1000 + 30_000 });
    expect(r.shouldWrite).toBe(false);
    expect(r.reason).toBe('throttled');
  });

  it('writes immediately when likes increase, even within interval-floor', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: { ...baseMetrics, likes: 4 }, ageMs: 30 * 60_000, nowMs: 1000 + 5_000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('event');
    expect(r.deltas.d_likes).toBe(3);
  });

  it('clamps negative deltas to zero (API regressions)', () => {
    const last = { ts: 1000, ...baseMetrics, retweets: 10 };
    const r = decide({ last, current: { ...baseMetrics, retweets: 7 }, ageMs: 60_000, nowMs: 1000 + 90_000 });
    expect(r.deltas.d_retweets).toBe(0);
  });

  it('uses 1-6h interval floor (5 min)', () => {
    const last = { ts: 0, ...baseMetrics };
    const r1 = decide({ last, current: baseMetrics, ageMs: 2 * 60 * 60_000, nowMs: 4 * 60_000 }); // 4 min
    expect(r1.shouldWrite).toBe(false);
    const r2 = decide({ last, current: baseMetrics, ageMs: 2 * 60 * 60_000, nowMs: 6 * 60_000 }); // 6 min
    expect(r2.shouldWrite).toBe(true);
  });

  it('uses 6-48h interval floor (30 min)', () => {
    const last = { ts: 0, ...baseMetrics };
    const r1 = decide({ last, current: baseMetrics, ageMs: 12 * 60 * 60_000, nowMs: 20 * 60_000 });
    expect(r1.shouldWrite).toBe(false);
    const r2 = decide({ last, current: baseMetrics, ageMs: 12 * 60 * 60_000, nowMs: 31 * 60_000 });
    expect(r2.shouldWrite).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sampler.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/sampler.js`**

```js
// lib/sampler.js
export const MAX_TRACK_AGE_MS = 48 * 60 * 60 * 1000;

const INTERVAL_TIERS = [
  { maxAgeMs: 1 * 60 * 60_000,  floorMs: 60_000      },
  { maxAgeMs: 6 * 60 * 60_000,  floorMs: 5 * 60_000  },
  { maxAgeMs: MAX_TRACK_AGE_MS, floorMs: 30 * 60_000 },
];

function intervalFloor(ageMs) {
  for (const t of INTERVAL_TIERS) if (ageMs <= t.maxAgeMs) return t.floorMs;
  return Infinity;
}

function deltaOf(current, last, key) {
  const d = (current[key] || 0) - (last[key] || 0);
  return d > 0 ? d : 0;
}

export function decide({ last, current, ageMs, nowMs }) {
  if (ageMs > MAX_TRACK_AGE_MS) {
    return { shouldWrite: false, reason: 'aged-out', deltas: null };
  }
  if (!last) {
    return {
      shouldWrite: true,
      reason: 'baseline',
      deltas: { d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 },
    };
  }
  const deltas = {
    d_likes:     deltaOf(current, last, 'likes'),
    d_retweets:  deltaOf(current, last, 'retweets'),
    d_replies:   deltaOf(current, last, 'replies'),
    d_bookmarks: deltaOf(current, last, 'bookmarks'),
  };
  const hasEvent = deltas.d_likes + deltas.d_retweets + deltas.d_replies + deltas.d_bookmarks > 0;
  if (hasEvent) return { shouldWrite: true, reason: 'event', deltas };

  const sinceLast = nowMs - last.ts;
  if (sinceLast >= intervalFloor(ageMs)) {
    return { shouldWrite: true, reason: 'interval', deltas };
  }
  return { shouldWrite: false, reason: 'throttled', deltas };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sampler.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/sampler.js tests/sampler.test.js
git commit -m "feat: tweet sampler decision logic with adaptive intervals"
```

---

## Task 4: IndexedDB store

**Files:**
- Create: `lib/db.js`, `tests/db.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/db.test.js
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, upsertTweet, putSample, getTweet, listTweets, getSamples, getLastSample } from '../lib/db.js';

beforeEach(async () => {
  // fake-indexeddb is in-memory per test file; reset by deleting DB
  indexedDB.deleteDatabase('viral-history');
});

describe('db', () => {
  it('upserts a tweet and reads it back', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', text: 'hi', created_at: 100, status: 'active' });
    const t = await getTweet(db, 't1');
    expect(t.author).toBe('foo');
  });

  it('writes samples ordered by [tweet_id, ts]', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', created_at: 0, status: 'active' });
    await putSample(db, { tweet_id: 't1', ts: 200, impressions: 50, likes: 1, retweets: 0, replies: 0, bookmarks: 0, d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
    await putSample(db, { tweet_id: 't1', ts: 100, impressions: 30, likes: 0, retweets: 0, replies: 0, bookmarks: 0, d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
    const samples = await getSamples(db, 't1');
    expect(samples.map((s) => s.ts)).toEqual([100, 200]);
    const last = await getLastSample(db, 't1');
    expect(last.ts).toBe(200);
  });

  it('listTweets returns all stored tweets', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', created_at: 0, status: 'active' });
    await upsertTweet(db, { tweet_id: 't2', author: 'bar', created_at: 0, status: 'active' });
    const all = await listTweets(db);
    expect(all.map((t) => t.tweet_id).sort()).toEqual(['t1', 't2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/db.js`**

```js
// lib/db.js
const DB_NAME = 'viral-history';
const DB_VERSION = 1;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tweets')) {
        db.createObjectStore('tweets', { keyPath: 'tweet_id' });
      }
      if (!db.objectStoreNames.contains('samples')) {
        const s = db.createObjectStore('samples', { keyPath: 'id', autoIncrement: true });
        s.createIndex('by_tweet', 'tweet_id', { unique: false });
        s.createIndex('by_tweet_ts', ['tweet_id', 'ts'], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, names, mode) {
  return db.transaction(names, mode);
}

function pwrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function upsertTweet(db, tweet) {
  const t = tx(db, ['tweets'], 'readwrite');
  await pwrap(t.objectStore('tweets').put(tweet));
}

export async function getTweet(db, tweetId) {
  const t = tx(db, ['tweets'], 'readonly');
  return pwrap(t.objectStore('tweets').get(tweetId));
}

export async function listTweets(db) {
  const t = tx(db, ['tweets'], 'readonly');
  return pwrap(t.objectStore('tweets').getAll());
}

export async function putSample(db, sample) {
  const t = tx(db, ['samples'], 'readwrite');
  try {
    await pwrap(t.objectStore('samples').add(sample));
  } catch (e) {
    // ConstraintError on duplicate [tweet_id, ts] — silently skip
    if (e?.name !== 'ConstraintError') throw e;
  }
}

export async function getSamples(db, tweetId) {
  const t = tx(db, ['samples'], 'readonly');
  const idx = t.objectStore('samples').index('by_tweet_ts');
  const range = IDBKeyRange.bound([tweetId, -Infinity], [tweetId, Infinity]);
  return pwrap(idx.getAll(range));
}

export async function getLastSample(db, tweetId) {
  const t = tx(db, ['samples'], 'readonly');
  const idx = t.objectStore('samples').index('by_tweet_ts');
  const range = IDBKeyRange.bound([tweetId, -Infinity], [tweetId, Infinity]);
  return new Promise((res, rej) => {
    const req = idx.openCursor(range, 'prev');
    req.onsuccess = () => res(req.result ? req.result.value : null);
    req.onerror = () => rej(req.error);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/db.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/db.js tests/db.test.js
git commit -m "feat: IndexedDB time-series store for tweet history"
```

---

## Task 5: Background service worker

**Files:**
- Create: `background.js`
- Modify: `manifest.json`

- [ ] **Step 1: Update `manifest.json` to register the worker, add permission, and expose history page**

Edit `manifest.json` — set `permissions` and add `background` + `web_accessible_resources` blocks. The full file should read:

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "version": "1.5.0",
  "description": "__MSG_extDescription__",
  "default_locale": "en",
  "permissions": ["storage", "tabs"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "__MSG_extName__"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://pro.x.com/*"],
      "js": ["bridge.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://x.com/*", "https://pro.x.com/*"],
      "js": ["content.js", "starchart.js"],
      "css": ["styles.css"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["history.html", "history.js", "history.css", "lib/chart.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 2: Implement `background.js`**

```js
// background.js
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
  if (!decision.shouldWrite) return { written: false, reason: decision.reason };

  await upsertTweet(d, {
    tweet_id: tweet.id,
    author,
    author_name: tweet.authorName || '',
    author_avatar: tweet.authorAvatar || '',
    text: tweet.text || '',
    created_at: createdAt,
    first_seen_at: (await getTweet(d, tweet.id))?.first_seen_at || now,
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
```

- [ ] **Step 3: Manual smoke test in Chrome**

1. `chrome://extensions` → enable Developer mode → Load unpacked → select project root.
2. Open the extension's service worker DevTools (link on the extension card).
3. In the worker console run:
   ```
   chrome.runtime.sendMessage({type:'XVM_HIST_LIST_TWEETS'}, (r) => console.log(r));
   ```
4. Expected: `{tweets: []}`.

- [ ] **Step 4: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: MV3 service worker with IndexedDB history store"
```

---

## Task 6: Bridge relay for history messages

**Files:**
- Modify: `bridge.js` (append at end of file)

- [ ] **Step 1: Add relay handlers**

Append to `bridge.js`:

```js
// === History tracker relay ===
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data.type !== 'string' || !data.type.startsWith('XVM_HIST_')) return;

  // Subscriptions live in chrome.storage.sync; expose read/write directly.
  if (data.type === 'XVM_HIST_SUBS_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.sync.get({ subscribed: [] }, (items) => {
        window.postMessage({ type: 'XVM_HIST_SUBS_LOAD', subscribed: items.subscribed || [] }, '*');
      });
    });
    return;
  }
  if (data.type === 'XVM_HIST_SUBS_SET' && Array.isArray(data.subscribed)) {
    safeChromeCall(() => {
      chrome.storage.sync.set({ subscribed: data.subscribed });
    });
    return;
  }

  // Forward observe / query messages to service worker, return response via postMessage.
  if (data.type === 'XVM_HIST_OBSERVE') {
    safeChromeCall(() => {
      chrome.runtime.sendMessage({ type: 'XVM_HIST_OBSERVE', tweet: data.tweet }, () => {
        if (chrome.runtime.lastError) { /* worker dead, ignore */ }
      });
    });
    return;
  }
});

// Push subscription updates back to the page on any sync change.
safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.subscribed) return;
    window.postMessage({ type: 'XVM_HIST_SUBS_LOAD', subscribed: changes.subscribed.newValue || [] }, '*');
  });
});
```

- [ ] **Step 2: Reload extension and verify relay**

In any x.com tab's DevTools (page console):
```
window.postMessage({type:'XVM_HIST_SUBS_REQUEST'}, '*');
window.addEventListener('message', (e) => e.data?.type === 'XVM_HIST_SUBS_LOAD' && console.log('subs:', e.data.subscribed));
```
Expected: `subs: []` logged.

- [ ] **Step 3: Commit**

```bash
git add bridge.js
git commit -m "feat: bridge relay for history tracker messages"
```

---

## Task 7: Extract author + observe in content.js

**Files:**
- Modify: `content.js` — extend `extractTweetData` and call into observe

- [ ] **Step 1: Extend `extractTweetData()` to include author fields**

In `content.js`, modify the function `extractTweetData` (currently at line 233). Replace the final `return { ... }` block (lines 282-294) with:

```js
const userResult =
  tweet.core?.user_results?.result ||
  result.core?.user_results?.result ||
  null;
const userLegacy = userResult?.legacy || {};
const author = userLegacy.screen_name ? userLegacy.screen_name.toLowerCase() : '';
const authorName = userLegacy.name || '';
const authorAvatar = userLegacy.profile_image_url_https || '';

return {
  id: legacy.id_str,
  views: viewCount,
  likes: legacy.favorite_count || 0,
  retweets: legacy.retweet_count || 0,
  replies: legacy.reply_count || 0,
  bookmarks: legacy.bookmark_count || 0,
  createdAt: legacy.created_at,
  text: noteText || legacy.full_text || '',
  author,
  authorName,
  authorAvatar,
  urlMap,
  articleMd,
  articleTitle,
};
```

- [ ] **Step 2: Add observe dispatch right after `tweetDataStore.set(...)`**

In `content.js`, find the lines (currently near line 215):

```js
const data = extractTweetData(obj.tweet_results.result);
if (data) { tweetDataStore.set(data.id, data); found = true; }
```

Replace with:

```js
const data = extractTweetData(obj.tweet_results.result);
if (data) {
  tweetDataStore.set(data.id, data);
  found = true;
  postObserveSample(data);
}
```

Then add this helper near the top of `content.js` (after the `tweetDataStore` declaration):

```js
function postObserveSample(data) {
  if (!data?.id || !data?.author) return;
  window.postMessage({ type: 'XVM_HIST_OBSERVE', tweet: data }, '*');
}
```

Search for any other call sites to `extractTweetData` whose result is stored in `tweetDataStore` (there may be one in TweetDetail fallback) and add `postObserveSample(data)` there as well.

- [ ] **Step 3: Manual verification**

1. Reload extension, open `pro.x.com` with at least one column.
2. In service worker DevTools console:
   ```
   chrome.storage.sync.set({subscribed: ['elonmusk']});
   ```
3. Open a column showing @elonmusk's posts; let it auto-refresh once.
4. In worker console:
   ```
   chrome.runtime.sendMessage({type:'XVM_HIST_LIST_TWEETS'}, (r) => console.log(r));
   ```
5. Expected: at least one tweet object whose `author === 'elonmusk'`.

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat: extract author from GraphQL and forward observations to worker"
```

---

## Task 8: Inline ☆/★ subscribe button

**Files:**
- Modify: `content.js` (DOM injection alongside existing badge logic), `styles.css`

- [ ] **Step 1: Add a state cache for subscriptions in `content.js`**

Near the top of `content.js`, add:

```js
let subscribedHandles = [];
function isHandleSubscribed(h) { return !!h && subscribedHandles.includes(String(h).toLowerCase()); }

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data?.type === 'XVM_HIST_SUBS_LOAD') {
    subscribedHandles = Array.isArray(e.data.subscribed) ? e.data.subscribed : [];
    document.querySelectorAll('article[data-xvm-sub-rendered]').forEach((a) => a.removeAttribute('data-xvm-sub-rendered'));
    renderSubscribeButtons();
  }
});
window.postMessage({ type: 'XVM_HIST_SUBS_REQUEST' }, '*');
```

- [ ] **Step 2: Add `renderSubscribeButtons()` and call it from the existing render pipeline**

Add to `content.js`:

```js
function findArticleHandle(article) {
  // X renders the author handle as an <a href="/screenName"> inside the article header.
  const a = article.querySelector('a[role="link"][href^="/"]');
  if (!a) return null;
  const m = a.getAttribute('href').match(/^\/([A-Za-z0-9_]{1,15})(?:\/|$)/);
  return m ? m[1].toLowerCase() : null;
}

function renderSubscribeButtons() {
  document.querySelectorAll('article').forEach((article) => {
    if (article.dataset.xvmSubRendered) return;
    const handle = findArticleHandle(article);
    if (!handle) return;
    const header = article.querySelector('a[role="link"][href^="/"]')?.parentElement;
    if (!header) return;
    const btn = document.createElement('button');
    btn.className = 'xvm-sub-btn';
    btn.dataset.handle = handle;
    btn.title = 'Track this author';
    btn.textContent = isHandleSubscribed(handle) ? '★' : '☆';
    btn.classList.toggle('xvm-sub-on', isHandleSubscribed(handle));
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const next = isHandleSubscribed(handle)
        ? subscribedHandles.filter((h) => h !== handle)
        : [...subscribedHandles, handle];
      window.postMessage({ type: 'XVM_HIST_SUBS_SET', subscribed: next }, '*');
    });
    header.appendChild(btn);
    article.dataset.xvmSubRendered = '1';
  });
}
```

Find the existing `renderBadges()` call site(s) (where the page's badge pipeline runs on mutations / settings updates) and add `renderSubscribeButtons()` immediately after each.

- [ ] **Step 3: Style the button — append to `styles.css`**

```css
.xvm-sub-btn {
  background: transparent;
  border: none;
  color: #71767b;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  margin-left: 4px;
}
.xvm-sub-btn:hover { color: #1d9bf0; }
.xvm-sub-btn.xvm-sub-on { color: #f5a623; }
article[data-xvm-sub-rendered] { /* visual placeholder for tracked tweets handled in JS */ }
```

- [ ] **Step 4: Manual verification**

1. Reload extension, open `x.com`.
2. Each tweet's author header shows ☆.
3. Click ☆ on one tweet → it switches to ★ on every visible tweet by the same author.
4. In DevTools: `chrome.storage.sync.get('subscribed', console.log)` shows `['<handle>']`.
5. Click ★ → toggles back to ☆ and the array clears that entry.

- [ ] **Step 5: Commit**

```bash
git add content.js styles.css
git commit -m "feat: inline subscribe button on timeline tweets"
```

---

## Task 9: Popup entry point

**Files:**
- Modify: `popup.html`, `popup.js`, `_locales/en/messages.json`, `_locales/zh_CN/messages.json`, `_locales/ja/messages.json`

- [ ] **Step 1: Add a button to `popup.html`**

Inside the popup body (immediately above the existing settings form), add:

```html
<button id="xvm-open-history" class="xvm-popup-btn">📊 <span data-i18n="popupOpenHistory">Open History Dashboard</span></button>
```

- [ ] **Step 2: Wire it up in `popup.js`**

Append to `popup.js`:

```js
document.getElementById('xvm-open-history')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
});
```

- [ ] **Step 3: Add localized strings**

In `_locales/en/messages.json`, add (preserving JSON structure):

```json
"popupOpenHistory": { "message": "Open History Dashboard" }
```

In `_locales/zh_CN/messages.json`:

```json
"popupOpenHistory": { "message": "打开历史面板" }
```

In `_locales/ja/messages.json`:

```json
"popupOpenHistory": { "message": "履歴ダッシュボードを開く" }
```

- [ ] **Step 4: Manual verification**

1. Reload extension, click extension icon → popup shows "📊 Open History Dashboard" button.
2. Click → new tab opens at `chrome-extension://<id>/history.html` (404 expected — page not built yet).

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js _locales
git commit -m "feat: popup button to open history dashboard"
```

---

## Task 10: History page — list view

**Files:**
- Create: `history.html`, `history.js`, `history.css`

- [ ] **Step 1: Create `history.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>X Viral Monitor — History</title>
  <link rel="stylesheet" href="history.css">
</head>
<body>
  <header class="xvm-h-top">
    <h1>X Viral Monitor — History</h1>
    <div class="xvm-h-actions">
      <input id="xvm-h-search" type="search" placeholder="Search tweet text…">
      <button id="xvm-h-export">Export CSV</button>
      <button id="xvm-h-settings">Settings</button>
    </div>
  </header>
  <main class="xvm-h-main">
    <aside id="xvm-h-bloggers" class="xvm-h-side">
      <div class="xvm-h-blogger xvm-h-blogger-all" data-handle="">★ All <span class="count" data-count="all">0</span></div>
      <div id="xvm-h-blogger-list"></div>
      <button id="xvm-h-add-blogger">+ Add blogger</button>
    </aside>
    <section class="xvm-h-content">
      <div class="xvm-h-filters">
        Sort: <select id="xvm-h-sort">
          <option value="velocity">Velocity</option>
          <option value="impressions">Impressions</option>
          <option value="likes">Likes</option>
          <option value="retweets">Retweets</option>
          <option value="created_at">Posted</option>
        </select>
        Range: <select id="xvm-h-range">
          <option value="all">All</option>
          <option value="day">24h</option>
          <option value="week">7 days</option>
        </select>
        Status: <select id="xvm-h-status">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
        </select>
      </div>
      <div id="xvm-h-list"></div>
      <div id="xvm-h-detail" hidden></div>
    </section>
  </main>
  <script type="module" src="history.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `history.css` (skeleton)**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #0f1419; background: #fff; }
.xvm-h-top { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #eff3f4; }
.xvm-h-top h1 { margin: 0; font-size: 18px; }
.xvm-h-actions { display: flex; gap: 8px; }
.xvm-h-actions input, .xvm-h-actions button { padding: 6px 10px; border: 1px solid #cfd9de; border-radius: 6px; background: #fff; cursor: pointer; }
.xvm-h-main { display: grid; grid-template-columns: 260px 1fr; height: calc(100vh - 53px); }
.xvm-h-side { border-right: 1px solid #eff3f4; padding: 12px; overflow: auto; }
.xvm-h-blogger { padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; }
.xvm-h-blogger:hover, .xvm-h-blogger.active { background: #f7f9f9; }
.xvm-h-blogger .count { color: #536471; }
.xvm-h-content { padding: 12px 20px; overflow: auto; }
.xvm-h-filters { display: flex; gap: 12px; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #eff3f4; }
.xvm-h-card { padding: 12px; border: 1px solid #eff3f4; border-radius: 10px; margin: 12px 0; cursor: pointer; }
.xvm-h-card:hover { background: #f7f9f9; }
.xvm-h-card .meta { color: #536471; font-size: 13px; }
.xvm-h-card .stats { display: flex; gap: 14px; margin-top: 6px; font-size: 13px; }
.xvm-h-card .spark { height: 24px; }
#xvm-h-add-blogger { width: 100%; margin-top: 16px; padding: 8px; background: #fff; border: 1px dashed #cfd9de; border-radius: 6px; cursor: pointer; }
```

- [ ] **Step 3: Create `history.js`**

```js
// history.js
async function rpc(message) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(message, (r) => {
      if (chrome.runtime.lastError) return rej(chrome.runtime.lastError);
      res(r);
    });
  });
}

const state = {
  tweets: [],
  lastByTweet: new Map(), // tweet_id -> last sample
  filter: { handle: '', sort: 'velocity', range: 'all', status: 'all', search: '' },
};

function velocity(tweet, last) {
  if (!last) return 0;
  const ageH = Math.max(0.1, (last.ts - tweet.created_at) / 3_600_000);
  return last.impressions / ageH;
}

function applyFilter() {
  const { handle, sort, range, status, search } = state.filter;
  const now = Date.now();
  const cutoff = range === 'day' ? now - 86_400_000 : range === 'week' ? now - 7 * 86_400_000 : 0;
  let rows = state.tweets.filter((t) => {
    if (handle && t.author !== handle) return false;
    if (status !== 'all' && t.status !== status) return false;
    if (cutoff && t.created_at < cutoff) return false;
    if (search && !(t.text || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  rows.sort((a, b) => {
    const la = state.lastByTweet.get(a.tweet_id);
    const lb = state.lastByTweet.get(b.tweet_id);
    switch (sort) {
      case 'impressions': return (lb?.impressions || 0) - (la?.impressions || 0);
      case 'likes':       return (lb?.likes || 0)       - (la?.likes || 0);
      case 'retweets':    return (lb?.retweets || 0)    - (la?.retweets || 0);
      case 'created_at':  return b.created_at - a.created_at;
      case 'velocity':
      default:            return velocity(b, lb) - velocity(a, la);
    }
  });
  return rows;
}

function renderBloggers() {
  const counts = new Map();
  for (const t of state.tweets) counts.set(t.author, (counts.get(t.author) || 0) + 1);
  document.querySelector('[data-count="all"]').textContent = state.tweets.length;
  const root = document.getElementById('xvm-h-blogger-list');
  root.innerHTML = '';
  for (const [handle, n] of [...counts.entries()].sort()) {
    const el = document.createElement('div');
    el.className = 'xvm-h-blogger';
    if (handle === state.filter.handle) el.classList.add('active');
    el.dataset.handle = handle;
    el.innerHTML = `@${handle}<span class="count">${n}</span>`;
    el.addEventListener('click', () => { state.filter.handle = handle; renderAll(); });
    root.appendChild(el);
  }
}

function spark(samples) {
  if (!samples?.length) return '';
  const w = 80, h = 24;
  const max = Math.max(...samples.map((s) => s.impressions), 1);
  const pts = samples.map((s, i) => [i * w / Math.max(1, samples.length - 1), h - (s.impressions / max) * h]);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline fill="none" stroke="#1d9bf0" stroke-width="1.5" points="${pts.map((p) => p.join(',')).join(' ')}"/></svg>`;
}

async function renderList() {
  const list = document.getElementById('xvm-h-list');
  const detail = document.getElementById('xvm-h-detail');
  detail.hidden = true;
  list.hidden = false;
  list.innerHTML = '';
  const rows = applyFilter();
  // For sparkline, fetch samples lazily per card (small N).
  for (const t of rows) {
    const last = state.lastByTweet.get(t.tweet_id);
    const card = document.createElement('div');
    card.className = 'xvm-h-card';
    card.innerHTML = `
      <div class="meta">@${t.author} · ${new Date(t.created_at).toLocaleString()}</div>
      <div class="text">${(t.text || '').slice(0, 200)}</div>
      <div class="stats">
        <span>👁 ${last?.impressions ?? 0}</span>
        <span>❤ ${last?.likes ?? 0}</span>
        <span>↻ ${last?.retweets ?? 0}</span>
        <span>💬 ${last?.replies ?? 0}</span>
        <span class="spark-slot"></span>
      </div>`;
    card.addEventListener('click', () => openDetail(t.tweet_id));
    list.appendChild(card);
    rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id }).then((r) => {
      card.querySelector('.spark-slot').innerHTML = spark(r.samples || []);
    });
  }
}

async function openDetail(tweetId) {
  // Stub for Task 11.
  alert('detail view: ' + tweetId);
}

function renderAll() { renderBloggers(); renderList(); }

async function refresh() {
  const r = await rpc({ type: 'XVM_HIST_LIST_TWEETS' });
  state.tweets = r.tweets || [];
  // pull last sample for each tweet so the list can rank without fetching all samples
  state.lastByTweet.clear();
  await Promise.all(state.tweets.map(async (t) => {
    const sr = await rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id });
    const samples = sr.samples || [];
    if (samples.length) state.lastByTweet.set(t.tweet_id, samples[samples.length - 1]);
  }));
  renderAll();
}

document.getElementById('xvm-h-search').addEventListener('input', (e) => { state.filter.search = e.target.value; renderList(); });
document.getElementById('xvm-h-sort').addEventListener('change', (e) => { state.filter.sort = e.target.value; renderList(); });
document.getElementById('xvm-h-range').addEventListener('change', (e) => { state.filter.range = e.target.value; renderList(); });
document.getElementById('xvm-h-status').addEventListener('change', (e) => { state.filter.status = e.target.value; renderList(); });
document.querySelector('.xvm-h-blogger-all').addEventListener('click', () => { state.filter.handle = ''; renderAll(); });
document.getElementById('xvm-h-add-blogger').addEventListener('click', async () => {
  const input = prompt('Enter @handle or x.com URL:');
  if (!input) return;
  const { normalizeHandle } = await import('./lib/subscriptions.js');
  const h = normalizeHandle(input);
  if (!h) return alert('Invalid handle');
  const cur = await chrome.storage.sync.get({ subscribed: [] });
  const next = cur.subscribed.includes(h) ? cur.subscribed : [...cur.subscribed, h];
  await chrome.storage.sync.set({ subscribed: next });
});

refresh();
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'sync') refresh(); });
```

- [ ] **Step 4: Manual verification**

1. Reload extension. Subscribe to one author from x.com (☆ → ★).
2. Wait for at least one auto-refresh to capture a sample.
3. Click extension icon → "Open History Dashboard".
4. Page renders the blogger sidebar with the subscribed handle (count ≥ 1) and a tweet card with stats + sparkline.
5. Click sort dropdown → list re-orders.
6. Click the blogger row → only that author's tweets remain.

- [ ] **Step 5: Commit**

```bash
git add history.html history.js history.css
git commit -m "feat: history dashboard list view (sidebar + cards)"
```

---

## Task 11: Detail view — chart with curve + event lanes

**Files:**
- Create: `lib/chart.js`
- Modify: `history.js` — replace `openDetail` stub

- [ ] **Step 1: Implement `lib/chart.js`**

```js
// lib/chart.js
// Renders the tweet detail chart: impression curve on top, three engagement
// swim lanes below. All metrics share an X axis (sample timestamps).
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(c);
  return e;
}

const PAD = { l: 50, r: 20, t: 20, bCurve: 30, lane: 18 };

export function renderChart(host, samples) {
  host.innerHTML = '';
  if (!samples.length) {
    host.textContent = 'No samples yet.';
    return;
  }
  const w = host.clientWidth || 800;
  const curveH = 200;
  const lanesH = PAD.lane * 3 + 10;
  const h = PAD.t + curveH + PAD.bCurve + lanesH + 24;
  const x0 = PAD.l, x1 = w - PAD.r;
  const tMin = samples[0].ts;
  const tMax = samples[samples.length - 1].ts;
  const xScale = (t) => x0 + (x1 - x0) * (t - tMin) / Math.max(1, tMax - tMin);
  const yMax = Math.max(...samples.map((s) => s.impressions), 1);
  const yScale = (v) => PAD.t + curveH - (v / yMax) * curveH;

  const svg = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'xvm-chart' });

  // Y axis label
  svg.appendChild(el('text', { x: 8, y: PAD.t + 12, 'font-size': 11, fill: '#536471' }, [Object.assign(document.createTextNode('Impressions'), {})]));

  // Detect gaps > 2× expected interval and render dotted segments
  const points = samples.map((s) => [xScale(s.ts), yScale(s.impressions)]);
  const SOLID_GAP_MS = 10 * 60_000; // anything beyond 10min between points = "missing data"
  let pathD = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].ts - samples[i - 1].ts;
    if (gap > SOLID_GAP_MS) {
      // dotted segment
      svg.appendChild(el('line', {
        x1: points[i - 1][0], y1: points[i - 1][1], x2: points[i][0], y2: points[i][1],
        stroke: '#cfd9de', 'stroke-width': 1.5, 'stroke-dasharray': '3,3',
      }));
      pathD += ` M ${points[i][0]} ${points[i][1]}`;
    } else {
      pathD += ` L ${points[i][0]} ${points[i][1]}`;
    }
  }
  // Area fill
  const areaD = pathD + ` L ${points[points.length - 1][0]} ${PAD.t + curveH} L ${points[0][0]} ${PAD.t + curveH} Z`;
  svg.appendChild(el('path', { d: areaD, fill: '#1d9bf0', 'fill-opacity': '0.12' }));
  svg.appendChild(el('path', { d: pathD, fill: 'none', stroke: '#1d9bf0', 'stroke-width': 2 }));

  // Lanes
  const laneTop = PAD.t + curveH + PAD.bCurve;
  const lanes = [
    { key: 'd_likes',    color: '#f91880', symbol: '♥' },
    { key: 'd_retweets', color: '#00ba7c', symbol: '↻' },
    { key: 'd_replies',  color: '#7856ff', symbol: '💬' },
  ];
  lanes.forEach((lane, idx) => {
    const y = laneTop + idx * PAD.lane;
    svg.appendChild(el('text', { x: 8, y: y + 4, 'font-size': 11, fill: lane.color }, [document.createTextNode(lane.symbol)]));
    svg.appendChild(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#eff3f4' }));
    for (const s of samples) {
      const d = s[lane.key] || 0;
      if (d <= 0) continue;
      const r = 4 + 2 * Math.sqrt(d);
      const cx = xScale(s.ts);
      const dot = el('circle', { cx, cy: y, r, fill: lane.color, 'data-ts': s.ts, 'data-key': lane.key, 'data-delta': d });
      dot.style.cursor = 'pointer';
      svg.appendChild(dot);
    }
  });

  // Time axis
  const fmt = (t) => new Date(t).toLocaleTimeString();
  svg.appendChild(el('text', { x: x0, y: h - 4, 'font-size': 10, fill: '#536471' }, [document.createTextNode(fmt(tMin))]));
  svg.appendChild(el('text', { x: x1, y: h - 4, 'font-size': 10, fill: '#536471', 'text-anchor': 'end' }, [document.createTextNode(fmt(tMax))]));

  // Hover line + tooltip
  const hoverLine = el('line', { x1: 0, y1: PAD.t, x2: 0, y2: laneTop + lanes.length * PAD.lane, stroke: '#0f1419', 'stroke-width': 1, 'stroke-dasharray': '2,3', opacity: 0 });
  svg.appendChild(hoverLine);
  const tooltip = document.createElement('div');
  tooltip.className = 'xvm-chart-tip';
  tooltip.style.position = 'absolute';
  tooltip.style.background = '#0f1419';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '4px 8px';
  tooltip.style.borderRadius = '4px';
  tooltip.style.fontSize = '12px';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.display = 'none';
  host.style.position = 'relative';
  host.appendChild(svg);
  host.appendChild(tooltip);

  svg.addEventListener('mouseleave', () => { hoverLine.setAttribute('opacity', '0'); tooltip.style.display = 'none'; });
  svg.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    if (x < x0 || x > x1) return;
    const t = tMin + ((x - x0) / (x1 - x0)) * (tMax - tMin);
    let nearest = samples[0], dMin = Infinity;
    for (const s of samples) { const d = Math.abs(s.ts - t); if (d < dMin) { dMin = d; nearest = s; } }
    hoverLine.setAttribute('x1', xScale(nearest.ts));
    hoverLine.setAttribute('x2', xScale(nearest.ts));
    hoverLine.setAttribute('opacity', '1');
    tooltip.style.display = 'block';
    tooltip.style.left = (xScale(nearest.ts) + 8) + 'px';
    tooltip.style.top = (yScale(nearest.impressions) - 4) + 'px';
    tooltip.textContent = `${fmt(nearest.ts)} · 👁${nearest.impressions} ❤${nearest.likes} ↻${nearest.retweets} 💬${nearest.replies}`;
  });

  // Per-event tooltip on circle hover
  svg.querySelectorAll('circle').forEach((c) => {
    c.addEventListener('mouseenter', (ev) => {
      tooltip.style.display = 'block';
      tooltip.style.left = (parseFloat(c.getAttribute('cx')) + 8) + 'px';
      tooltip.style.top = (parseFloat(c.getAttribute('cy')) - 24) + 'px';
      const ts = Number(c.getAttribute('data-ts'));
      const delta = c.getAttribute('data-delta');
      const key = c.getAttribute('data-key').replace('d_', '+');
      tooltip.textContent = `${fmt(ts)} · ${key} ${delta}`;
    });
  });
}
```

- [ ] **Step 2: Replace `openDetail` in `history.js`**

In `history.js` replace the `openDetail` stub with:

```js
async function openDetail(tweetId) {
  const list = document.getElementById('xvm-h-list');
  const detail = document.getElementById('xvm-h-detail');
  list.hidden = true;
  detail.hidden = false;
  detail.innerHTML = '<button id="xvm-h-back">← Back</button><div id="xvm-h-detail-meta"></div><div id="xvm-h-chart"></div>';
  document.getElementById('xvm-h-back').addEventListener('click', () => { renderList(); });
  const [{ tweet }, { samples }] = await Promise.all([
    rpc({ type: 'XVM_HIST_GET_TWEET', tweetId }),
    rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId }),
  ]);
  const last = samples[samples.length - 1];
  document.getElementById('xvm-h-detail-meta').innerHTML = `
    <h2>@${tweet.author} · ${new Date(tweet.created_at).toLocaleString()}</h2>
    <p>${(tweet.text || '').slice(0, 400)}</p>
    <p>👁 ${last?.impressions ?? 0}  ❤ ${last?.likes ?? 0}  ↻ ${last?.retweets ?? 0}  💬 ${last?.replies ?? 0}</p>`;
  const { renderChart } = await import('./lib/chart.js');
  renderChart(document.getElementById('xvm-h-chart'), samples);
}
```

- [ ] **Step 3: Manual verification**

1. With at least one tracked tweet that has 5+ samples (subscribe and wait, or seed via worker console: `for (let i=0;i<10;i++) await ...` — easiest is to wait for real polling).
2. Reload `history.html` → click a tweet card.
3. Detail page shows: header, current stats, blue impression curve, three lanes with circles wherever Δ>0.
4. Hover the curve → vertical dashed line tracks; tooltip shows time + metrics.
5. Hover an event circle → tooltip shows `time · +N likes/retweets/replies`.
6. Click "← Back" → list returns.

- [ ] **Step 4: Commit**

```bash
git add lib/chart.js history.js
git commit -m "feat: detail view with impression curve and engagement event lanes"
```

---

## Task 12: CSV export

**Files:**
- Modify: `history.js` (wire up `#xvm-h-export`)

- [ ] **Step 1: Implement export**

Append to `history.js`:

```js
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportCsv() {
  const rows = [['tweet_id', 'author', 'text', 'created_at', 'ts', 'impressions', 'likes', 'retweets', 'replies', 'bookmarks', 'd_likes', 'd_retweets', 'd_replies', 'd_bookmarks']];
  for (const t of state.tweets) {
    const { samples } = await rpc({ type: 'XVM_HIST_GET_SAMPLES', tweetId: t.tweet_id });
    for (const s of samples) {
      rows.push([
        t.tweet_id, t.author, t.text, new Date(t.created_at).toISOString(),
        new Date(s.ts).toISOString(),
        s.impressions, s.likes, s.retweets, s.replies, s.bookmarks,
        s.d_likes, s.d_retweets, s.d_replies, s.d_bookmarks,
      ]);
    }
  }
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `xvm-history-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('xvm-h-export').addEventListener('click', exportCsv);
```

- [ ] **Step 2: Manual verification**

1. With ≥1 tracked tweet with samples, click "Export CSV".
2. Browser downloads `xvm-history-<ts>.csv`.
3. Open in Excel/Numbers — first row is header, subsequent rows have one row per sample.

- [ ] **Step 3: Commit**

```bash
git add history.js
git commit -m "feat: CSV export of all tracked tweet samples"
```

---

## Task 13: Lifecycle freeze + edge cases

**Files:**
- Modify: `background.js` (already handles aged-out via sampler; verify and add explicit `frozen` finalization)
- Add: `tests/sampler.test.js` (extend with a regression test) — optional clean-up

- [ ] **Step 1: Add explicit freezing on aged-out**

In `background.js`'s `observe()`, after the `if (!decision.shouldWrite) return ...` line, add a one-shot status update for tweets that just crossed 48h:

Replace:

```js
if (!decision.shouldWrite) return { written: false, reason: decision.reason };
```

With:

```js
if (!decision.shouldWrite) {
  if (decision.reason === 'aged-out') {
    const existing = await getTweet(d, tweet.id);
    if (existing && existing.status !== 'frozen') {
      await upsertTweet(d, { ...existing, status: 'frozen' });
    }
  }
  return { written: false, reason: decision.reason };
}
```

- [ ] **Step 2: Manual verification**

1. In the worker console, simulate a frozen state by directly editing a tweet's `created_at` to 50 hours ago:
   ```
   const db = await (await import(chrome.runtime.getURL('lib/db.js'))).openDb();
   ```
2. Reload `history.html` and switch the Status filter to "Frozen" — frozen tweet appears.

(In practice, freezing happens automatically once a sampling attempt occurs after 48h; manual verification is best done by waiting or by editing system time.)

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: mark aged-out tweets as frozen on next observation"
```

---

## Task 14: Self-review & end-to-end smoke

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: subscriptions (5), sampler (8+), db (3) all pass.

- [ ] **Step 2: End-to-end smoke**

1. Fresh-load extension on a clean profile.
2. On `pro.x.com`, subscribe to a known active account (☆ → ★).
3. Leave the column open for ~5 minutes — verify in worker DevTools that `chrome.runtime.sendMessage({type:'XVM_HIST_LIST_TWEETS'}, console.log)` returns at least one tweet, and that `getSamples` returns ≥ 2 entries (baseline + at least one event/interval frame).
4. Open the History dashboard from the popup.
5. Confirm:
   - Sidebar shows the subscribed handle with correct count.
   - List sorts by velocity by default; switching to "Likes" reorders.
   - Status filter "All" → "Active" filters out nothing yet (no aged tweets in 5 min).
   - Card sparkline draws.
   - Click card → detail view shows curve and at least one engagement marker (or just a flat curve if nothing changed yet).
   - Hover curve / dot → tooltip works.
   - "Back" returns to list.
   - "Export CSV" downloads a file with the expected rows.

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "chore: tweet history tracker E2E verified"
```

---

## Self-Review

**Spec coverage:**
- Subscriptions (sync, A & B entry points): Task 2 (logic), Task 8 (☆/★ button), Task 10 (+ Add blogger).
- 48h sampling lifecycle, B+C strategy: Task 3 (decide), Task 5 (background calls decide).
- IndexedDB schema: Task 4.
- Service worker: Task 5.
- Bridge relay + author extraction + observe dispatch: Tasks 6 & 7.
- Independent dashboard page (popup entry, web_accessible_resources, two-column layout): Tasks 5/9/10.
- Detail view (B: curve + event lanes, gap = dotted, hover, marker radius `4+2√Δ`): Task 11.
- CSV export: Task 12.
- Frozen status finalization: Task 13.
- Manifest changes (worker, permission, web_accessible_resources): Task 5.
- i18n strings for popup button: Task 9.

**Items intentionally deferred (covered by spec's "暂不做"):** velocity overlay toggle, "标注拐点", multi-select brush zoom on detail view, settings panel (custom interval tiers, retention, clear-all). Plan's scope keeps those out — listed here so reviewers know they were considered.

**Placeholder scan:** every code step contains complete code; manual verification steps describe exact actions and expected output.

**Type consistency:** `decide()` return shape (`{shouldWrite, reason, deltas}`) matches `background.js` consumption; sample row schema (`tweet_id, ts, impressions, likes, retweets, replies, bookmarks, d_*`) matches in `db.js`, `background.js`, `history.js`, `chart.js`. Tweet metadata schema (`tweet_id, author, author_name, author_avatar, text, created_at, first_seen_at, last_sampled_at, status`) is consistent across `background.js`, `history.js`, and the spec.

