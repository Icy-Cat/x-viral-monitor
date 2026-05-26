// === Premium feature: X tweet rate filter (M1 step 1) ===
//
// Ported from PoC repo `x-tweet-rate-filter` (commits 70a1bc3 / 404d7bb /
// 0d96b82, see #42 thread). Gated by window.__xvmPro.isFeatureEnabled.
//
// Filters X Home / List / Profile / Tweet-detail timelines by double-threshold:
//   keep = (views/min > rateThreshold) OR (views > absoluteThreshold)
// Short tweets and X Articles use independent threshold pairs.
//
// Loaded in MAIN world after lib/x-net-hook.js + premium/license/gate.js.
// Tightly coupled to window.__xvmNet (net hook) and window.__xvmPro (gate).
//
// Settings persistence and popup UI land in step C (popup re-design). For
// step 1 we hardcode DEFAULT_SETTINGS so the feature is live and tunable
// only via the dev console: `window.__xvmRateFilter.updateSettings({...})`.

(() => {
  if (window.__xvmRateFilter) {
    window.__xvmRateFilter.reset();
    return;
  }

  // === Gate check ===
  // Premium feature modules MUST query the gate at activation time. We also
  // subscribe to tier changes so revoke-on-expiry works at runtime without
  // a page reload.
  function gateOpen() {
    return window.__xvmPro?.isFeatureEnabled('rate-filter') === true;
  }

  // === Settings ===
  // Defaults locked 2026-05-19 popup-redesign (Accordion C + minimal shadcn):
  //   - enabled: false (opt-in; users never get surprised by hidden tweets)
  //   - thresholds bumped after user testing showed 50/10/2000 was too
  //     aggressive on quiet timelines; new 1000/1000/10000/10000 keeps
  //     virality-actually-passing tweets only.
  // popup-rate-filter.js DEFAULTS mirror these values; contract test pins
  // both files identical.
  let SETTINGS = {
    enabled: false,
    shortRateThreshold: 1000,
    shortAbsoluteThreshold: 10000,
    longRateThreshold: 1000,
    longAbsoluteThreshold: 10000,
    scopeHome: true,
    scopeList: true,
    scopeProfile: true,
    scopeStatus: true,
  };

  function updateSettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    SETTINGS = { ...SETTINGS, ...patch };
    // Re-evaluate all known tweets against new thresholds.
    for (const [id, d] of decisions) {
      if (d.raw) decisions.set(id, { ...classify(d.raw), raw: d.raw });
    }
    applyHidesNow();
  }

  // === State ===
  // tweetId -> { hide, isLong, reason, raw }
  const decisions = new Map();
  const counted = new Set();
  const HIDE_ATTR = 'data-xvm-rate-hidden';
  const OTHER_HIDE_ATTRS = ['data-xvm-content-filter-hidden'];

  // Listen for settings pushed from isolated.js (popup wrote
  // chrome.storage.local.xvm_rate_filter_v1 → isolated.js relays).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'XVM_RATE_SETTINGS_UPDATE' && event.data.settings) {
      updateSettings(event.data.settings);
    }
  });

  // === Endpoint whitelist ===
  const SCOPE_SETTING_KEY = {
    home: 'scopeHome',
    list: 'scopeList',
    profile: 'scopeProfile',
    status: 'scopeStatus',
  };
  const RESERVED_PROFILE_PATHS = new Set([
    'compose', 'explore', 'home', 'i', 'jobs', 'messages', 'notifications',
    'search', 'settings',
  ]);

  function scopeFromPath(pathname = window.location.pathname) {
    const path = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (path === '/' || path === '/home') return 'home';
    if (/^\/i\/lists\/[^/]+/.test(path) || /^\/[^/]+\/lists\/[^/]+/.test(path)) return 'list';
    if (/^\/[^/]+\/status\/\d+/.test(path)) return 'status';
    const m = path.match(/^\/([^/]+)$/);
    if (m && !RESERVED_PROFILE_PATHS.has(m[1])) return 'profile';
    return null;
  }

  function scopeEnabled(scope) {
    const key = SCOPE_SETTING_KEY[scope];
    return !key || SETTINGS[key] !== false;
  }

  function currentPageScopeEnabled() {
    const scope = scopeFromPath();
    return !scope || scopeEnabled(scope);
  }

  const ENDPOINT_MATCHERS = [
    { re: /\/i\/api\/graphql\/[^/]+\/HomeTimeline\b/,             scope: 'home' },
    { re: /\/i\/api\/graphql\/[^/]+\/HomeLatestTimeline\b/,       scope: 'home' },
    { re: /\/i\/api\/graphql\/[^/]+\/ListLatestTweetsTimeline\b/, scope: 'list' },
    { re: /\/i\/api\/graphql\/[^/]+\/UserTweets\b/,              scope: 'profile' },
    { re: /\/i\/api\/graphql\/[^/]+\/UserTweetsAndReplies\b/,    scope: 'profile' },
    { re: /\/i\/api\/graphql\/[^/]+\/TweetDetail\b/,             scope: 'status' },
  ];

  // === Net hook subscription ===
  // Race condition fix (dev2 bug, Codex root-cause):
  //   activate() runs at module load when gate.js still reports 'free'
  //   (fail-closed default before isolated.js async-pushes the real tier).
  //   The original code returned early from activate() so subscribe()
  //   never ran; when tier later flipped to 'trial' via onTierChange,
  //   subscribe() was never re-invoked → net hook had no listener for X
  //   GraphQL responses → decisions map stayed empty → applyHidesNow()
  //   was a no-op.
  //   Fix: make subscribe() idempotent + invoke it from onTierChange.
  let subscribed = false;
  function subscribe() {
    if (subscribed) return;
    if (!window.__xvmNet) {
      // x-net-hook not yet loaded — defensive. Manifest order should
      // guarantee this never fires.
      console.warn('[xvm rate-filter] __xvmNet missing — skipping subscription');
      return;
    }
    subscribed = true;
    for (const { re, scope } of ENDPOINT_MATCHERS) {
      window.__xvmNet.onResponse(re, async ({ response, source }) => {
        if (!gateOpen()) return;
        if (!scopeEnabled(scope) || !currentPageScopeEnabled()) return;
        let data;
        try {
          if (source === 'fetch') data = await response.clone().json();
          else data = response.json();
        } catch (_) { return; }
        scanForTweets(data);
        applyHidesNow();
      });
    }
  }

  // === Tweet scanner ===
  function scanForTweets(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.tweet_results?.result) {
      const raw = extractRaw(obj.tweet_results.result);
      if (raw && raw.id) {
        decisions.set(raw.id, { ...classify(raw), raw });
      }
    }
    if (Array.isArray(obj)) {
      for (const item of obj) scanForTweets(item);
    } else {
      for (const k of Object.keys(obj)) {
        if (k === 'tweet_results') continue;
        const v = obj[k];
        if (v && typeof v === 'object') scanForTweets(v);
      }
    }
  }

  function extractRaw(result) {
    const tweet = result.tweet || result;
    const legacy = tweet?.legacy;
    if (!legacy) return null;
    const rt = legacy.retweeted_status_result?.result;
    if (rt) return extractRaw(rt);
    const views = parseInt(tweet.views?.count, 10) || 0;
    if (tweet.views?.state !== 'EnabledWithCount') return null;
    return {
      id: legacy.id_str,
      views,
      createdAt: legacy.created_at,
      isArticle: !!tweet.article?.article_results?.result,
    };
  }

  // === Classification ===
  function minutesSince(createdAt) {
    const t = Date.parse(createdAt);
    if (!Number.isFinite(t)) return 1;
    return Math.max(1, (Date.now() - t) / 60000);
  }

  function classify(raw) {
    const mins = minutesSince(raw.createdAt);
    const rate = raw.views / mins;
    const isLong = !!raw.isArticle;
    const rateThr = isLong ? SETTINGS.longRateThreshold : SETTINGS.shortRateThreshold;
    const absThr  = isLong ? SETTINGS.longAbsoluteThreshold : SETTINGS.shortAbsoluteThreshold;
    const keep = rate > rateThr || raw.views > absThr;
    return {
      hide: !keep,
      isLong,
      reason: keep
        ? `keep (rate=${rate.toFixed(1)} abs=${raw.views})`
        : `hide (rate=${rate.toFixed(1)}≤${rateThr} abs=${raw.views}≤${absThr})`,
    };
  }

  // === DOM hide ===
  // We hide the surrounding `cellInnerDiv` rather than the `article` itself.
  // X wraps each timeline item — tweet + any attached reply-expansion
  // controls ("Show more replies") — in a single [data-testid=cellInnerDiv]
  // cell. Hiding the inner article alone left the reply-expansion stub
  // visible, producing a string of empty "显示更多回复" links in the timeline
  // (Codex dev3 bb-browser repro). The data-attribute marker stays on the
  // article so tracking selectors (e.g. revoke's [data-xvm-rate-hidden])
  // keep working.
  function applyHidesNow() {
    // Tier revoke or OFF must restore only nodes this module hid. Decisions
    // stay cached so turning ON again can immediately re-hide already scanned
    // timeline tweets without waiting for another GraphQL response.
    if (!gateOpen() || !SETTINGS.enabled || !currentPageScopeEnabled()) {
      revoke();
      return;
    }
    const arts = document.querySelectorAll('article[data-testid="tweet"]');
    for (const art of arts) {
      const tid = articleTweetId(art);
      if (!tid) continue;
      const d = decisions.get(tid);
      if (!d) continue;
      const cell = cellForArticle(art);
      if (d.hide) {
        if (cell.style.display !== 'none') {
          cell.style.display = 'none';
          art.setAttribute(HIDE_ATTR, d.reason);
          if (!counted.has(tid)) counted.add(tid);
        }
      } else if (art.getAttribute(HIDE_ATTR)) {
        art.removeAttribute(HIDE_ATTR);
        restoreCellIfNoOtherXvmMarker(art, cell);
      }
    }
  }

  function articleTweetId(art) {
    const a = art.querySelector('a[href*="/status/"]');
    if (!a) return null;
    const m = a.getAttribute('href').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function cellForArticle(art) {
    return art.closest('[data-testid="cellInnerDiv"]') || art;
  }

  function hasOtherXvmHideMarker(art) {
    return OTHER_HIDE_ATTRS.some((attr) => art.hasAttribute(attr));
  }

  function restoreCellIfNoOtherXvmMarker(art, cell = cellForArticle(art)) {
    if (!hasOtherXvmHideMarker(art)) cell.style.display = '';
  }

  // === Tier revoke at runtime ===
  // If user's tier drops mid-session (trial expired / license revoked),
  // un-hide everything we previously hid so they regain Free behavior.
  function revoke() {
    document.querySelectorAll(`article[${HIDE_ATTR}]`).forEach((art) => {
      const cell = cellForArticle(art);
      art.removeAttribute(HIDE_ATTR);
      restoreCellIfNoOtherXvmMarker(art, cell);
    });
  }

  window.__xvmPro?.onTierChange((tier) => {
    if (!gateOpen()) {
      revoke();
      return;
    }
    // Gate just opened → register the net hook (no-op if already
    // subscribed) so future GraphQL responses are observed, and connect
    // the MutationObserver so X virtual-scroll re-mounts keep applying
    // the hide decisions. Both activate() invocations were skipped at
    // fail-closed boot (dev3 root cause #2 — Codex bb-browser confirmed
    // mo.observe never ran). MutationObserver.observe is idempotent
    // for the same target+options.
    subscribe();
    mo.observe(document.documentElement, { childList: true, subtree: true });
    applyHidesNow();
  });

  // === Mutation observer (X virtual scroll re-mounts) ===
  const mo = new MutationObserver(() => applyHidesNow());

  // === Bootstrap ===
  function activate() {
    if (!gateOpen()) return;
    subscribe();
    // Observe even while disabled. If the user turns the filter OFF, virtual
    // scroll can remount cells that were hidden earlier; applyHidesNow()
    // will revoke our own markers instead of leaving stale display:none.
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.__xvmRateFilter = {
    updateSettings,
    getSettings: () => ({ ...SETTINGS }),
    decisions, // dev introspection
    reset() {
      subscribed = false;
      decisions.clear();
      counted.clear();
      mo.disconnect();
      revoke();
    },
    _debug: { classify, applyHidesNow, gateOpen, scopeFromPath, scopeEnabled },
  };

  activate();
})();
