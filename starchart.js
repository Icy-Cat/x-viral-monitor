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
  // Hardcoded baseline so the feature works on first use without needing the
  // user to organically trigger every endpoint. Captured values from
  // chrome.storage.local override these (see getTemplate) — that's how we
  // self-heal when X rotates a queryId or features blob.
  // Source values cross-checked against London-Chen/Thank-you-star-chart.
  const DEFAULT_BEARER =
    'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const DEFAULT_FEATURES_OBJ = {
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    responsive_web_twitter_article_notes_tab_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true,
    subscriptions_feature_can_gift_premium: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: true,
    rweb_video_screen_enabled: true,
  };
  const RETWEETERS_FEATURES_OBJ = {
    ...DEFAULT_FEATURES_OBJ,
    rweb_video_screen_enabled: false,
    responsive_web_profile_redirect_enabled: false,
    premium_content_api_read_enabled: false,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_grok_annotations_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    post_ctas_fetch_enabled: true,
  };
  const DEFAULT_TEMPLATES = {
    Retweeters: {
      queryId: 'nPdDY4-nwRk281j8VGR4Mg',
      features: JSON.stringify(RETWEETERS_FEATURES_OBJ),
      authorization: DEFAULT_BEARER,
    },
    SearchTimeline: {
      queryId: '6AAys3t42mosm_yTI_QENg',
      features: JSON.stringify(DEFAULT_FEATURES_OBJ),
      authorization: DEFAULT_BEARER,
    },
  };

  const PAGE_LIMIT = 100;
  const MAX_USERS = 50000;
  const __XVM_DEBUG = false;

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
    const globalAuth = cachedTemplates?._global?.authorization;
    const def = DEFAULT_TEMPLATES[op] || {};
    return {
      queryId: cached?.queryId || def.queryId,
      features: cached?.features || def.features,
      authorization: cached?.authorization || globalAuth || def.authorization,
    };
  }

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  let activeOverlay = null;
  let activeAbort = null;
  let openInFlight = false;
  let activeRenderer = null;

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
    if (activeRenderer) {
      activeRenderer.destroy();
      activeRenderer = null;
    }
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }
    document.removeEventListener('keydown', escClose);
  }

  function createRenderer(canvas, tweetCtx) {
    const ctx = canvas.getContext('2d');
    const stars = [];
    const lookup = new Map();
    let raf = null;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0, cx = 0, cy = 0;
    let zoom = 1, panX = 0, panY = 0;
    let hoverIdx = -1;
    let lastCursor = '';
    let mouseX = 0, mouseY = 0;
    let dragging = false, lastX = 0, lastY = 0;

    const GLOW_LIMIT = 1500;

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
          if (s.type !== type) {
            s.type = 'both';
            s.color = colorFor('both');
          }
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

      ctx.save();
      ctx.translate(cx + panX, cy + panY);
      ctx.scale(zoom, zoom);

      // Glowing core
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

      let nextHover = -1;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.angle += s.speed;
        const x = Math.cos(s.angle) * s.radius;
        const y = Math.sin(s.angle) * s.radius * 0.55;
        const pulse = 0.7 + 0.3 * Math.sin(t * 0.003 + s.phase);
        const r = s.size * pulse;
        ctx.beginPath();
        ctx.fillStyle = s.color;
        if (i < GLOW_LIMIT) {
          ctx.shadowBlur = 8; ctx.shadowColor = s.color;
          ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }

        const sx = (x * zoom) + cx + panX;
        const sy = (y * zoom) + cy + panY;
        const dx = mouseX - sx, dy = mouseY - sy;
        const hitR = 8 + r * zoom;
        if (dx * dx + dy * dy < hitR * hitR) {
          nextHover = i;
        }
      }
      ctx.restore();

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
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, sx + 16, sy);
        if (lastCursor !== 'pointer') { canvas.style.cursor = 'pointer'; lastCursor = 'pointer'; }
      } else {
        hoverIdx = -1;
        if (lastCursor !== 'default') { canvas.style.cursor = 'default'; lastCursor = 'default'; }
      }

      raf = requestAnimationFrame(frame);
    }

    function onMouseMove(e) {
      const r = canvas.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
    }
    function onClick() {
      if (hoverIdx < 0) return;
      const s = stars[hoverIdx];
      const url = s.quoteUrl || `https://x.com/${s.screenName}`;
      window.open(url, '_blank', 'noopener');
    }
    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      zoom = Math.max(0.3, Math.min(3, zoom * factor));
    }
    function onMouseDown(e) {
      if (hoverIdx >= 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
    }
    function onWindowMouseMove(e) {
      if (!dragging) return;
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
    }
    function onWindowMouseUp() { dragging = false; }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    raf = requestAnimationFrame(frame);

    return {
      addUsers,
      destroy() {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('click', onClick);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onWindowMouseMove);
        window.removeEventListener('mouseup', onWindowMouseUp);
      },
    };
  }

  async function callGraphQL(op, variables) {
    const tpl = getTemplate(op);
    console.log('[starchart] callGraphQL', op, {
      hasQueryId: !!tpl.queryId && tpl.queryId !== 'REPLACE_AT_RUNTIME',
      queryIdPreview: tpl.queryId ? tpl.queryId.slice(0, 8) + '...' : null,
      hasAuth: !!tpl.authorization,
      hasFeatures: !!tpl.features,
      variables,
    });
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

    console.log('[starchart] callGraphQL response', op, res.status, res.statusText);
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
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[starchart] non-OK response body', op, res.status, bodyText.slice(0, 500));
      throw new Error(`HTTP ${res.status} on ${op}: ${bodyText.slice(0, 200) || res.statusText}`);
    }
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
      if (signal?.aborted) return { truncated: false };
      if (total >= MAX_USERS) return { truncated: true };
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
      if (!nextCursor || nextCursor === cursor || users.length === 0) return { truncated: false };
      cursor = nextCursor;
    }
  }

  async function fetchAllQuotes(tweetId, onPage, opts = {}) {
    const { signal } = opts;
    let cursor = null;
    const seen = new Set();
    let total = 0;
    while (true) {
      if (signal?.aborted) return { truncated: false };
      if (total >= MAX_USERS) return { truncated: true };
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
      if (!nextCursor || nextCursor === cursor || users.length === 0) return { truncated: false };
      cursor = nextCursor;
    }
  }

  async function openStarChart(tweetCtx) {
    console.log('[starchart] open()', tweetCtx);
    if (openInFlight || activeOverlay) {
      console.log('[starchart] open() blocked — already in flight or overlay exists');
      return;
    }
    openInFlight = true;
    try {
      if (activeOverlay) closeOverlay();
      await loadTemplatesFromStorage();
      console.log('[starchart] templates loaded', cachedTemplates);

      activeOverlay = buildOverlay(tweetCtx);
      document.body.appendChild(activeOverlay);
      const canvas = activeOverlay.querySelector('.xvm-sc-canvas');
      activeRenderer = createRenderer(canvas, tweetCtx);
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
        if (activeRenderer) activeRenderer.addUsers(users, type);
        progressEl.textContent =
          tt('contentStarChartProgress').replace('$COUNT$', count.toString());
      }

      function onRateLimit(seconds) {
        progressEl.textContent =
          tt('contentStarChartRateLimited').replace('$SECONDS$', seconds.toString());
      }

      try {
        const [rtResult, qtResult] = await Promise.all([
          fetchAllRetweeters(tweetCtx.tweetId, addUsers, {
            signal: activeAbort.signal,
            onRateLimit,
          }),
          fetchAllQuotes(tweetCtx.tweetId, addUsers, {
            signal: activeAbort.signal,
            onRateLimit,
          }),
        ]);
        const truncated = !!(rtResult?.truncated || qtResult?.truncated);
        const doneKey = truncated ? 'contentStarChartDoneTruncated' : 'contentStarChartDone';
        progressEl.textContent =
          tt(doneKey).replace('$COUNT$', count.toString());
      } catch (e) {
        if (activeAbort && e.name !== 'AbortError') {
          activeAbort.abort();
        }
        if (e.name === 'AbortError') return;
        // Log to console so users can inspect stack + cause in DevTools.
        console.error('[starchart] fetch failed', e);
        const reason = e?.message || e?.toString?.() || String(e) || 'unknown';
        progressEl.textContent =
          tt('contentStarChartError').replace('$REASON$', reason);
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
