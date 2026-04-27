# Thank-You Star Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Thank-You Star Chart" menu item to each tweet's share menu that, on click, fetches all retweeters + quoters of that tweet and renders them as an animated Canvas-based star field overlay.

**Architecture:** Single new file `starchart.js` (loaded as a MAIN-world content script alongside `content.js`) that exposes a global `window.__XVMStarChart.open(tweetCtx)`. It contains the GraphQL fetcher (with paginated retweeters + quote search), the Canvas renderer (orbital particle system ported from `London-Chen/Thank-you-star-chart`), and the fullscreen overlay shell. `content.js` injects the menu item using the same pattern as the existing copy-as-markdown feature, and is extended to capture live GraphQL queryIds + auth headers so the fetcher can keep working when X rotates its endpoints. Settings toggle flows through the existing popup → `chrome.storage.sync` → `bridge.js` → `postMessage` channel.

**Tech Stack:** Vanilla JS, Manifest V3 Chrome extension, MAIN-world content scripts, 2D Canvas, X.com internal GraphQL endpoints (`Retweeters`, `SearchTimeline`).

**Testing approach:** No automated test infrastructure exists in this codebase — the extension is verified manually against live x.com. Each task ends with a manual verification checklist run in a real browser with the unpacked extension loaded. Where logic is pure (e.g. queryId template merging, rate-limit backoff timing), inline `console.assert` smoke checks are added inside the file behind a `__XVM_DEBUG` flag.

---

## File Structure

**New files:**
- `starchart.js` — single MAIN-world script with all star chart logic (fetcher + renderer + overlay + endpoint template store). Estimated ~700 LOC.
- `docs/superpowers/plans/2026-04-27-thank-you-star-chart.md` — this plan.

**Modified files:**
- `manifest.json` — add `starchart.js` to the MAIN-world content_scripts array (loaded after `content.js`).
- `content.js` — (a) extend the fetch/XHR hook to capture outgoing GraphQL `authorization` header + `queryId` per operation name into `chrome.storage.local`; (b) add `injectStarChartItem(menuEl)` next to `injectCopyMarkdownItem` and call it from the existing `menuObserver`; (c) gate on `featureStarChart` setting.
- `bridge.js` — propagate new `featureStarChart` setting in `pushSettings` and `STORAGE_DEFAULTS`/`DEFAULT_FEATURES`.
- `popup.html` — add a toggle row for the star chart feature (mirror copy-md row).
- `popup.js` — wire up the new toggle, add to `DEFAULT_FEATURES`.
- `_locales/en/messages.json`, `_locales/zh_CN/messages.json`, `_locales/ja/messages.json` — add ~14 new keys (UI strings + popup label).
- `styles.css` — add overlay styling (`.xvm-starchart-*` namespace).

---

## Pre-Flight: Capture GraphQL endpoint defaults

Before writing code, capture the **current** queryIds for `Retweeters` and `SearchTimeline` from a live x.com session. These will be hardcoded as fallback defaults.

- [ ] **Step 0.1: Capture live queryIds**

Open x.com in Chrome with DevTools → Network tab. Open any popular tweet → click "Retweets" view → in Network filter type `graphql`. Find a request matching `/i/api/graphql/<queryId>/Retweeters` and copy:
  - The `queryId` (the path segment between `/graphql/` and `/Retweeters`)
  - The full URL including `variables=...&features=...` (the `features` JSON object)
  - The request `authorization` header value (Bearer token)
  - The request `x-csrf-token` header value (this just equals the `ct0` cookie)

Repeat for `SearchTimeline` (perform any search like `from:twitter`).

Record the 4 captured values in a scratch note — they will be pasted into `starchart.js` as `DEFAULT_TEMPLATES` in Task 4.

> If anything in this step is impossible (account suspended, no popular tweets), skip — the runtime capture path (Task 3) will populate the cache the first time the user organically loads a Retweeters/Search view.

---

## Task 1: Add `featureStarChart` setting plumbing

**Files:**
- Modify: `bridge.js:35-41` (DEFAULT_FEATURES, STORAGE_DEFAULTS)
- Modify: `bridge.js:92-102` (pushSettings)
- Modify: `bridge.js:171` (storage.onChanged filter)
- Modify: `popup.js:19-25` (DEFAULT_FEATURES)

- [ ] **Step 1.1: Add the setting key to `bridge.js` defaults**

In `bridge.js`, change `DEFAULT_FEATURES` (currently lines 35-40):

```javascript
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
};
```

- [ ] **Step 1.2: Forward the setting in `pushSettings`**

In `bridge.js`, in `pushSettings` (currently line 92), add the new field to the posted message:

```javascript
function pushSettings(raw) {
  window.postMessage({
    type: 'XVM_SETTINGS_UPDATE',
    thresholds: normalizeThresholds(raw),
    featureVelocityLeaderboard: !!raw?.featureVelocityLeaderboard,
    featureCopyAsMarkdown: raw?.featureCopyAsMarkdown !== false,
    featureStarChart: raw?.featureStarChart !== false,
    leaderboardCount: normalizeLeaderboardCount(raw?.leaderboardCount),
    leaderboardColumns: normalizeLeaderboardColumns(raw?.leaderboardColumns),
    messages: getLocalizedMessages(),
  }, '*');
}
```

- [ ] **Step 1.3: Include the new key in the change-listener filter**

In `bridge.js`, in the `chrome.storage.onChanged` listener (currently line 171), add `changes.featureStarChart`:

```javascript
if (!changes.trending && !changes.viral && !changes.featureVelocityLeaderboard && !changes.featureCopyAsMarkdown && !changes.featureStarChart && !changes.leaderboardCount && !changes.leaderboardColumns) return;
```

- [ ] **Step 1.4: Mirror the default in `popup.js`**

In `popup.js`, update `DEFAULT_FEATURES` (currently lines 19-24):

```javascript
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: false,
  featureCopyAsMarkdown: true,
  featureStarChart: true,
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
};
```

- [ ] **Step 1.5: Manual verification**

Reload the unpacked extension. Open DevTools on x.com → Console. Run:

```javascript
chrome.storage.sync.get('featureStarChart', console.log)
```

Expected: `{featureStarChart: true}`. (If undefined, storage hasn't been re-read; refresh page.)

- [ ] **Step 1.6: Commit**

```bash
git add bridge.js popup.js
git commit -m "feat(starchart): add featureStarChart setting plumbing"
```

---

## Task 2: Add i18n strings

**Files:**
- Modify: `_locales/en/messages.json`
- Modify: `_locales/zh_CN/messages.json`
- Modify: `_locales/ja/messages.json`

- [ ] **Step 2.1: Add English strings**

In `_locales/en/messages.json`, append (before the closing `}`):

```json
"contentStarChartMenuLabel": {
  "message": "Thank-You Star Chart"
},
"contentStarChartAttribution": {
  "message": "via Velocity Monitor"
},
"contentStarChartTitle": {
  "message": "Thank-You Star Chart"
},
"contentStarChartLoading": {
  "message": "Loading supporters..."
},
"contentStarChartProgress": {
  "message": "$COUNT$ supporters loaded",
  "placeholders": {
    "count": { "content": "$1", "example": "1234" }
  }
},
"contentStarChartRateLimited": {
  "message": "Hit rate limit, waiting $SECONDS$s...",
  "placeholders": {
    "seconds": { "content": "$1", "example": "60" }
  }
},
"contentStarChartDone": {
  "message": "Done — $COUNT$ supporters",
  "placeholders": {
    "count": { "content": "$1", "example": "1234" }
  }
},
"contentStarChartError": {
  "message": "Could not load supporters: $REASON$",
  "placeholders": {
    "reason": { "content": "$1", "example": "network error" }
  }
},
"contentStarChartNoTweetFound": {
  "message": "Could not identify the tweet"
},
"contentStarChartLegendRT": {
  "message": "Retweet"
},
"contentStarChartLegendQuote": {
  "message": "Quote"
},
"contentStarChartLegendBoth": {
  "message": "Both"
},
"contentStarChartClose": {
  "message": "Close"
},
"popupStarChartLabel": {
  "message": "Thank-You Star Chart"
},
"popupStarChartHint": {
  "message": "Adds a star-chart option to the share menu of any tweet."
},
"flashStarChartOn": { "message": "Star chart enabled" },
"flashStarChartOff": { "message": "Star chart disabled" }
```

- [ ] **Step 2.2: Add Simplified Chinese strings**

In `_locales/zh_CN/messages.json` add:

```json
"contentStarChartMenuLabel": { "message": "感谢星图" },
"contentStarChartAttribution": { "message": "由 Velocity Monitor 提供" },
"contentStarChartTitle": { "message": "感谢星图" },
"contentStarChartLoading": { "message": "正在加载支持者..." },
"contentStarChartProgress": {
  "message": "已加载 $COUNT$ 位支持者",
  "placeholders": { "count": { "content": "$1", "example": "1234" } }
},
"contentStarChartRateLimited": {
  "message": "触发限频，等待 $SECONDS$ 秒...",
  "placeholders": { "seconds": { "content": "$1", "example": "60" } }
},
"contentStarChartDone": {
  "message": "完成 — 共 $COUNT$ 位支持者",
  "placeholders": { "count": { "content": "$1", "example": "1234" } }
},
"contentStarChartError": {
  "message": "加载失败：$REASON$",
  "placeholders": { "reason": { "content": "$1", "example": "网络错误" } }
},
"contentStarChartNoTweetFound": { "message": "无法识别这条推文" },
"contentStarChartLegendRT": { "message": "转推" },
"contentStarChartLegendQuote": { "message": "引用" },
"contentStarChartLegendBoth": { "message": "两者皆有" },
"contentStarChartClose": { "message": "关闭" },
"popupStarChartLabel": { "message": "感谢星图" },
"popupStarChartHint": { "message": "在每条推文的分享菜单中添加生成星图的入口。" },
"flashStarChartOn": { "message": "已开启星图功能" },
"flashStarChartOff": { "message": "已关闭星图功能" }
```

- [ ] **Step 2.3: Add Japanese strings**

In `_locales/ja/messages.json` add:

```json
"contentStarChartMenuLabel": { "message": "サンクス・スターチャート" },
"contentStarChartAttribution": { "message": "Velocity Monitor 提供" },
"contentStarChartTitle": { "message": "サンクス・スターチャート" },
"contentStarChartLoading": { "message": "サポーターを読み込み中..." },
"contentStarChartProgress": {
  "message": "$COUNT$ 名読み込み済み",
  "placeholders": { "count": { "content": "$1", "example": "1234" } }
},
"contentStarChartRateLimited": {
  "message": "レート制限のため $SECONDS$ 秒待機中...",
  "placeholders": { "seconds": { "content": "$1", "example": "60" } }
},
"contentStarChartDone": {
  "message": "完了 — $COUNT$ 名のサポーター",
  "placeholders": { "count": { "content": "$1", "example": "1234" } }
},
"contentStarChartError": {
  "message": "読み込み失敗：$REASON$",
  "placeholders": { "reason": { "content": "$1", "example": "ネットワークエラー" } }
},
"contentStarChartNoTweetFound": { "message": "ツイートを特定できません" },
"contentStarChartLegendRT": { "message": "リツイート" },
"contentStarChartLegendQuote": { "message": "引用" },
"contentStarChartLegendBoth": { "message": "両方" },
"contentStarChartClose": { "message": "閉じる" },
"popupStarChartLabel": { "message": "サンクス・スターチャート" },
"popupStarChartHint": { "message": "ツイートの共有メニューにスターチャート生成項目を追加します。" },
"flashStarChartOn": { "message": "スターチャートを有効化" },
"flashStarChartOff": { "message": "スターチャートを無効化" }
```

- [ ] **Step 2.4: Register the new content keys in `bridge.js` so they reach MAIN world**

In `bridge.js`, extend the `CONTENT_MESSAGE_KEYS` array (currently lines 14-33) by adding before the closing `]`:

```javascript
'contentStarChartMenuLabel',
'contentStarChartAttribution',
'contentStarChartTitle',
'contentStarChartLoading',
'contentStarChartProgress',
'contentStarChartRateLimited',
'contentStarChartDone',
'contentStarChartError',
'contentStarChartNoTweetFound',
'contentStarChartLegendRT',
'contentStarChartLegendQuote',
'contentStarChartLegendBoth',
'contentStarChartClose',
```

- [ ] **Step 2.5: Manual verification**

Reload extension. In x.com DevTools console:

```javascript
chrome.i18n.getMessage('contentStarChartMenuLabel')
```

Expected: returns the localized string for the user's chrome locale.

Validate JSON syntax for all three locale files:

```bash
node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json'))"
node -e "JSON.parse(require('fs').readFileSync('_locales/zh_CN/messages.json'))"
node -e "JSON.parse(require('fs').readFileSync('_locales/ja/messages.json'))"
```

Expected: no errors printed.

- [ ] **Step 2.6: Commit**

```bash
git add _locales bridge.js
git commit -m "feat(starchart): add i18n strings (en, zh_CN, ja)"
```

---

## Task 3: GraphQL endpoint template capture & store

X rotates its GraphQL `queryId`s and `features` flags. We hardcode the values captured in Step 0.1 as defaults, then transparently learn newer ones from any organic GraphQL traffic the page makes.

**Files:**
- Modify: `content.js:108-142` (extend fetch + XHR hooks)

- [ ] **Step 3.1: Add a template-capture helper to `content.js`**

In `content.js`, add this block immediately after the `GRAPHQL_RE` declaration (currently line 93):

```javascript
// === Star Chart: GraphQL endpoint template capture ===
// Learns the latest queryId + features blob X is using for known operations,
// plus the bearer token + ct0 csrf header. Persists to chrome.storage.local
// so the star-chart fetcher can replay the same shape later.
const STARCHART_OPS = ['Retweeters', 'SearchTimeline'];
const STARCHART_GRAPHQL_RE = /\/i\/api\/graphql\/([^/]+)\/([^?]+)/;

function recordStarChartTemplate(url, requestHeaders) {
  const m = url.match(STARCHART_GRAPHQL_RE);
  if (!m) return;
  const queryId = m[1];
  const opName = m[2];
  if (!STARCHART_OPS.includes(opName)) return;

  // Pull features JSON out of the URL so we can echo it back.
  let featuresStr = null;
  try {
    const u = new URL(url, location.origin);
    featuresStr = u.searchParams.get('features');
  } catch (_) {}

  const auth = requestHeaders?.authorization || requestHeaders?.Authorization || null;
  const update = { queryId };
  if (featuresStr) update.features = featuresStr;
  if (auth) update.authorization = auth;

  window.postMessage({
    type: 'XVM_SC_TEMPLATE_CAPTURE',
    op: opName,
    template: update,
  }, '*');
}
```

- [ ] **Step 3.2: Hook outgoing requests so headers can be inspected**

In `content.js`, modify the existing `window.fetch` override (currently lines 109-119) to inspect the request init **before** awaiting:

```javascript
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  // Star chart: capture queryId + auth header from outgoing request
  if (url && GRAPHQL_RE.test(url)) {
    const init = args[1] || {};
    const headers = init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : (init.headers || (args[0]?.headers ? Object.fromEntries(new Headers(args[0].headers).entries()) : {}));
    recordStarChartTemplate(url, headers);
  }
  const response = await originalFetch.apply(this, args);
  if (url && GRAPHQL_RE.test(url)) {
    reportRateLimit(response.headers);
    const clone = response.clone();
    clone.json().then(scanForTweets).catch(() => {});
  }
  return response;
};
```

- [ ] **Step 3.3: Hook XHR setRequestHeader so the bearer can be captured from the XHR path**

In `content.js`, immediately after the existing `XMLHttpRequest.prototype.open` patch (currently line 142), add:

```javascript
const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (name && /^authorization$/i.test(name)) {
    this.__xvmAuthHeader = value;
  }
  return originalXHRSetHeader.apply(this, arguments);
};
```

Then update the existing XHR open patch to record the template using the captured header. Replace the body of the `addEventListener('load', ...)` callback (currently lines 125-138) with:

```javascript
this.addEventListener('load', function () {
  try {
    const remaining = this.getResponseHeader('x-rate-limit-remaining');
    const reset = this.getResponseHeader('x-rate-limit-reset');
    if (remaining !== null) {
      window.postMessage({
        type: 'XVM_RATE_LIMIT',
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
      }, '*');
    }
    recordStarChartTemplate(url, { authorization: this.__xvmAuthHeader });
    scanForTweets(JSON.parse(this.responseText));
  } catch (e) {}
});
```

- [ ] **Step 3.4: Persist captured templates from MAIN world via the bridge**

In `bridge.js`, add a new message handler near the other `XVM_LB_*` handlers (around line 153):

```javascript
if (type === 'XVM_SC_TEMPLATE_CAPTURE' && event.data.op && event.data.template) {
  safeChromeCall(() => {
    chrome.storage.local.get({ xvmStarChartTemplates: {} }, (items) => {
      const cur = items.xvmStarChartTemplates || {};
      const op = event.data.op;
      cur[op] = { ...(cur[op] || {}), ...event.data.template, capturedAt: Date.now() };
      chrome.storage.local.set({ xvmStarChartTemplates: cur });
    });
  });
  return;
}
```

- [ ] **Step 3.5: Manual verification**

Reload extension. Open any tweet's "Retweets" view on x.com. Then in DevTools console:

```javascript
chrome.storage.local.get('xvmStarChartTemplates', console.log)
```

Expected: an object with `Retweeters: {queryId: '...', features: '...', authorization: 'Bearer ...', capturedAt: ...}`. Run a search like `from:twitter` and re-check; `SearchTimeline` should now also be present.

- [ ] **Step 3.6: Commit**

```bash
git add content.js bridge.js
git commit -m "feat(starchart): capture GraphQL endpoint templates from live traffic"
```

---

## Task 4: Star chart fetcher (skeleton + endpoint resolution)

Create `starchart.js` and the endpoint resolution layer. Renderer comes in Task 5; menu wiring in Task 7.

**Files:**
- Create: `starchart.js`
- Modify: `manifest.json`

- [ ] **Step 4.1: Add `starchart.js` to manifest**

In `manifest.json`, change the second content_scripts entry (currently lines 23-29):

```json
{
  "matches": ["https://x.com/*", "https://pro.x.com/*"],
  "js": ["content.js", "starchart.js"],
  "css": ["styles.css"],
  "run_at": "document_start",
  "world": "MAIN"
}
```

- [ ] **Step 4.2: Create `starchart.js` with the IIFE shell, defaults, and template resolver**

Create `starchart.js`:

```javascript
// Velocity Monitor — Thank-You Star Chart
// Runs in MAIN world alongside content.js. Exposes window.__XVMStarChart.
(function () {
  'use strict';

  // === Defaults captured from a live x.com session on 2026-04-27 ===
  // These will be overridden at runtime by templates captured in
  // chrome.storage.local under `xvmStarChartTemplates` (see content.js
  // recordStarChartTemplate). If X rotates a queryId, the next time the
  // user organically views Retweeters/Search the cache refreshes.
  const DEFAULT_TEMPLATES = {
    // PASTE THE VALUES YOU CAPTURED IN STEP 0.1 HERE.
    // Example shape — replace the placeholder strings before shipping.
    Retweeters: {
      queryId: 'REPLACE_ME_FROM_STEP_0_1',
      features: '{"creator_subscriptions_tweet_preview_api_enabled":true}',
      authorization: 'Bearer REPLACE_ME_FROM_STEP_0_1',
    },
    SearchTimeline: {
      queryId: 'REPLACE_ME_FROM_STEP_0_1',
      features: '{"creator_subscriptions_tweet_preview_api_enabled":true}',
      authorization: 'Bearer REPLACE_ME_FROM_STEP_0_1',
    },
  };

  const PAGE_LIMIT = 100;     // X allows up to ~100 per page on Retweeters
  const MAX_USERS = 50000;    // hard safety cap
  const PROGRESSIVE_FIRST_PAGE_RENDER = true;

  let cachedTemplates = null;
  function loadTemplatesFromStorage() {
    return new Promise((resolve) => {
      window.postMessage({ type: 'XVM_SC_TEMPLATES_REQUEST' }, '*');
      const onMsg = (ev) => {
        if (ev.source !== window || ev.data?.type !== 'XVM_SC_TEMPLATES_LOAD') return;
        window.removeEventListener('message', onMsg);
        cachedTemplates = ev.data.templates || {};
        resolve(cachedTemplates);
      };
      window.addEventListener('message', onMsg);
      // Fail open after 1s if bridge doesn't respond
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        if (!cachedTemplates) cachedTemplates = {};
        resolve(cachedTemplates);
      }, 1000);
    });
  }

  function getTemplate(op) {
    const cached = cachedTemplates?.[op];
    const def = DEFAULT_TEMPLATES[op];
    return {
      queryId: cached?.queryId || def.queryId,
      features: cached?.features || def.features,
      authorization: cached?.authorization || def.authorization,
    };
  }

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Exposed namespace
  window.__XVMStarChart = {
    open: openStarChart,
    _internal: { getTemplate, loadTemplatesFromStorage }, // for debugging
  };

  // Stub — implemented in later tasks
  async function openStarChart(tweetCtx) {
    await loadTemplatesFromStorage();
    console.log('[starchart] open() called', tweetCtx, getTemplate('Retweeters'));
  }
})();
```

> Replace the four `REPLACE_ME_FROM_STEP_0_1` placeholders with the actual queryIds, features JSON strings, and bearer token captured in Step 0.1. If Step 0.1 was skipped, leave them as `REPLACE_ME_FROM_STEP_0_1` — the runtime capture (Task 3) will fill the cache the first time the user views Retweeters/Search organically, and `getTemplate` will then prefer the cached values. The user-facing UI (Task 6) shows an error if both default and cache are missing.

- [ ] **Step 4.3: Wire the template loader through the bridge**

In `bridge.js`, add another handler near the others:

```javascript
if (type === 'XVM_SC_TEMPLATES_REQUEST') {
  safeChromeCall(() => {
    chrome.storage.local.get({ xvmStarChartTemplates: {} }, (items) => {
      window.postMessage({
        type: 'XVM_SC_TEMPLATES_LOAD',
        templates: items.xvmStarChartTemplates || {},
      }, '*');
    });
  });
  return;
}
```

- [ ] **Step 4.4: Manual verification**

Reload extension on x.com. In DevTools console:

```javascript
window.__XVMStarChart.open({ tweetId: '123', authorScreenName: 'demo', text: 'hi' })
```

Expected: console logs `[starchart] open() called {...} {queryId, features, authorization}`. The queryId/features come from cache if previously captured, otherwise the placeholder strings.

- [ ] **Step 4.5: Commit**

```bash
git add manifest.json starchart.js bridge.js
git commit -m "feat(starchart): scaffold starchart.js + endpoint template resolver"
```

---

## Task 5: Implement the paginated fetcher

**Files:**
- Modify: `starchart.js`

- [ ] **Step 5.1: Add the Retweeters fetcher**

In `starchart.js`, inside the IIFE, before the `window.__XVMStarChart` assignment, add:

```javascript
async function callGraphQL(op, variables) {
  const tpl = getTemplate(op);
  if (!tpl.queryId || tpl.queryId.startsWith('REPLACE_')) {
    throw new Error(`No queryId for ${op}. View a Retweets/Search tab once on x.com to populate cache.`);
  }
  if (!tpl.authorization) {
    throw new Error(`No bearer token captured for ${op}.`);
  }
  const url = new URL(`/i/api/graphql/${tpl.queryId}/${op}`, location.origin);
  url.searchParams.set('variables', JSON.stringify(variables));
  if (tpl.features) url.searchParams.set('features', tpl.features);

  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'authorization': tpl.authorization,
      'x-csrf-token': getCsrfToken(),
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': navigator.language?.split('-')[0] || 'en',
    },
  });

  if (res.status === 429) {
    const reset = parseInt(res.headers.get('x-rate-limit-reset') || '0', 10);
    const waitMs = Math.max(1000, reset * 1000 - Date.now());
    const err = new Error('rate-limited');
    err.code = 429;
    err.waitMs = waitMs;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractCursor(instructions) {
  for (const inst of instructions || []) {
    const entries = inst.entries || (inst.entry ? [inst.entry] : []);
    for (const e of entries) {
      const c = e?.content;
      if (c?.cursorType === 'Bottom' || c?.itemContent?.cursorType === 'Bottom') {
        return c.value || c.itemContent.value;
      }
      if (c?.entryType === 'TimelineTimelineCursor' && /Bottom/i.test(c.cursorType || '')) {
        return c.value;
      }
    }
  }
  return null;
}

function extractUsersFromTimeline(instructions) {
  const out = [];
  for (const inst of instructions || []) {
    const entries = inst.entries || (inst.entry ? [inst.entry] : []);
    for (const e of entries) {
      const u = e?.content?.itemContent?.user_results?.result;
      if (u && u.legacy) {
        out.push({
          id: u.rest_id,
          screenName: u.legacy.screen_name,
          name: u.legacy.name,
          avatar: u.legacy.profile_image_url_https,
        });
      }
    }
  }
  return out;
}

async function fetchAllRetweeters(tweetId, onPage, opts = {}) {
  const { signal } = opts;
  let cursor = null;
  let total = 0;
  const seen = new Set();
  while (true) {
    if (signal?.aborted) return;
    if (total >= MAX_USERS) return;
    const variables = { tweetId, count: PAGE_LIMIT };
    if (cursor) variables.cursor = cursor;

    let resp;
    try {
      resp = await callGraphQL('Retweeters', variables);
    } catch (e) {
      if (e.code === 429 && opts.onRateLimit) {
        const seconds = Math.ceil(e.waitMs / 1000);
        opts.onRateLimit(seconds);
        await new Promise((r) => setTimeout(r, e.waitMs));
        continue;
      }
      throw e;
    }

    const instructions = resp?.data?.retweeters_timeline?.timeline?.instructions
      || resp?.data?.timeline?.timeline?.instructions
      || [];
    const users = extractUsersFromTimeline(instructions).filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
    if (users.length) {
      total += users.length;
      onPage(users, 'retweet');
    }

    const nextCursor = extractCursor(instructions);
    if (!nextCursor || nextCursor === cursor || users.length === 0) return;
    cursor = nextCursor;
  }
}
```

- [ ] **Step 5.2: Add the quote-tweet search fetcher**

Below the previous block, add:

```javascript
async function fetchAllQuotes(tweetId, onPage, opts = {}) {
  const { signal } = opts;
  let cursor = null;
  const seen = new Set();
  let total = 0;
  while (true) {
    if (signal?.aborted) return;
    if (total >= MAX_USERS) return;
    const variables = {
      rawQuery: `quoted_tweet_id:${tweetId}`,
      count: 20,
      product: 'Latest',
      querySource: 'recent_search_click',
    };
    if (cursor) variables.cursor = cursor;

    let resp;
    try {
      resp = await callGraphQL('SearchTimeline', variables);
    } catch (e) {
      if (e.code === 429 && opts.onRateLimit) {
        const seconds = Math.ceil(e.waitMs / 1000);
        opts.onRateLimit(seconds);
        await new Promise((r) => setTimeout(r, e.waitMs));
        continue;
      }
      throw e;
    }

    const instructions = resp?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    const users = [];
    for (const inst of instructions) {
      const entries = inst.entries || (inst.entry ? [inst.entry] : []);
      for (const e of entries) {
        const tw = e?.content?.itemContent?.tweet_results?.result;
        const user = tw?.core?.user_results?.result;
        if (user?.legacy && !seen.has(user.rest_id)) {
          seen.add(user.rest_id);
          users.push({
            id: user.rest_id,
            screenName: user.legacy.screen_name,
            name: user.legacy.name,
            avatar: user.legacy.profile_image_url_https,
            quoteUrl: tw?.legacy?.id_str
              ? `https://x.com/${user.legacy.screen_name}/status/${tw.legacy.id_str}`
              : null,
          });
        }
      }
    }
    if (users.length) {
      total += users.length;
      onPage(users, 'quote');
    }

    const nextCursor = extractCursor(instructions);
    if (!nextCursor || nextCursor === cursor || users.length === 0) return;
    cursor = nextCursor;
  }
}
```

- [ ] **Step 5.3: Manual verification**

Reload extension. On any tweet page (e.g. `https://x.com/<user>/status/<id>`), open DevTools console and run:

```javascript
const tweetId = location.pathname.match(/status\/(\d+)/)[1];
window.__XVMStarChart._internal.loadTemplatesFromStorage().then(async () => {
  // Re-import after templates loaded — easier: just reach into the closure via a debug fn.
  // For this verification, paste fetchAllRetweeters body into console scope OR use the
  // upcoming open() flow once Task 6 lands.
});
```

> Direct standalone verification of these private functions is awkward because they live inside the IIFE. Defer real verification to Task 6 where `openStarChart` will use them. As an interim smoke check, set a `__XVM_DEBUG` global at the top of the IIFE and conditionally also assign `fetchAllRetweeters` / `fetchAllQuotes` to `window.__XVMStarChart._internal` when `__XVM_DEBUG` is true:

```javascript
const __XVM_DEBUG = true;  // flip to false before shipping
// ... after function definitions:
if (__XVM_DEBUG) {
  window.__XVMStarChart._internal.fetchAllRetweeters = fetchAllRetweeters;
  window.__XVMStarChart._internal.fetchAllQuotes = fetchAllQuotes;
}
```

Now in console:

```javascript
const tweetId = '<paste a real tweet id here>';
window.__XVMStarChart._internal.fetchAllRetweeters(tweetId, (users, type) => console.log(type, users.length, users[0]));
```

Expected: console logs successive pages of retweeter user objects until the function returns.

- [ ] **Step 5.4: Commit**

```bash
git add starchart.js
git commit -m "feat(starchart): paginated retweeters + quotes fetchers"
```

---

## Task 6: Overlay shell + progressive integration

Build the fullscreen overlay (no animated chart yet — just a header with progress + a list of supporters as proof of life).

**Files:**
- Modify: `starchart.js`
- Modify: `styles.css`

- [ ] **Step 6.1: Add overlay HTML/DOM construction in `starchart.js`**

Inside the IIFE, add:

```javascript
let activeOverlay = null;
let activeAbort = null;

function tt(key, sub) {
  return (window.__XVM_MESSAGES?.[key]) || key;
}

function buildOverlay(tweetCtx) {
  const root = document.createElement('div');
  root.className = 'xvm-starchart-overlay';
  root.innerHTML = `
    <div class="xvm-sc-backdrop"></div>
    <div class="xvm-sc-frame">
      <header class="xvm-sc-header">
        <div class="xvm-sc-title">${tt('contentStarChartTitle')}</div>
        <div class="xvm-sc-subtitle"></div>
        <div class="xvm-sc-progress">${tt('contentStarChartLoading')}</div>
        <button class="xvm-sc-close" aria-label="${tt('contentStarChartClose')}">×</button>
      </header>
      <canvas class="xvm-sc-canvas"></canvas>
      <footer class="xvm-sc-legend">
        <span class="xvm-sc-dot xvm-sc-dot--rt"></span>${tt('contentStarChartLegendRT')}
        <span class="xvm-sc-dot xvm-sc-dot--qt"></span>${tt('contentStarChartLegendQuote')}
        <span class="xvm-sc-dot xvm-sc-dot--both"></span>${tt('contentStarChartLegendBoth')}
      </footer>
    </div>
  `;
  root.querySelector('.xvm-sc-subtitle').textContent =
    `@${tweetCtx.authorScreenName || ''} · ${(tweetCtx.text || '').slice(0, 80)}`;
  root.querySelector('.xvm-sc-close').addEventListener('click', closeOverlay);
  root.querySelector('.xvm-sc-backdrop').addEventListener('click', closeOverlay);
  document.addEventListener('keydown', escClose);
  return root;
}

function escClose(ev) {
  if (ev.key === 'Escape') closeOverlay();
}

function closeOverlay() {
  if (activeAbort) { activeAbort.abort(); activeAbort = null; }
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  document.removeEventListener('keydown', escClose);
}
```

- [ ] **Step 6.2: Replace the stub `openStarChart` with real flow**

Replace the stub from Task 4 (the current `async function openStarChart`) with:

```javascript
async function openStarChart(tweetCtx) {
  if (activeOverlay) closeOverlay();
  await loadTemplatesFromStorage();

  activeOverlay = buildOverlay(tweetCtx);
  document.body.appendChild(activeOverlay);
  const progressEl = activeOverlay.querySelector('.xvm-sc-progress');
  activeAbort = new AbortController();

  // Aggregate users so we can mark dual-role (retweet + quote)
  const byId = new Map();
  let count = 0;
  function addUsers(users, type) {
    for (const u of users) {
      const cur = byId.get(u.id);
      if (cur) {
        cur.type = cur.type === type ? cur.type : 'both';
      } else {
        byId.set(u.id, { ...u, type });
        count++;
      }
    }
    progressEl.textContent =
      tt('contentStarChartProgress').replace('$COUNT$', count.toString());
    if (window.__XVMStarChartRenderer) {
      window.__XVMStarChartRenderer.addUsers(users, type);
    }
  }

  function onRateLimit(seconds) {
    progressEl.textContent =
      tt('contentStarChartRateLimited').replace('$SECONDS$', seconds.toString());
  }

  try {
    // Run both pulls concurrently so progress shows mixed sources fast.
    await Promise.all([
      fetchAllRetweeters(tweetCtx.tweetId, addUsers, {
        signal: activeAbort.signal,
        onRateLimit,
      }),
      fetchAllQuotes(tweetCtx.tweetId, addUsers, {
        signal: activeAbort.signal,
        onRateLimit,
      }),
    ]);
    progressEl.textContent =
      tt('contentStarChartDone').replace('$COUNT$', count.toString());
  } catch (e) {
    if (e.name === 'AbortError') return;
    progressEl.textContent =
      tt('contentStarChartError').replace('$REASON$', e.message || 'unknown');
  }
}
```

- [ ] **Step 6.3: Add overlay styles**

In `styles.css`, append:

```css
.xvm-starchart-overlay {
  position: fixed; inset: 0; z-index: 2147483600;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.xvm-starchart-overlay .xvm-sc-backdrop {
  position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 40%, #0d1c3d 0%, #050913 80%);
  opacity: 0.96;
}
.xvm-starchart-overlay .xvm-sc-frame {
  position: absolute; inset: 24px; display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden;
  background: rgba(5, 9, 19, 0.6);
  border: 1px solid rgba(255,255,255,0.08);
}
.xvm-starchart-overlay .xvm-sc-header {
  padding: 14px 18px; display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: "title close" "subtitle close" "progress close";
  gap: 4px; color: #e6f0ff;
}
.xvm-starchart-overlay .xvm-sc-title { grid-area: title; font-size: 18px; font-weight: 600; }
.xvm-starchart-overlay .xvm-sc-subtitle { grid-area: subtitle; font-size: 13px; opacity: .65; }
.xvm-starchart-overlay .xvm-sc-progress { grid-area: progress; font-size: 12px; opacity: .8; }
.xvm-starchart-overlay .xvm-sc-close {
  grid-area: close; width: 36px; height: 36px; border-radius: 50%;
  background: rgba(255,255,255,0.06); border: none; color: #e6f0ff;
  font-size: 22px; cursor: pointer;
}
.xvm-starchart-overlay .xvm-sc-close:hover { background: rgba(255,255,255,0.12); }
.xvm-starchart-overlay .xvm-sc-canvas {
  flex: 1 1 auto; width: 100%; display: block;
}
.xvm-starchart-overlay .xvm-sc-legend {
  padding: 10px 18px; display: flex; align-items: center; gap: 14px;
  color: #c2cbe0; font-size: 12px;
}
.xvm-starchart-overlay .xvm-sc-dot {
  display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  margin-right: 4px;
}
.xvm-starchart-overlay .xvm-sc-dot--rt   { background: #f5c451; box-shadow: 0 0 8px #f5c451; }
.xvm-starchart-overlay .xvm-sc-dot--qt   { background: #4ed6f5; box-shadow: 0 0 8px #4ed6f5; }
.xvm-starchart-overlay .xvm-sc-dot--both { background: #ff5fa3; box-shadow: 0 0 8px #ff5fa3; }
```

- [ ] **Step 6.4: Manual verification**

Reload extension. In x.com console:

```javascript
window.__XVMStarChart.open({
  tweetId: '<a real tweet id of yours or any public tweet>',
  authorScreenName: '<author>',
  text: 'demo',
})
```

Expected: fullscreen dark overlay appears. Progress text counts up as users load. ESC or × button closes. Close while loading → progress halts (abort works). On a tweet with very few retweets, "Done — N supporters" appears.

If you see "No queryId for Retweeters" — open the Retweets view of any popular tweet once, then retry. The cache will have populated.

- [ ] **Step 6.5: Commit**

```bash
git add starchart.js styles.css
git commit -m "feat(starchart): overlay shell with progressive load"
```

---

## Task 7: Canvas star renderer

Port the orbital particle field from the original repo.

**Files:**
- Modify: `starchart.js`

- [ ] **Step 7.1: Add the renderer factory**

In `starchart.js`, inside the IIFE, add:

```javascript
function createRenderer(canvas, tweetCtx) {
  const ctx = canvas.getContext('2d');
  const stars = [];      // {id, screenName, name, type, angle, radius, speed, phase, gardenOffset}
  const lookup = new Map();
  let raf = null;
  let dpr = window.devicePixelRatio || 1;
  let w = 0, h = 0, cx = 0, cy = 0;
  let zoom = 1, panX = 0, panY = 0;
  let hoverIdx = -1;
  let mouseX = 0, mouseY = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h / 2;
  }

  function colorFor(type) {
    if (type === 'quote') return '#4ed6f5';
    if (type === 'both')  return '#ff5fa3';
    return '#f5c451';
  }

  function addUsers(users, type) {
    for (const u of users) {
      if (lookup.has(u.id)) {
        const s = lookup.get(u.id);
        s.type = s.type === type ? s.type : 'both';
        s.color = colorFor(s.type);
        continue;
      }
      const star = {
        id: u.id,
        screenName: u.screenName,
        name: u.name,
        quoteUrl: u.quoteUrl,
        type,
        color: colorFor(type),
        angle: Math.random() * Math.PI * 2,
        radius: 80 + Math.random() * Math.min(w, h) * 0.4,
        speed: 0.0002 + Math.random() * 0.0008,
        phase: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 1.8,
      };
      stars.push(star);
      lookup.set(u.id, star);
    }
  }

  function frame(t) {
    ctx.clearRect(0, 0, w, h);

    // Center "core"
    ctx.save();
    ctx.translate(cx + panX, cy + panY);
    ctx.scale(zoom, zoom);
    const coreGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
    coreGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    coreGrad.addColorStop(1, 'rgba(180,210,255,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 14px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = `@${tweetCtx.authorScreenName || ''}`;
    ctx.fillText(label, 0, 0);

    // Stars
    let nextHover = -1;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.angle += s.speed;
      const x = Math.cos(s.angle) * s.radius;
      const y = Math.sin(s.angle) * s.radius * 0.55; // elliptical
      const pulse = 0.7 + 0.3 * Math.sin(t * 0.003 + s.phase);
      const r = s.size * pulse;
      ctx.beginPath();
      ctx.fillStyle = s.color;
      ctx.shadowBlur = 8; ctx.shadowColor = s.color;
      ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // Hit test (in untransformed mouse coords)
      const sx = (x * zoom) + cx + panX;
      const sy = (y * zoom) + cy + panY;
      const dx = mouseX - sx, dy = mouseY - sy;
      if (dx * dx + dy * dy < (8 + r * zoom) * (8 + r * zoom)) {
        nextHover = i;
      }
    }
    ctx.restore();

    // Hover label
    if (nextHover >= 0) {
      hoverIdx = nextHover;
      const s = stars[hoverIdx];
      const x = Math.cos(s.angle) * s.radius;
      const y = Math.sin(s.angle) * s.radius * 0.55;
      const sx = (x * zoom) + cx + panX;
      const sy = (y * zoom) + cy + panY;
      const text = `${s.name} (@${s.screenName})`;
      ctx.font = '12px -apple-system, sans-serif';
      const tw = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx + 10, sy - 12, tw, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx + 16, sy + 3);
      canvas.style.cursor = 'pointer';
    } else {
      hoverIdx = -1;
      canvas.style.cursor = 'default';
    }

    raf = requestAnimationFrame(frame);
  }

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('click', () => {
    if (hoverIdx < 0) return;
    const s = stars[hoverIdx];
    const url = s.quoteUrl || `https://x.com/${s.screenName}`;
    window.open(url, '_blank', 'noopener');
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoom = Math.max(0.3, Math.min(3, zoom * factor));
  }, { passive: false });

  // Drag-to-pan
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (hoverIdx >= 0) return; // let click work
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panX += e.clientX - lastX; panY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    addUsers,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
```

- [ ] **Step 7.2: Connect renderer to overlay lifecycle**

Modify `openStarChart` (added in Step 6.2): after appending the overlay to body, before starting fetches, instantiate the renderer:

```javascript
const canvas = activeOverlay.querySelector('.xvm-sc-canvas');
const renderer = createRenderer(canvas, tweetCtx);
window.__XVMStarChartRenderer = renderer;  // referenced by addUsers above
```

And in `closeOverlay`, before clearing `activeOverlay`, destroy the renderer:

```javascript
function closeOverlay() {
  if (activeAbort) { activeAbort.abort(); activeAbort = null; }
  if (window.__XVMStarChartRenderer) {
    window.__XVMStarChartRenderer.destroy();
    window.__XVMStarChartRenderer = null;
  }
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  document.removeEventListener('keydown', escClose);
}
```

- [ ] **Step 7.3: Manual verification**

Reload extension. In x.com console run the same `window.__XVMStarChart.open({...})` from Step 6.4. Expected:

- Animated stars appear orbiting the central handle label.
- Stars are gold (retweet), cyan (quote), or rose (both) per legend.
- Hovering a star shows a tooltip with name + handle, click opens profile (or quote URL) in new tab.
- Mouse wheel zooms in/out.
- Drag in empty space pans the field.

- [ ] **Step 7.4: Commit**

```bash
git add starchart.js
git commit -m "feat(starchart): canvas orbital renderer with hover/zoom/pan"
```

---

## Task 8: Inject menu item into share dropdown

Mirror the existing `injectCopyMarkdownItem` flow.

**Files:**
- Modify: `content.js:50` (add toggle var)
- Modify: `content.js:87` (capture toggle from settings update)
- Modify: `content.js:1173-1243` (add `injectStarChartItem`)
- Modify: `content.js:1245-1258` (call new injector from observer)

- [ ] **Step 8.1: Add the gating var**

In `content.js`, around line 50, next to `let copyAsMarkdownEnabled = true;` add:

```javascript
let starChartEnabled = true;
```

In the `XVM_SETTINGS_UPDATE` handler around line 87:

```javascript
copyAsMarkdownEnabled = event.data.featureCopyAsMarkdown !== false;
starChartEnabled = event.data.featureStarChart !== false;
```

- [ ] **Step 8.2: Add `injectStarChartItem`**

In `content.js`, after the `injectCopyMarkdownItem` function (currently ends around line 1243), add:

```javascript
function injectStarChartItem(menuEl) {
  if (!starChartEnabled) return;
  if (menuEl.querySelector('.xvm-starchart-item')) return;
  const items = menuEl.querySelectorAll('[role="menuitem"]');
  if (!items.length) return;

  const template = items[items.length - 1];
  const clone = template.cloneNode(true);
  clone.classList.add('xvm-starchart-item');
  clone.removeAttribute('data-testid');
  clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));

  // Replace label
  const textSpans = clone.querySelectorAll('span');
  let labelSpan = null;
  for (const s of textSpans) {
    if (s.children.length === 0 && (s.textContent || '').trim()) {
      labelSpan = s; break;
    }
  }
  if (labelSpan) {
    labelSpan.textContent = '';
    const title = document.createElement('span');
    title.textContent = i18n('contentStarChartMenuLabel');
    const attribution = document.createElement('span');
    attribution.className = 'xvm-copy-md-source';
    attribution.textContent = i18n('contentStarChartAttribution');
    labelSpan.appendChild(title);
    labelSpan.appendChild(document.createElement('br'));
    labelSpan.appendChild(attribution);
  } else {
    clone.textContent = i18n('contentStarChartMenuLabel');
  }

  // Star icon
  const svg = clone.querySelector('svg');
  if (svg) {
    const starIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starIcon.setAttribute('viewBox', '0 0 24 24');
    starIcon.setAttribute('width', svg.getAttribute('width') || '18');
    starIcon.setAttribute('height', svg.getAttribute('height') || '18');
    starIcon.setAttribute('aria-hidden', 'true');
    starIcon.style.fill = 'currentColor';
    starIcon.innerHTML = '<path d="M12 2l2.39 6.36L21 9l-5 4.74L17.18 21 12 17.27 6.82 21 8 13.74 3 9l6.61-.64L12 2z"/>';
    svg.replaceWith(starIcon);
  }

  clone.addEventListener('click', (ev) => {
    ev.preventDefault();
    const ctx = lastShareContext;
    if (!ctx || !ctx.article || !ctx.article.isConnected) {
      showToast(i18n('contentStarChartNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const tweetId = getTweetIdFromArticle(ctx.article);
    if (!tweetId) {
      showToast(i18n('contentStarChartNoTweetFound'));
      closeOpenMenus();
      return;
    }
    const data = tweetDataStore.get(tweetId) || {};
    closeOpenMenus();
    if (!window.__XVMStarChart?.open) {
      showToast('Star chart module not loaded');
      return;
    }
    window.__XVMStarChart.open({
      tweetId,
      authorScreenName: data.authorScreenName || data.screenName || '',
      text: data.text || '',
    });
  });

  const lastItem = items[items.length - 1];
  lastItem.parentNode.appendChild(clone);
}
```

- [ ] **Step 8.3: Call the new injector from `menuObserver`**

In `content.js`, in the existing `menuObserver` (currently around line 1245), inside the loop where `injectCopyMarkdownItem(menu)` is called, add the star chart call right after:

```javascript
for (const menu of menus) {
  if (!isShareMenu(menu)) continue;
  injectCopyMarkdownItem(menu);
  injectStarChartItem(menu);
}
```

- [ ] **Step 8.4: Confirm `getTweetIdFromArticle`, `lastShareContext`, `closeOpenMenus`, `showToast`, `i18n` are already in scope**

These all exist in `content.js` and are used by `injectCopyMarkdownItem`. No new imports needed.

- [ ] **Step 8.5: Manual verification**

Reload extension. On any tweet on x.com, click its share icon (the small upload arrow at the bottom). Expected:

- Two extra menu items appear at the bottom: "Copy as Markdown" and "Thank-You Star Chart" (each with the small "via Velocity Monitor" attribution).
- Clicking the star chart item closes the menu and opens the fullscreen overlay; supporters start streaming in.
- Disabling the toggle (popup → uncheck) and reopening the menu → no star chart item.

- [ ] **Step 8.6: Commit**

```bash
git add content.js
git commit -m "feat(starchart): inject star-chart item into tweet share menu"
```

---

## Task 9: Popup UI toggle

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 9.1: Add the toggle row to `popup.html`**

In `popup.html`, find the existing copy-md toggle block (search for `feat-copy-md`) and add an equivalent block right after it:

```html
<label class="feature-row">
  <input type="checkbox" id="feat-starchart">
  <span class="feature-text">
    <span class="feature-title" data-i18n="popupStarChartLabel">Thank-You Star Chart</span>
    <span class="feature-hint" data-i18n="popupStarChartHint">Adds a star-chart option to the share menu of any tweet.</span>
  </span>
</label>
```

(If the existing markup uses different class names, copy whatever the copy-md row uses.)

- [ ] **Step 9.2: Wire the toggle in `popup.js`**

In `popup.js`, after the `copyMdToggle` declaration (around line 67), add:

```javascript
const starChartToggle = document.getElementById('feat-starchart');
```

In the `chrome.storage.sync.get(...)` callback (around line 110), add:

```javascript
starChartToggle.checked = items.featureStarChart !== false;
```

After the existing `copyMdToggle.addEventListener` block, add:

```javascript
starChartToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureStarChart: starChartToggle.checked }, () => {
    flash(tr(starChartToggle.checked ? 'flashStarChartOn' : 'flashStarChartOff'));
  });
});
```

- [ ] **Step 9.3: Manual verification**

Reload extension. Click the toolbar icon → popup opens. Expected:

- New "Thank-You Star Chart" toggle visible, default ON.
- Toggling it shows the localized "enabled" / "disabled" flash.
- After toggling OFF, the share menu on x.com no longer shows the star chart item (may need to reload the tab once for content.js to receive the settings update).

- [ ] **Step 9.4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat(starchart): popup toggle for the star chart feature"
```

---

## Task 10: End-to-end smoke + ship prep

- [ ] **Step 10.1: Flip `__XVM_DEBUG` off**

In `starchart.js`, set `const __XVM_DEBUG = false;` (the debug-only `_internal` exports for `fetchAllRetweeters` etc are now dead).

- [ ] **Step 10.2: Confirm DEFAULT_TEMPLATES are populated with real values**

Open `starchart.js`. Verify `DEFAULT_TEMPLATES.Retweeters.queryId` and `.SearchTimeline.queryId` are NOT `REPLACE_ME_FROM_STEP_0_1`. If they still are (Step 0.1 was skipped), at minimum verify the runtime cache has been populated by viewing both endpoints organically once and re-checking `chrome.storage.local.get('xvmStarChartTemplates')`.

- [ ] **Step 10.3: Full smoke checklist**

Manually verify each of the following on x.com with the extension freshly reloaded:

  - [ ] Open a tweet with > 50 retweets. Click share → "Thank-You Star Chart". Overlay appears. Stars stream in. After loading completes, "Done — N supporters" matches roughly the tweet's retweet+quote count.
  - [ ] During load: ESC closes the overlay AND aborts in-flight pagination (no further `chrome.storage.local` writes from `recordStarChartTemplate` after close — verify by checking Network tab after ESC).
  - [ ] Hover a star → tooltip with handle. Click → opens that user's profile (or quote URL for quote-type stars) in a new tab.
  - [ ] Disable the popup toggle → reload tab → share menu does not show star chart item.
  - [ ] Re-enable → reload tab → item is back.
  - [ ] Switch chrome locale to `zh-CN` (or test by renaming `_locales/en` temporarily) and confirm the menu label, progress text, and legend are localized.
  - [ ] Trigger rate limit by repeatedly opening the chart for many large tweets in quick succession; confirm progress text shows "触发限频，等待 N 秒" / "Hit rate limit, waiting Ns" and resumes after the wait.
  - [ ] Open the chart for a tweet you authored that has zero retweets/quotes — overlay shows "Done — 0 supporters" with just the central core; no JS errors.

- [ ] **Step 10.4: Update README**

In `README.md` (and `README.zh-CN.md`), add a one-paragraph section describing the new feature next to the existing Copy as Markdown section. Include a screenshot if convenient.

- [ ] **Step 10.5: Bump version + commit**

In `manifest.json`, bump `version` from `1.3.2` to `1.4.0`.

```bash
git add starchart.js manifest.json README.md README.zh-CN.md
git commit -m "chore(starchart): finalize defaults, bump to 1.4.0"
```

- [ ] **Step 10.6: Optional — open PR**

If user requests, push branch and open a PR titled "feat: thank-you star chart" with a body describing the new menu item and toggle.

---

## Risks & Open Items (carry into review)

1. **GraphQL drift** — if X removes `Retweeters` entirely or restructures the timeline payload (`retweeters_timeline.timeline.instructions`), the fetcher silently returns 0. Consider adding a "no users found despite retweet count > 0" telemetry warning in the overlay so users know the parser is stale.
2. **`features` JSON staleness** — X sometimes 400s requests with old feature flags. The runtime capture (Task 3) refreshes `features` along with `queryId`, so the recovery path is the same: have user view the corresponding endpoint organically once.
3. **Quote search incompleteness** — `quoted_tweet_id:` search is best-effort; older quotes may be missing. Already accepted by user.
4. **Rate limit UX during long fetches** — the simple "wait N seconds" message may sit for minutes for very popular tweets. A future iteration could add a "stop here" button to keep partial results.
