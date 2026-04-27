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

  // Stub — implemented in Task 6
  async function openStarChart(tweetCtx) {
    await loadTemplatesFromStorage();
    console.log('[starchart] open() called', tweetCtx, getTemplate('Retweeters'));
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
