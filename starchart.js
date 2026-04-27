// Velocity Monitor — Thank-You Star Chart
// Runs in MAIN world alongside content.js. Exposes window.__XVMStarChart.
// Side-panel structure adapted from London-Chen/Thank-you-star-chart
// (MIT License). https://github.com/London-Chen/Thank-you-star-chart
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
  const RIVER_AUTO_ADVANCE_MS = 8500;
  const SCREEN_NAME_RE = /^[A-Za-z0-9_]{1,15}$/;

  // X handles are constrained to [A-Za-z0-9_]{1,15}. Anything outside that
  // shape would be a tampered GraphQL payload — refuse to navigate.
  function safeProfileUrl(screenName) {
    if (!screenName || !SCREEN_NAME_RE.test(screenName)) return null;
    return `https://x.com/${screenName}`;
  }
  function safeStatusUrl(screenName, statusId) {
    if (!safeProfileUrl(screenName)) return null;
    if (!/^\d{1,32}$/.test(String(statusId || ''))) return null;
    return `https://x.com/${screenName}/status/${statusId}`;
  }

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

    const backdrop = document.createElement('div');
    backdrop.className = 'xvm-sc-backdrop';

    const frame = document.createElement('div');
    frame.className = 'xvm-sc-frame';

    // --- Header ---
    const header = document.createElement('header');
    header.className = 'xvm-sc-header';

    // Left header info block
    const headerInfo = document.createElement('div');
    headerInfo.className = 'xvm-sc-header-info';

    const titleLabel = document.createElement('div');
    titleLabel.className = 'xvm-sc-title-label';
    titleLabel.textContent = tt('contentStarChartTitleLabel');

    const titleEl = document.createElement('div');
    titleEl.className = 'xvm-sc-title';
    titleEl.textContent = tt('contentStarChartTitle');

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'xvm-sc-subtitle';
    subtitleEl.textContent = `@${tweetCtx.authorScreenName || ''} · ${(tweetCtx.text || '').slice(0, 80)}`;

    headerInfo.appendChild(titleLabel);
    headerInfo.appendChild(titleEl);
    headerInfo.appendChild(subtitleEl);

    // Right header actions block
    const headerActions = document.createElement('div');
    headerActions.className = 'xvm-sc-header-actions';

    const progressEl = document.createElement('div');
    progressEl.className = 'xvm-sc-progress';
    progressEl.textContent = tt('contentStarChartLoading');

    const resetBtn = document.createElement('button');
    resetBtn.className = 'xvm-sc-reset';
    resetBtn.setAttribute('aria-label', tt('contentStarChartReset'));
    resetBtn.setAttribute('title', tt('contentStarChartReset'));
    resetBtn.textContent = '↺';
    resetBtn.addEventListener('click', () => {
      if (activeRenderer) activeRenderer.resetView();
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'xvm-sc-close';
    closeBtn.setAttribute('aria-label', tt('contentStarChartClose'));
    closeBtn.setAttribute('title', tt('contentStarChartClose'));
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closeOverlay);

    headerActions.appendChild(progressEl);
    headerActions.appendChild(resetBtn);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerInfo);
    header.appendChild(headerActions);

    // --- Body (3-region grid + bottom strip) ---
    const body = document.createElement('div');
    body.className = 'xvm-sc-body';

    // LEFT column: stats + legend
    const sideLeft = document.createElement('div');
    sideLeft.className = 'xvm-sc-side-left';

    // Stats card (goes in left column)
    const statsCard = document.createElement('div');
    statsCard.className = 'xvm-sc-stats-card';

    const statsHeader = document.createElement('div');
    statsHeader.className = 'xvm-sc-section-header';
    statsHeader.textContent = tt('contentStarChartStatsSectionTitle');

    const statsEl = document.createElement('div');
    statsEl.className = 'xvm-sc-stats-grid';

    statsCard.appendChild(statsHeader);
    statsCard.appendChild(statsEl);
    sideLeft.appendChild(statsCard);

    // Legend (at bottom of left column)
    const legend = document.createElement('div');
    legend.className = 'xvm-sc-legend';

    const dotRT = document.createElement('span');
    dotRT.className = 'xvm-sc-legend-item';
    const dotRTDot = document.createElement('span');
    dotRTDot.className = 'xvm-sc-dot xvm-sc-dot--rt';
    const textRT = document.createElement('span');
    textRT.className = 'xvm-sc-legend-text';
    textRT.textContent = tt('contentStarChartLegendRT');
    dotRT.appendChild(dotRTDot);
    dotRT.appendChild(textRT);

    const dotQt = document.createElement('span');
    dotQt.className = 'xvm-sc-legend-item';
    const dotQtDot = document.createElement('span');
    dotQtDot.className = 'xvm-sc-dot xvm-sc-dot--qt';
    const textQt = document.createElement('span');
    textQt.className = 'xvm-sc-legend-text';
    textQt.textContent = tt('contentStarChartLegendQuote');
    dotQt.appendChild(dotQtDot);
    dotQt.appendChild(textQt);

    const dotBoth = document.createElement('span');
    dotBoth.className = 'xvm-sc-legend-item';
    const dotBothDot = document.createElement('span');
    dotBothDot.className = 'xvm-sc-dot xvm-sc-dot--both';
    const textBoth = document.createElement('span');
    textBoth.className = 'xvm-sc-legend-text';
    textBoth.textContent = tt('contentStarChartLegendBoth');
    dotBoth.appendChild(dotBothDot);
    dotBoth.appendChild(textBoth);

    legend.appendChild(dotRT);
    legend.appendChild(dotQt);
    legend.appendChild(dotBoth);
    sideLeft.appendChild(legend);

    // CENTER: stage (canvas + empty state)
    const stage = document.createElement('div');
    stage.className = 'xvm-sc-stage';

    const canvas = document.createElement('canvas');
    canvas.className = 'xvm-sc-canvas';

    // Center status strip inside stage (below canvas, matching original)
    const stageStatus = document.createElement('div');
    stageStatus.className = 'xvm-sc-stage-status';

    const emptyEl = document.createElement('div');
    emptyEl.className = 'xvm-sc-empty xvm-sc-empty--hidden';
    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'xvm-sc-empty-icon';
    emptyIcon.textContent = '✦';
    const emptyText = document.createElement('div');
    emptyText.textContent = tt('contentStarChartEmpty');
    emptyEl.appendChild(emptyIcon);
    emptyEl.appendChild(emptyText);

    stage.appendChild(canvas);
    stage.appendChild(emptyEl);
    stage.appendChild(stageStatus);

    // RIGHT column: Quote River only
    const sideRight = document.createElement('div');
    sideRight.className = 'xvm-sc-side-right';

    // BOTTOM strip: search + chips + people grid
    const bottomStrip = document.createElement('div');
    bottomStrip.className = 'xvm-sc-bottom';

    // Filter chips row (in bottom strip)
    const chipsEl = document.createElement('div');
    chipsEl.className = 'xvm-sc-chips';

    const chipDefs = [
      { key: null,        label: tt('contentStarChartFilterAll'),       cls: 'xvm-sc-chip--all' },
      { key: 'retweet',   label: tt('contentStarChartFilterRetweet'),   cls: 'xvm-sc-chip--rt' },
      { key: 'quote',     label: tt('contentStarChartFilterQuote'),     cls: 'xvm-sc-chip--qt' },
      { key: 'both',      label: tt('contentStarChartFilterBoth'),      cls: 'xvm-sc-chip--both' },
    ];

    let activeTypeFilter = null;
    const chipEls = chipDefs.map((def) => {
      const chip = document.createElement('button');
      chip.className = `xvm-sc-chip ${def.cls}`;
      chip.textContent = def.label;
      if (def.key === null) chip.classList.add('xvm-sc-chip--active');
      chip.addEventListener('click', () => {
        activeTypeFilter = def.key;
        chipEls.forEach((c) => c.classList.remove('xvm-sc-chip--active'));
        chip.classList.add('xvm-sc-chip--active');
        if (activeRenderer) activeRenderer.setTypeFilter(def.key);
        refreshPeople();
      });
      chipsEl.appendChild(chip);
      return chip;
    });

    const searchWrap = document.createElement('div');
    searchWrap.className = 'xvm-sc-search-wrap';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'xvm-sc-search-icon';
    searchIcon.textContent = '🔍';

    const searchInput = document.createElement('input');
    searchInput.className = 'xvm-sc-search';
    searchInput.setAttribute('type', 'text');
    searchInput.setAttribute('placeholder', tt('contentStarChartSearchPlaceholder'));

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);

    const peopleGrid = document.createElement('div');
    peopleGrid.className = 'xvm-sc-people-grid';

    // Assemble bottom strip: search-row (search + chips) then people grid
    const searchRow = document.createElement('div');
    searchRow.className = 'xvm-sc-bottom-search-row';
    searchRow.appendChild(searchWrap);
    searchRow.appendChild(chipsEl);

    bottomStrip.appendChild(searchRow);
    bottomStrip.appendChild(peopleGrid);

    // River panel (compact card, goes in right column)
    const riverEl = document.createElement('div');
    riverEl.className = 'xvm-sc-river';

    const riverHeaderRow = document.createElement('div');
    riverHeaderRow.className = 'xvm-sc-river-header-row';

    const riverTitle = document.createElement('span');
    riverTitle.className = 'xvm-sc-section-header xvm-sc-section-header--river xvm-sc-river-title';
    riverTitle.textContent = tt('contentStarChartRiverTitle');

    const riverNav = document.createElement('div');
    riverNav.className = 'xvm-sc-river-nav';

    const riverPrev = document.createElement('button');
    riverPrev.className = 'xvm-sc-river-btn';
    riverPrev.setAttribute('aria-label', tt('contentStarChartRiverPrev'));
    riverPrev.textContent = '‹';

    const riverCounter = document.createElement('span');
    riverCounter.className = 'xvm-sc-river-counter';

    const riverNext = document.createElement('button');
    riverNext.className = 'xvm-sc-river-btn';
    riverNext.setAttribute('aria-label', tt('contentStarChartRiverNext'));
    riverNext.textContent = '›';

    riverNav.appendChild(riverPrev);
    riverNav.appendChild(riverCounter);
    riverNav.appendChild(riverNext);

    riverHeaderRow.appendChild(riverTitle);
    riverHeaderRow.appendChild(riverNav);

    const riverContent = document.createElement('div');
    riverContent.className = 'xvm-sc-river-content';

    riverEl.appendChild(riverHeaderRow);
    riverEl.appendChild(riverContent);

    sideRight.appendChild(riverEl);

    body.appendChild(sideLeft);
    body.appendChild(stage);
    body.appendChild(sideRight);
    body.appendChild(bottomStrip);

    frame.appendChild(header);
    frame.appendChild(body);

    root.appendChild(backdrop);
    root.appendChild(frame);

    backdrop.addEventListener('click', closeOverlay);
    document.addEventListener('keydown', escClose);

    // refreshPeople needs to be callable by chips; define it here and also expose
    // it via the returned object so the caller can wire it up after byId is known.
    let _refreshPeople = () => {};
    function refreshPeople() { _refreshPeople(); }

    return {
      root, canvas, progressEl, emptyEl, statsEl, peopleGrid, searchInput,
      riverContent, riverCounter, riverPrev, riverNext, riverEl,
      getActiveTypeFilter: () => activeTypeFilter,
      setRefreshPeople: (fn) => { _refreshPeople = fn; },
    };
  }

  function escClose(ev) {
    if (ev.key === 'Escape') closeOverlay();
  }

  // Background scroll lock: when the overlay is open, the underlying
  // x.com page should not scroll under wheel/touch. We snapshot the
  // current overflow on <html> and <body> before locking, then restore.
  let scrollLockSnapshot = null;
  function lockBackgroundScroll() {
    scrollLockSnapshot = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockBackgroundScroll() {
    if (!scrollLockSnapshot) return;
    document.documentElement.style.overflow = scrollLockSnapshot.htmlOverflow;
    document.body.style.overflow = scrollLockSnapshot.bodyOverflow;
    scrollLockSnapshot = null;
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
    unlockBackgroundScroll();
  }

  // Orbital field rendering adapted from London-Chen/Thank-you-star-chart
  // (MIT License). https://github.com/London-Chen/Thank-you-star-chart
  function createRenderer(canvas, tweetCtx) {
    const ctx = canvas.getContext('2d');
    const stars = [];
    const lookup = new Map();
    let raf = null;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0, cx = 0, cy = 0;
    let zoom = 1, panX = 0, panY = 0;
    let hoverIdx = -1;
    let highlightedId = null;
    let lastCursor = '';
    let mouseX = 0, mouseY = 0;
    let dragging = false, lastX = 0, lastY = 0;
    let nextIndex = 0;
    let typeFilter = null; // null = all; 'retweet'/'quote'/'both' = show fully

    const GLOW_LIMIT = 1500;

    // Nebula blobs — initialized once, drift slowly
    const nebulaBlobs = Array.from({ length: 7 }, (_, i) => ({
      xFrac: 0.12 + i * 0.14,
      yFrac: 0.3 + (i % 3) * 0.16,
      r: 140 + (i % 4) * 38,
      phase: i,
      colorIdx: i % 4,
    }));
    const NEBULA_COLORS = ['#ff6f91', '#64d7ff', '#70e3a2', '#ffd56f'];

    function resize() {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2; cy = h / 2;
    }

    function colorFor(type) {
      if (type === 'quote') return '#64d7ff';
      if (type === 'both')  return '#ff6f91';
      return '#ffd56f';
    }

    function roundRect(c, x, y, rw, rh, rad) {
      c.beginPath();
      c.moveTo(x + rad, y);
      c.arcTo(x + rw, y, x + rw, y + rh, rad);
      c.arcTo(x + rw, y + rh, x, y + rh, rad);
      c.arcTo(x, y + rh, x, y, rad);
      c.arcTo(x, y, x + rw, y, rad);
      c.closePath();
    }

    function addUsers(users, type) {
      // Estimate total count for layer calculation — use current total + incoming
      const count = Math.max(stars.length + users.length, 1);
      for (const u of users) {
        if (lookup.has(u.id)) {
          const s = lookup.get(u.id);
          if (s.type !== type) {
            s.type = 'both';
            s.color = colorFor('both');
          }
          continue;
        }
        const i = nextIndex++;
        const golden = i * 2.399963229728653;
        const layer = Math.sqrt((i + 1) / count);
        const isQuote = type === 'quote';
        const quoteBoost = isQuote ? 0.72 : 1;
        const radius = (120 + layer * 500) * quoteBoost;
        const star = {
          id: u.id,
          screenName: u.screenName,
          name: u.name,
          quoteUrl: u.quoteUrl,
          type,
          color: colorFor(type),
          angle: golden,
          radius,
          speed: 0.00009 + ((i % 17) + 3) * 0.000012,
          phase: (i * 0.37) % (Math.PI * 2),
          size: isQuote ? 3.3 + (i % 4) : 1.8 + (i % 3) * 0.45,
          gardenOffset: ((i % 9) - 4) * 9,
        };
        stars.push(star);
        lookup.set(u.id, star);
      }
    }

    function highlight(id) {
      highlightedId = id;
    }

    function setTypeFilter(type) {
      typeFilter = type;
    }

    function resetView() {
      zoom = 1;
      panX = 0;
      panY = 0;
      highlightedId = null;
    }

    function drawNebula(t) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < nebulaBlobs.length; i++) {
        const b = nebulaBlobs[i];
        const x = w * b.xFrac + Math.sin(t * 0.0002 + b.phase) * 28;
        const y = h * b.yFrac;
        const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        g.addColorStop(0, NEBULA_COLORS[b.colorIdx]);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawOrbitalRings(t) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,213,111,0.12)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        const rx = (120 + ((i - 1) / 4) * 500) * zoom;
        const ry = rx * 0.58;
        ctx.beginPath();
        ctx.ellipse(cx + panX, cy + panY, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function isUrlLike(text) {
      // Returns true if the text is dominated by a URL and should not be word-wrapped
      const t = text.trim();
      if (/^https?:\/\//i.test(t)) return true;
      if (/[^\s]{1,6}:\/\//.test(t.slice(0, 20))) return true;
      if (/^[^\s]*(?:t\.co|x\.com|twitter\.com)\/\S/i.test(t)) return true;
      return false;
    }

    function drawCoreTitle(text, x, y, maxWidth) {
      const value = (text || '').trim();
      if (!value) return;

      // Build wrapped lines using word-aware algorithm
      // CJK characters can break at any boundary; Latin words must not be split
      const lines = [];
      const isCJK = (ch) => /[一-鿿぀-ヿ가-힯]/.test(ch);
      const words = value.split(/(\s+)/); // split preserving whitespace tokens
      let line = '';
      for (const token of words) {
        if (!token) continue;
        const candidate = line ? line + token : token;
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
        } else {
          // Token too wide to fit after current line
          if (line) { lines.push(line); line = ''; }
          if (lines.length >= 2) break;
          // If the token itself is a single "word" wider than maxWidth, break by char
          // (only for CJK or very long tokens)
          let sub = '';
          for (const ch of [...token.trim()]) {
            const next = sub + ch;
            if (ctx.measureText(next).width > maxWidth && sub) {
              lines.push(sub);
              sub = ch;
              if (lines.length >= 2) break;
            } else {
              sub = next;
            }
          }
          if (lines.length < 2) line = sub;
          if (lines.length >= 2) { line = ''; break; }
        }
      }
      if (line && lines.length < 2) lines.push(line);

      // Truncate to max 2 lines; append ellipsis if we cut anything
      const allText = lines.join('');
      const truncated = allText.length < value.replace(/\s+/g, '').length + value.split(/\s+/).length - 1;
      const visible = lines.slice(0, 2);
      if (visible.length === 2 && truncated) {
        let last = visible[1];
        while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
          last = [...last].slice(0, -1).join('');
        }
        visible[1] = last + '…';
      }

      const startY = y - (visible.length - 1) * 7;
      for (let i = 0; i < visible.length; i++) {
        ctx.fillText(visible[i], x, startY + i * 14);
      }
    }

    function drawCore(t) {
      const pulse = 1 + Math.sin(t * 0.002) * 0.06;
      const x = cx + panX, y = cy + panY;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 86 * pulse);
      g.addColorStop(0, 'rgba(255,249,216,1)');
      g.addColorStop(0.22, 'rgba(255,213,111,0.95)');
      g.addColorStop(0.6, 'rgba(255,111,145,0.22)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 86 * pulse, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#17110b';
      ctx.beginPath(); ctx.arc(x, y, 39 * pulse, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#fff7e8';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Center label priority: article title (X long-form) > first chars of
      // tweet text > @handle. URL-only tweets fall back to handle.
      const articleTitle = (tweetCtx.articleTitle || '').trim();
      const rawText = (tweetCtx.text || '').trim();
      const handle = `@${tweetCtx.authorScreenName || ''}`;
      let coreLabel;
      if (articleTitle) {
        coreLabel = articleTitle;
      } else if (rawText && !isUrlLike(rawText)) {
        coreLabel = rawText;
      } else {
        coreLabel = handle;
      }
      drawCoreTitle(coreLabel, x, y, 68);
    }

    function frame(t) {
      ctx.clearRect(0, 0, w, h);

      drawNebula(t);
      drawOrbitalRings(t);

      let nextHover = -1;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        // Use time-based angle (matches original) — no per-frame accumulation
        const angle = s.angle + t * s.speed;
        const sway = Math.sin(t * 0.0005 + s.phase) * 18;
        const x = (cx + panX) + Math.cos(angle) * (s.radius + sway) * zoom;
        const y = (cy + panY) + Math.sin(angle) * (s.radius * 0.58 + s.gardenOffset) * zoom;

        const isHighlighted = (hoverIdx === i) || (highlightedId !== null && s.id === highlightedId);
        const pulse = 0.65 + Math.sin(t * 0.004 + s.phase) * 0.35;
        const baseSize = s.size * (isHighlighted ? 2.6 : 1) * (0.84 + pulse * 0.3);
        const r = baseSize;

        // Dim stars that don't match the active type filter
        const filterMatch = typeFilter === null ||
          s.type === typeFilter ||
          (typeFilter === 'both' && s.type === 'both') ||
          (typeFilter === 'retweet' && (s.type === 'retweet' || s.type === 'both')) ||
          (typeFilter === 'quote' && (s.type === 'quote' || s.type === 'both'));
        const baseAlpha = isHighlighted ? 0.98 : s.type === 'retweet' ? 0.58 : 0.84;
        const alpha = filterMatch ? baseAlpha : 0.08;

        ctx.save();
        ctx.globalAlpha = alpha;
        if (i < GLOW_LIMIT || isHighlighted) {
          ctx.shadowBlur = isHighlighted ? 30 : s.type === 'retweet' ? 9 : 18;
          ctx.shadowColor = s.color;
        }
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const dx = mouseX - x, dy = mouseY - y;
        const hitR = 8 + r * zoom;
        if (dx * dx + dy * dy < hitR * hitR) {
          nextHover = i;
        }
      }

      drawCore(t);

      if (nextHover >= 0) {
        hoverIdx = nextHover;
        const s = stars[hoverIdx];
        const sway = Math.sin(t * 0.0005 + s.phase) * 18;
        const hAngle = s.angle + t * s.speed;
        const sx = (cx + panX) + Math.cos(hAngle) * (s.radius + sway) * zoom;
        const sy = (cy + panY) + Math.sin(hAngle) * (s.radius * 0.58 + s.gardenOffset) * zoom;
        const text = `${s.name} (@${s.screenName})`;
        ctx.font = '700 12px system-ui, sans-serif';
        const tw = Math.min(ctx.measureText(text).width + 18, 220);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeStyle = 'rgba(255,213,111,0.6)';
        ctx.lineWidth = 1;
        roundRect(ctx, sx + 10, sy - 20, tw, 28, 7);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#fff7e8';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text.slice(0, 28), sx + 19, sy - 2);
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
      const url = s.quoteUrl || safeProfileUrl(s.screenName);
      if (!url) return;
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
      highlight,
      setTypeFilter,
      resetView,
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

  async function callGraphQL(op, variables, { method = 'GET' } = {}) {
    const tpl = getTemplate(op);
    if (__XVM_DEBUG) {
      console.log('[starchart] callGraphQL', op, method, {
        hasQueryId: !!tpl.queryId && tpl.queryId !== 'REPLACE_AT_RUNTIME',
        queryIdPreview: tpl.queryId ? tpl.queryId.slice(0, 8) + '...' : null,
        hasAuth: !!tpl.authorization,
        hasFeatures: !!tpl.features,
        variables,
      });
    }
    if (!tpl.queryId || tpl.queryId === 'REPLACE_AT_RUNTIME') {
      throw new Error(`No queryId for ${op}. View a Retweets/Search tab once on x.com to populate cache.`);
    }
    if (!tpl.authorization) {
      throw new Error(`No bearer token captured for ${op}.`);
    }
    const url = new URL(`/i/api/graphql/${tpl.queryId}/${op}`, location.origin);

    let fetchOptions;
    if (method === 'POST') {
      // SearchTimeline only accepts POST. Variables stay in the URL; body
      // carries features + queryId.
      url.searchParams.set('variables', JSON.stringify(variables));
      fetchOptions = {
        method: 'POST',
        credentials: 'include',
        headers: {
          'authorization': tpl.authorization,
          'x-csrf-token': getCsrfToken(),
          'content-type': 'application/json',
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': navigator.language?.split('-')[0] || 'en',
        },
        body: JSON.stringify({
          features: tpl.features ? JSON.parse(tpl.features) : {},
          queryId: tpl.queryId,
        }),
      };
    } else {
      url.searchParams.set('variables', JSON.stringify(variables));
      if (tpl.features) url.searchParams.set('features', tpl.features);
      fetchOptions = {
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
      };
    }

    const res = await fetch(url.toString(), fetchOptions);

    if (__XVM_DEBUG) console.log('[starchart] callGraphQL response', op, res.status, res.statusText);
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

  function timelineEntries(json, pathParts) {
    let node = json;
    for (const part of pathParts) node = node?.[part];
    const instructions = node?.instructions || [];
    return instructions.flatMap((inst) => inst.entries || []);
  }

  function bottomCursor(entries) {
    for (const e of entries) {
      if (e?.content?.cursorType === 'Bottom') return e.content.value;
      if (e?.entryId?.includes('cursor-bottom')) return e?.content?.value;
    }
    return null;
  }

  function parseUser(result) {
    if (!result) return null;
    // X migrated user fields from legacy.* to core.* on some endpoints; read both.
    const screenName = result.core?.screen_name || result.legacy?.screen_name;
    const name = result.core?.name || result.legacy?.name;
    if (!screenName) return null;
    return {
      id: result.rest_id,
      screenName,
      name: name || screenName,
      avatar: result.avatar?.image_url || result.legacy?.profile_image_url_https || '',
    };
  }

  function extractRetweetersFromEntries(entries) {
    const out = [];
    for (const e of entries) {
      const user = parseUser(e?.content?.itemContent?.user_results?.result);
      if (user) out.push(user);
    }
    return out;
  }

  // Recursive scan for quote tweets — checks every tweet_results.result
  // anywhere in the response, then filters to those whose
  // legacy.quoted_status_id_str matches the original tweet.
  function extractQuotersFromJson(json, originalTweetId) {
    const out = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      const tweetResult = value.tweet_results?.result;
      if (tweetResult) {
        const tweet = tweetResult.tweet || tweetResult;
        if (tweet?.legacy?.quoted_status_id_str === originalTweetId) {
          const user = parseUser(tweet.core?.user_results?.result);
          if (user) {
            // Pull quote text: prefer note_tweet long-form, fallback to legacy.full_text
            const quoteText =
              tweet.note_tweet?.note_tweet_results?.result?.text ||
              tweet.legacy?.full_text ||
              '';
            const createdAt = tweet.legacy?.created_at || '';
            out.push({
              ...user,
              quoteUrl: safeStatusUrl(user.screenName, tweet.rest_id || tweet.legacy?.id_str),
              quoteText,
              createdAt,
            });
          }
        }
      }
      if (Array.isArray(value)) {
        for (const v of value) visit(v);
        return;
      }
      for (const v of Object.values(value)) visit(v);
    };
    visit(json);
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
      const variables = {
        tweetId,
        count: PAGE_LIMIT,
        enableRanking: true,
        includePromotedContent: true,
      };
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

      const entries = timelineEntries(resp, ['data', 'retweeters_timeline', 'timeline'])
        .concat(timelineEntries(resp, ['data', 'timeline', 'timeline']));
      const users = extractRetweetersFromEntries(entries).filter((u) => {
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });
      if (users.length) {
        total += users.length;
        onPage(users, 'retweet');
      }

      const nextCursor = bottomCursor(entries);
      if (!nextCursor || nextCursor === cursor || users.length === 0) return { truncated: false };
      cursor = nextCursor;
    }
  }

  async function fetchAllQuotes(tweetId, onPage, opts = {}) {
    const { signal } = opts;
    const seen = new Set();
    let total = 0;
    let truncated = false;
    // Search both Latest and Top to maximize coverage; X returns
    // different result sets per product.
    for (const product of ['Latest', 'Top']) {
      let cursor = null;
      while (true) {
        if (signal?.aborted) return { truncated };
        if (total >= MAX_USERS) { truncated = true; return { truncated }; }
        const variables = {
          rawQuery: tweetId,
          count: 100,
          querySource: 'typed_query',
          product,
        };
        if (cursor) variables.cursor = cursor;

        let resp;
        try {
          resp = await callGraphQL('SearchTimeline', variables, { method: 'POST' });
        } catch (e) {
          if (e.code === 429 && opts.onRateLimit) {
            const seconds = Math.ceil(e.waitMs / 1000);
            opts.onRateLimit(seconds);
            await new Promise((r) => setTimeout(r, e.waitMs));
            continue;
          }
          throw e;
        }

        const all = extractQuotersFromJson(resp, tweetId);
        const users = all.filter((u) => {
          if (seen.has(u.id)) return false;
          seen.add(u.id);
          return true;
        });
        if (users.length) {
          total += users.length;
          onPage(users, 'quote');
        }

        const entries = timelineEntries(resp, ['data', 'search_by_raw_query', 'search_timeline', 'timeline']);
        const nextCursor = bottomCursor(entries);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
    }
    return { truncated };
  }

  // === Side-panel helpers ===

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function badgeLabel(type) {
    if (type === 'retweet') return 'RT';
    if (type === 'quote') return 'Q';
    return 'Both';
  }

  function badgeClass(type) {
    if (type === 'retweet') return 'xvm-sc-badge--rt';
    if (type === 'quote') return 'xvm-sc-badge--qt';
    return 'xvm-sc-badge--both';
  }

  function renderStats(statsEl, byId) {
    let rtCount = 0, qCount = 0;
    let minDate = null, maxDate = null;
    for (const u of byId.values()) {
      if (u.type === 'retweet' || u.type === 'both') rtCount++;
      if (u.type === 'quote' || u.type === 'both') qCount++;
      if (u.createdAt) {
        const d = new Date(u.createdAt);
        if (!isNaN(d.getTime())) {
          if (minDate === null || d < minDate) minDate = d;
          if (maxDate === null || d > maxDate) maxDate = d;
        }
      }
    }
    const supporters = byId.size;

    let spanText = '';
    if (minDate && maxDate) {
      if (minDate.toDateString() === maxDate.toDateString()) {
        spanText = formatDateShort(minDate.toISOString());
      } else {
        spanText = `${formatDateShort(minDate.toISOString())} – ${formatDateShort(maxDate.toISOString())}`;
      }
    }

    statsEl.textContent = '';
    const stats = [
      { count: rtCount, label: tt('contentStarChartStatRetweets'), color: 'gold' },
      { count: qCount, label: tt('contentStarChartStatQuotes'), color: 'cyan' },
      { count: supporters, label: tt('contentStarChartStatSupporters'), color: 'rose' },
      { count: spanText || '—', label: tt('contentStarChartStatSpan'), color: 'muted' },
    ];
    for (const s of stats) {
      const block = document.createElement('div');
      block.className = `xvm-sc-stat-block xvm-sc-stat-block--${s.color}`;
      const num = document.createElement('div');
      num.className = 'xvm-sc-stat-num';
      num.textContent = String(s.count);
      const lbl = document.createElement('div');
      lbl.className = 'xvm-sc-stat-label';
      lbl.textContent = s.label;
      block.appendChild(num);
      block.appendChild(lbl);
      statsEl.appendChild(block);
    }
  }

  function renderPeople(peopleGrid, byId, filterText, onClickUser, typeFilter) {
    peopleGrid.textContent = '';
    const q = filterText.toLowerCase();
    const users = Array.from(byId.values()).filter((u) => {
      // Type filter
      if (typeFilter !== null) {
        const matchType =
          typeFilter === 'retweet' ? (u.type === 'retweet' || u.type === 'both') :
          typeFilter === 'quote'   ? (u.type === 'quote'   || u.type === 'both') :
          typeFilter === 'both'    ? u.type === 'both' : true;
        if (!matchType) return false;
      }
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.screenName.toLowerCase().includes(q) ||
        (u.quoteText || '').toLowerCase().includes(q)
      );
    });

    for (const u of users) {
      const card = document.createElement('div');
      card.className = 'xvm-sc-people-card';

      // Avatar or initial circle
      const avatarEl = document.createElement('div');
      avatarEl.className = 'xvm-sc-avatar';
      if (u.avatar) {
        const img = document.createElement('img');
        img.src = u.avatar;
        img.alt = '';
        img.width = 38;
        img.height = 38;
        img.className = 'xvm-sc-avatar-img';
        // Fallback to initial on error
        img.addEventListener('error', () => {
          img.remove();
          avatarEl.textContent = (u.name || u.screenName || '?')[0].toUpperCase();
        });
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = (u.name || u.screenName || '?')[0].toUpperCase();
      }

      const info = document.createElement('div');
      info.className = 'xvm-sc-person-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'xvm-sc-person-name';
      nameEl.textContent = u.name;

      const handleEl = document.createElement('span');
      handleEl.className = 'xvm-sc-person-handle';
      handleEl.textContent = `@${u.screenName}`;

      info.appendChild(nameEl);
      info.appendChild(handleEl);

      card.appendChild(avatarEl);
      card.appendChild(info);

      card.addEventListener('click', () => onClickUser(u));
      peopleGrid.appendChild(card);
    }
  }

  function setupRiver(riverContent, riverCounter, riverPrev, riverNext, riverEl, byId) {
    let quotes = Array.from(byId.values())
      .filter((u) => u.type === 'quote' || u.type === 'both')
      .sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });

    let currentIdx = 0;
    let autoTimer = null;
    let paused = false;

    function renderQuote() {
      riverContent.textContent = '';
      if (quotes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'xvm-sc-river-empty';
        empty.textContent = tt('contentStarChartRiverEmpty');
        riverContent.appendChild(empty);
        riverCounter.textContent = '0 / 0';
        return;
      }
      const q = quotes[currentIdx];
      riverCounter.textContent = `${currentIdx + 1} / ${quotes.length}`;

      const textEl = document.createElement('div');
      textEl.className = 'xvm-sc-river-text';
      textEl.textContent = q.quoteText || '';

      const authorEl = document.createElement('a');
      authorEl.className = 'xvm-sc-river-author';
      authorEl.textContent = `${q.name} @${q.screenName}`;
      authorEl.href = q.quoteUrl || safeProfileUrl(q.screenName) || '#';
      authorEl.addEventListener('click', (e) => {
        e.preventDefault();
        const url = q.quoteUrl || safeProfileUrl(q.screenName);
        if (url) window.open(url, '_blank', 'noopener');
      });

      const tsEl = document.createElement('div');
      tsEl.className = 'xvm-sc-river-ts';
      tsEl.textContent = formatDateShort(q.createdAt);

      riverContent.appendChild(textEl);
      riverContent.appendChild(authorEl);
      riverContent.appendChild(tsEl);
    }

    function startAuto() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = setInterval(() => {
        if (!paused && quotes.length > 0) {
          currentIdx = (currentIdx + 1) % quotes.length;
          renderQuote();
        }
      }, RIVER_AUTO_ADVANCE_MS);
    }

    function resetAuto() {
      startAuto();
    }

    riverPrev.addEventListener('click', () => {
      if (quotes.length === 0) return;
      currentIdx = (currentIdx - 1 + quotes.length) % quotes.length;
      renderQuote();
      resetAuto();
    });

    riverNext.addEventListener('click', () => {
      if (quotes.length === 0) return;
      currentIdx = (currentIdx + 1) % quotes.length;
      renderQuote();
      resetAuto();
    });

    riverEl.addEventListener('mouseenter', () => { paused = true; });
    riverEl.addEventListener('mouseleave', () => { paused = false; resetAuto(); });

    renderQuote();
    startAuto();

    // Return an update function to refresh quotes when byId changes
    return function updateRiver() {
      const prevLen = quotes.length;
      quotes = Array.from(byId.values())
        .filter((u) => u.type === 'quote' || u.type === 'both')
        .sort((a, b) => {
          const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return db - da;
        });
      // Keep currentIdx in bounds
      if (currentIdx >= quotes.length) currentIdx = Math.max(0, quotes.length - 1);
      renderQuote();
      // Start timer if we now have quotes but didn't before
      if (prevLen === 0 && quotes.length > 0) startAuto();
    };
  }

  async function openStarChart(tweetCtx) {
    if (__XVM_DEBUG) console.log('[starchart] open()', tweetCtx);
    if (openInFlight || activeOverlay) {
      if (__XVM_DEBUG) console.log('[starchart] open() blocked — already in flight or overlay exists');
      return;
    }
    openInFlight = true;
    try {
      if (activeOverlay) closeOverlay();
      await loadTemplatesFromStorage();
      if (__XVM_DEBUG) console.log('[starchart] templates loaded', cachedTemplates);

      const overlayParts = buildOverlay(tweetCtx);
      activeOverlay = overlayParts.root;
      document.body.appendChild(activeOverlay);
      lockBackgroundScroll();

      const {
        canvas, progressEl, emptyEl, statsEl, peopleGrid, searchInput,
        riverContent, riverCounter, riverPrev, riverNext, riverEl,
        getActiveTypeFilter, setRefreshPeople,
      } = overlayParts;

      activeRenderer = createRenderer(canvas, tweetCtx);
      activeAbort = new AbortController();

      // Aggregate users so we can mark dual-role (retweet + quote)
      const byId = new Map();
      let count = 0;
      let searchFilter = '';
      let updateRiver = null;

      function refreshPeople() {
        renderPeople(peopleGrid, byId, searchFilter, (u) => {
          if (activeRenderer) activeRenderer.highlight(u.id);
          const url = safeProfileUrl(u.screenName);
          if (url) window.open(url, '_blank', 'noopener');
        }, getActiveTypeFilter());
      }

      // Allow chips in buildOverlay to trigger refreshPeople
      setRefreshPeople(refreshPeople);

      searchInput.addEventListener('input', () => {
        searchFilter = searchInput.value;
        refreshPeople();
      });

      function addUsers(users, type) {
        for (const u of users) {
          const cur = byId.get(u.id);
          if (cur) {
            cur.type = cur.type === type ? cur.type : 'both';
            // Merge quote fields if newly available
            if (u.quoteText && !cur.quoteText) cur.quoteText = u.quoteText;
            if (u.createdAt && !cur.createdAt) cur.createdAt = u.createdAt;
            if (u.quoteUrl && !cur.quoteUrl) cur.quoteUrl = u.quoteUrl;
          } else {
            byId.set(u.id, { ...u, type });
            count++;
          }
        }
        if (activeRenderer) activeRenderer.addUsers(users, type);
        progressEl.textContent =
          tt('contentStarChartProgress').replace('{{COUNT}}', count.toString());
        renderStats(statsEl, byId);
        refreshPeople();
        if (updateRiver) updateRiver();
      }

      // Initialize river after initial setup; it references byId live
      updateRiver = setupRiver(riverContent, riverCounter, riverPrev, riverNext, riverEl, byId);

      function onRateLimit(seconds) {
        progressEl.textContent =
          tt('contentStarChartRateLimited').replace('{{SECONDS}}', seconds.toString());
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
          tt(doneKey).replace('{{COUNT}}', count.toString());

        // Show empty state if no supporters found
        if (count === 0) {
          emptyEl.classList.remove('xvm-sc-empty--hidden');
        }
      } catch (e) {
        if (activeAbort && e.name !== 'AbortError') {
          activeAbort.abort();
        }
        if (e.name === 'AbortError') return;
        // Log to console so users can inspect stack + cause in DevTools.
        console.error('[starchart] fetch failed', e);
        const reason = e?.message || e?.toString?.() || String(e) || 'unknown';
        progressEl.textContent =
          tt('contentStarChartError').replace('{{REASON}}', reason);
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
