// Velocity Monitor — Thank-You Star Chart
// Runs in MAIN world alongside content.js. Exposes window.__XVMStarChart.
(function () {
  'use strict';

  // === Defaults ===
  // These are placeholder values. Real values get learned at runtime via
  // content.js's recordStarChartTemplate (Task 3) which writes
  // chrome.storage.local.xvmStarChartTemplate_<OpName>. If both placeholders
  // and cache are missing, getTemplate returns the placeholder and the
  // caller (Task 5 onward) surfaces an error to the user telling them to
  // organically view a Retweets/Search page once.
  const DEFAULT_TEMPLATES = {
    Retweeters: {
      queryId: 'REPLACE_AT_RUNTIME',
      features: '{}',
      authorization: '',
    },
    SearchTimeline: {
      queryId: 'REPLACE_AT_RUNTIME',
      features: '{}',
      authorization: '',
    },
  };

  const PAGE_LIMIT = 100;
  const MAX_USERS = 50000;
  const __XVM_DEBUG = true;  // flipped to false in Task 10

  let cachedTemplates = null;

  // Asks bridge.js to read both per-op storage keys and posts back as
  // XVM_SC_TEMPLATES_LOAD with shape { Retweeters: {...}, SearchTimeline: {...} }.
  function loadTemplatesFromStorage() {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        if (ev.source !== window || ev.data?.type !== 'XVM_SC_TEMPLATES_LOAD') return;
        window.removeEventListener('message', onMsg);
        cachedTemplates = ev.data.templates || {};
        resolve(cachedTemplates);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ type: 'XVM_SC_TEMPLATES_REQUEST' }, '*');
      // Fail-open after 1s if bridge doesn't respond
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        if (!cachedTemplates) cachedTemplates = {};
        resolve(cachedTemplates);
      }, 1000);
    });
  }

  function getTemplate(op) {
    const cached = cachedTemplates?.[op];
    const def = DEFAULT_TEMPLATES[op] || {};
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

  let activeOverlay = null;
  let activeAbort = null;
  let openInFlight = false;

  // MAIN-world receives localized strings via XVM_SETTINGS_UPDATE (see content.js).
  // We re-receive them here so this module doesn't need to import from content.js.
  let i18nMessages = {};
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.type !== 'XVM_SETTINGS_UPDATE') return;
    if (ev.data.messages) i18nMessages = ev.data.messages;
  });
  function tt(key) {
    return i18nMessages[key] || key;
  }

  function buildOverlay(tweetCtx) {
    const root = document.createElement('div');
    root.className = 'xvm-starchart-overlay';
    root.innerHTML = `
      <div class="xvm-sc-backdrop"></div>
      <div class="xvm-sc-frame">
        <header class="xvm-sc-header">
          <div class="xvm-sc-title"></div>
          <div class="xvm-sc-subtitle"></div>
          <div class="xvm-sc-progress"></div>
          <button class="xvm-sc-close" aria-label=""></button>
        </header>
        <canvas class="xvm-sc-canvas"></canvas>
        <footer class="xvm-sc-legend">
          <span class="xvm-sc-dot xvm-sc-dot--rt"></span><span class="xvm-sc-legend-text"></span>
          <span class="xvm-sc-dot xvm-sc-dot--qt"></span><span class="xvm-sc-legend-text"></span>
          <span class="xvm-sc-dot xvm-sc-dot--both"></span><span class="xvm-sc-legend-text"></span>
        </footer>
      </div>
    `;
    // Set text via textContent (avoids XSS from tweet text)
    root.querySelector('.xvm-sc-title').textContent = tt('contentStarChartTitle');
    root.querySelector('.xvm-sc-subtitle').textContent =
      `@${tweetCtx.authorScreenName || ''} · ${(tweetCtx.text || '').slice(0, 80)}`;
    root.querySelector('.xvm-sc-progress').textContent = tt('contentStarChartLoading');
    const closeBtn = root.querySelector('.xvm-sc-close');
    closeBtn.setAttribute('aria-label', tt('contentStarChartClose'));
    closeBtn.textContent = '×';

    const legendTexts = root.querySelectorAll('.xvm-sc-legend-text');
    legendTexts[0].textContent = tt('contentStarChartLegendRT');
    legendTexts[1].textContent = tt('contentStarChartLegendQuote');
    legendTexts[2].textContent = tt('contentStarChartLegendBoth');

    closeBtn.addEventListener('click', closeOverlay);
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

  async function callGraphQL(op, variables) {
    const tpl = getTemplate(op);
    if (!tpl.queryId || tpl.queryId === 'REPLACE_AT_RUNTIME') {
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
      const FALLBACK_WAIT_MS = 60_000;
      const waitMs = reset * 1000 > Date.now()
        ? reset * 1000 - Date.now()
        : FALLBACK_WAIT_MS;
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

  async function openStarChart(tweetCtx) {
    if (openInFlight || activeOverlay) return;
    openInFlight = true;
    try {
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
      }

      function onRateLimit(seconds) {
        progressEl.textContent =
          tt('contentStarChartRateLimited').replace('$SECONDS$', seconds.toString());
      }

      try {
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
        if (activeAbort && e.name !== 'AbortError') {
          activeAbort.abort();
        }
        if (e.name === 'AbortError') return;
        progressEl.textContent =
          tt('contentStarChartError').replace('$REASON$', e.message || 'unknown');
      }
    } finally {
      openInFlight = false;
    }
  }

  window.__XVMStarChart = {
    open: openStarChart,
    _internal: { getTemplate, loadTemplatesFromStorage, getCsrfToken },
  };

  if (__XVM_DEBUG) {
    window.__XVMStarChart._internal.DEFAULT_TEMPLATES = DEFAULT_TEMPLATES;
    window.__XVMStarChart._internal.fetchAllRetweeters = fetchAllRetweeters;
    window.__XVMStarChart._internal.fetchAllQuotes = fetchAllQuotes;
    window.__XVMStarChart._internal.callGraphQL = callGraphQL;
  }
})();
