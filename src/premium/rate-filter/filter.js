// === Premium feature: X tweet rate filter (M1 step 1) ===
//
// Ported from PoC repo `x-tweet-rate-filter` (commits 70a1bc3 / 404d7bb /
// 0d96b82, see #42 thread). Gated by window.__xvmPro.isFeatureEnabled.
//
// Filters X Home / List / HomeLatest timelines by double-threshold:
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
  // Step 1 stub: hardcoded defaults; step C wires popup → chrome.storage →
  // updateSettings(). Numbers chosen to match #42 PoC defaults.
  //
  // enabled defaults to FALSE per user decision (2026-05-19 #45): users
  // opt in via popup, never get surprised by hidden tweets. Step C popup
  // will surface a toggle and persist it.
  let SETTINGS = {
    enabled: false,
    shortRateThreshold: 50,
    shortAbsoluteThreshold: 10000,
    longRateThreshold: 10,
    longAbsoluteThreshold: 2000,
    scopeHome: true,
    scopeList: true,
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

  // Listen for settings pushed from isolated.js (popup wrote
  // chrome.storage.local.xvm_rate_filter_v1 → isolated.js relays).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'XVM_RATE_SETTINGS_UPDATE' && event.data.settings) {
      updateSettings(event.data.settings);
    }
  });

  // === Endpoint whitelist ===
  const ENDPOINT_MATCHERS = [
    { re: /\/i\/api\/graphql\/[^/]+\/HomeTimeline\b/,             scope: 'home' },
    { re: /\/i\/api\/graphql\/[^/]+\/HomeLatestTimeline\b/,       scope: 'home' },
    { re: /\/i\/api\/graphql\/[^/]+\/ListLatestTweetsTimeline\b/, scope: 'list' },
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
        if (!SETTINGS.enabled) return;
        if (scope === 'home' && !SETTINGS.scopeHome) return;
        if (scope === 'list' && !SETTINGS.scopeList) return;
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
  function applyHidesNow() {
    if (!gateOpen()) return; // tier may have flipped to free mid-session
    const arts = document.querySelectorAll('article[data-testid="tweet"]');
    for (const art of arts) {
      const tid = articleTweetId(art);
      if (!tid) continue;
      const d = decisions.get(tid);
      if (!d) continue;
      if (d.hide) {
        if (art.style.display !== 'none') {
          art.style.display = 'none';
          art.setAttribute('data-xvm-rate-hidden', d.reason);
          if (!counted.has(tid)) counted.add(tid);
        }
      } else if (art.getAttribute('data-xvm-rate-hidden')) {
        art.style.display = '';
        art.removeAttribute('data-xvm-rate-hidden');
      }
    }
  }

  function articleTweetId(art) {
    const a = art.querySelector('a[href*="/status/"]');
    if (!a) return null;
    const m = a.getAttribute('href').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // === Tier revoke at runtime ===
  // If user's tier drops mid-session (trial expired / license revoked),
  // un-hide everything we previously hid so they regain Free behavior.
  function revoke() {
    document.querySelectorAll('article[data-xvm-rate-hidden]').forEach((art) => {
      art.style.display = '';
      art.removeAttribute('data-xvm-rate-hidden');
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
    _debug: { classify, applyHidesNow, gateOpen },
  };

  activate();
})();
