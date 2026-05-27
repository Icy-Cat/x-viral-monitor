// === Premium feature: X content filter (B plan severity model) ===
//
// MAIN-world module. Reads GraphQL timeline responses through __xvmNet,
// applies local-only rules, and hides matching tweet cells with
// data-xvm-content-filter-hidden. Settings are owned by popup and forwarded
// from isolated.js via XVM_CONTENT_FILTER_SETTINGS_UPDATE.

(() => {
  if (window.__xvmContentFilter) {
    window.__xvmContentFilter.reset();
    return;
  }

  const STORAGE_DEFAULTS = {
    enabled: false,
    level: 'standard',
    customRules: [],
    whitelistHandles: [],
    whitelistDomains: [],
    whitelistFollowing: true,
    blacklistHandles: [],
  };
  const HIDE_ATTR = 'data-xvm-content-filter-hidden';
  const OTHER_HIDE_ATTRS = ['data-xvm-rate-hidden'];
  const LEVEL_THRESHOLDS = {
    light: new Set(['block']),
    standard: new Set(['high', 'block']),
    strict: new Set(['medium', 'high', 'block']),
  };
  const ENDPOINT_MATCHERS = [
    /\/i\/api\/graphql\/[^/]+\/HomeTimeline\b/,
    /\/i\/api\/graphql\/[^/]+\/HomeLatestTimeline\b/,
    /\/i\/api\/graphql\/[^/]+\/ListLatestTweetsTimeline\b/,
    /\/i\/api\/graphql\/[^/]+\/UserTweets\b/,
    /\/i\/api\/graphql\/[^/]+\/UserTweetsAndReplies\b/,
    /\/i\/api\/graphql\/[^/]+\/TweetDetail\b/,
  ];
  const INTERESTING_FIELDS = new Set(['name', 'screen_name', 'bio', 'location', 'content', 'url']);

  let SETTINGS = { ...STORAGE_DEFAULTS };
  let subscribed = false;
  let summaryOpen = false;
  let summarySignature = '';
  let applyScheduled = false;
  const decisions = new Map();
  const hiddenRecords = new Map();
  const source = createLocalRuleSource(window.__xvmContentFilterBuiltinRules);

  function gateOpen() {
    return window.__xvmPro?.isFeatureEnabled('content-filter') === true;
  }

  function createLocalRuleSource(builtin) {
    return {
      type: 'local-json',
      load() {
        const fallback = { levels: { light: [], standard: [], strict: [] }, rules: [] };
        return builtin && typeof builtin === 'object' ? builtin : fallback;
      },
    };
  }

  function normalizeSettings(raw) {
    const out = {
      ...STORAGE_DEFAULTS,
      customRules: [],
      whitelistHandles: [],
      whitelistDomains: [],
      whitelistFollowing: true,
      blacklistHandles: [],
    };
    if (!raw || typeof raw !== 'object') return out;
    out.enabled = raw.enabled === true;
    out.level = ['light', 'standard', 'strict'].includes(raw.level) ? raw.level : STORAGE_DEFAULTS.level;
    out.customRules = Array.isArray(raw.customRules) ? raw.customRules.map(normalizeRule).filter(Boolean) : [];
    out.whitelistHandles = normalizeList(raw.whitelistHandles).map((s) => stripAt(s).toLowerCase()).filter(Boolean);
    out.whitelistDomains = normalizeList(raw.whitelistDomains).map(normalizeHost).filter(Boolean);
    out.whitelistFollowing = raw.whitelistFollowing !== false;
    out.blacklistHandles = normalizeList(raw.blacklistHandles).map((s) => stripAt(s).toLowerCase()).filter(Boolean);
    return out;
  }

  function normalizeList(v) {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') return v.split(/[\n,，\s]+/);
    return [];
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const type = ['keyword', 'regex', 'domain', 'short-symbol'].includes(rule.type) ? rule.type : 'keyword';
    const field = INTERESTING_FIELDS.has(rule.field) ? rule.field : (type === 'domain' ? 'url' : 'content');
    const severity = ['low', 'medium', 'high', 'block'].includes(rule.severity) ? rule.severity : 'medium';
    const value = String(rule.value || '').trim();
    if (!value) return null;
    return {
      id: String(rule.id || `custom-${type}-${field}-${value}`).slice(0, 96),
      type,
      field,
      value,
      severity,
      source: rule.source || 'custom',
    };
  }

  function stripAt(s) {
    return String(s || '').replace(/^@+/, '').trim();
  }

  function normalizeHost(input) {
    const s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    try {
      const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`);
      return u.hostname.replace(/^www\./, '');
    } catch (_) {
      return s.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    }
  }

  function updateSettings(raw) {
    SETTINGS = normalizeSettings(raw);
    reclassifyAll();
    applyHidesNow();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'XVM_CONTENT_FILTER_SETTINGS_UPDATE') {
      updateSettings(event.data.settings);
    }
  });

  function subscribe() {
    if (subscribed) return;
    if (!window.__xvmNet?.onResponse) return;
    subscribed = true;
    for (const re of ENDPOINT_MATCHERS) {
      window.__xvmNet.onResponse(re, async ({ response }) => {
        let data;
        try {
          data = typeof response?.json === 'function' ? await response.json() : response?.json;
        } catch (_) {
          return;
        }
        scanForTweets(data);
        applyHidesNow();
      });
    }
  }

  function scanForTweets(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.tweet_results?.result) {
      const raw = extractTweet(obj.tweet_results.result);
      if (raw?.id) {
        decisions.set(raw.id, { ...classify(raw), raw });
      }
    }
    if (Array.isArray(obj)) {
      for (const item of obj) scanForTweets(item);
      return;
    }
    for (const k of Object.keys(obj)) {
      if (k === 'tweet_results') continue;
      const v = obj[k];
      if (v && typeof v === 'object') scanForTweets(v);
    }
  }

  function scanDomReplies() {
    if (!isTweetDetailPage()) return;
    for (const art of replyArticles()) {
      const id = getTweetIdFromArticle(art);
      if (!id || decisions.has(id)) continue;
      const raw = extractDomTweet(art, id);
      if (raw?.id) decisions.set(raw.id, { ...classify(raw), raw });
    }
  }

  function extractTweet(result) {
    const tweet = result?.tweet || result;
    const legacy = tweet?.legacy;
    if (!legacy) return null;
    const rt = legacy.retweeted_status_result?.result;
    if (rt) return extractTweet(rt);
    const user = tweet.core?.user_results?.result || {};
    const userLegacy = user.legacy || {};
    const urls = extractUrls(legacy, userLegacy);
    return {
      id: legacy.id_str,
      content: legacy.full_text || '',
      createdAt: legacy.created_at || '',
      urls,
      author: {
        id: user.rest_id || userLegacy.id_str || '',
        name: userLegacy.name || user.core?.name || '',
        handle: userLegacy.screen_name || user.core?.screen_name || '',
        bio: userLegacy.description || user.profile_bio?.description || '',
        location: userLegacy.location || user.location?.location || '',
        avatar: user.avatar?.image_url || userLegacy.profile_image_url_https || '',
        following: user.relationship_perspectives?.following === true || userLegacy.following === true,
      },
      possiblySensitive: legacy.possibly_sensitive === true || userLegacy.possibly_sensitive === true,
      promoted: !!tweet.promotedMetadata || !!tweet.promoted_metadata,
    };
  }

  function extractUrls(legacy, userLegacy) {
    const out = [];
    const add = (u) => {
      for (const k of ['expanded_url', 'url', 'display_url']) {
        if (u?.[k]) out.push(String(u[k]));
      }
    };
    for (const u of legacy?.entities?.urls || []) add(u);
    for (const u of legacy?.entities?.media || []) add(u);
    for (const u of userLegacy?.entities?.url?.urls || []) add(u);
    for (const u of userLegacy?.entities?.description?.urls || []) add(u);
    return [...new Set(out)].filter(Boolean);
  }

  function textOf(node) {
    return String(node?.textContent || '').trim();
  }

  function visibleTextOf(node) {
    if (!node) return '';
    const text = textOf(node);
    const alts = Array.from(node.querySelectorAll?.('img[alt]') || [])
      .map((img) => img?.alt || img?.getAttribute?.('alt') || '')
      .filter(Boolean)
      .join('');
    return `${text}${alts}`.trim();
  }

  function extractDomTweet(art, id = getTweetIdFromArticle(art)) {
    if (!art || !id) return null;
    const nameNode = art.querySelector?.('[data-testid="User-Name"]');
    const textNode = art.querySelector?.('[data-testid="tweetText"]');
    const links = Array.from(art.querySelectorAll?.('a[href]') || []);
    const urls = links
      .map((a) => a?.href || a?.getAttribute?.('href') || '')
      .filter((href) => href && !/\/status\/\d+/.test(href));
    const userText = visibleTextOf(nameNode);
    const handle = (userText.match(/@([A-Za-z0-9_]+)/) || [])[1] || '';
    const name = userText.replace(/@[\w_]+.*/s, '').trim();
    return {
      id,
      content: visibleTextOf(textNode),
      createdAt: '',
      urls: [...new Set(urls)],
      author: {
        id: '',
        name,
        handle,
        bio: '',
        location: '',
        avatar: art.querySelector?.('img[src*="profile_images"]')?.src || '',
        following: false,
      },
      possiblySensitive: false,
      promoted: false,
      source: 'dom-fallback',
    };
  }

  function reclassifyAll() {
    for (const [id, d] of decisions) {
      if (d.raw) decisions.set(id, { ...classify(d.raw), raw: d.raw });
    }
  }

  function classify(raw) {
    const matches = [];
    if (isWhitelisted(raw)) return { hide: false, matches, reason: 'whitelist' };
    const handle = stripAt(raw.author?.handle).toLowerCase();
    if (handle && SETTINGS.blacklistHandles.includes(handle)) {
      matches.push({ id: 'hard-blacklist-handle', field: 'screen_name', severity: 'block', label: 'blacklist handle' });
    }
    if (raw.promoted) {
      matches.push({ id: 'hard-promoted', field: 'content', severity: 'block', label: 'promoted' });
    }
    if (telegramFunnel(raw)) {
      matches.push({ id: 'hard-telegram-group-funnel', field: 'url', severity: 'block', label: 'telegram funnel' });
    }
    for (const rule of activeRules()) {
      const m = matchRule(rule, raw);
      if (m) matches.push(m);
    }
    return {
      hide: matches.length > 0,
      matches,
      reason: matches.map((m) => `${m.field}:${m.id}`).join(', '),
    };
  }

  function isWhitelisted(raw) {
    if (SETTINGS.whitelistFollowing && raw.author?.following === true) return true;
    const handle = stripAt(raw.author?.handle).toLowerCase();
    if (handle && SETTINGS.whitelistHandles.includes(handle)) return true;
    const hosts = raw.urls.map(normalizeHost).filter(Boolean);
    return hosts.some((h) => SETTINGS.whitelistDomains.includes(h));
  }

  function telegramFunnel(raw) {
    const text = `${raw.content || ''} ${raw.author?.bio || ''} ${raw.urls.join(' ')}`.toLowerCase();
    return /(t\.me|telegram|电报|飞机)/i.test(text)
      && /(中推|中文推特|群|频道|福利|资源|私信|加|宝宝|点这里|靠谱|选人|教程|同城|线下|上门|约p|约炮|曰泡|join|channel)/i.test(text);
  }

  function activeRules() {
    const builtins = source.load();
    const ids = new Set(builtins.levels?.[SETTINGS.level] || []);
    const threshold = LEVEL_THRESHOLDS[SETTINGS.level] || LEVEL_THRESHOLDS.standard;
    const builtinRules = (builtins.rules || [])
      .map(normalizeRule)
      .filter((rule) => rule && ids.has(rule.id) && threshold.has(rule.severity));
    const customRules = SETTINGS.customRules.filter((rule) => threshold.has(rule.severity) || rule.severity === 'block');
    return [...builtinRules, ...customRules];
  }

  function fieldValue(rule, raw) {
    if (rule.field === 'name') return raw.author?.name || '';
    if (rule.field === 'screen_name') return raw.author?.handle || '';
    if (rule.field === 'bio') return raw.author?.bio || '';
    if (rule.field === 'location') return raw.author?.location || '';
    if (rule.field === 'url') return raw.urls.join('\n');
    return raw.content || '';
  }

  function matchRule(rule, raw) {
    const text = fieldValue(rule, raw);
    if (!text) return null;
    let hit = false;
    if (rule.type === 'keyword') {
      hit = text.toLowerCase().includes(rule.value.toLowerCase());
    } else if (rule.type === 'regex') {
      try { hit = new RegExp(rule.value, 'iu').test(text); } catch (_) { hit = false; }
    } else if (rule.type === 'domain') {
      const want = normalizeHost(rule.value);
      hit = raw.urls.map(normalizeHost).some((h) => h === want || h.endsWith(`.${want}`));
    } else if (rule.type === 'short-symbol') {
      hit = isShortSymbolSpam(text);
    }
    return hit ? { id: rule.id, field: rule.field, severity: rule.severity, label: rule.value } : null;
  }

  function isShortSymbolSpam(text) {
    const s = String(text || '').replace(/\s+/g, '');
    if (!s || s.length > 30) return false;
    if ((s.match(/[\u4e00-\u9fff]/g) || []).length >= 2) return false;
    const alnum = (s.match(/[A-Za-z0-9]/g) || []).length;
    const symbols = (s.match(/[\u0F00-\u0FFF\u2000-\u206F\u2600-\u27BF\uFE00-\uFE0F\u{1F000}-\u{1FAFF}]/gu) || []).length;
    if (symbols >= 3 && symbols >= alnum) return true;
    if (/[A-Za-z]/.test(s) && /\d/.test(s) && symbols >= 1) return true;
    return /^[A-Za-z]{1,2}\d{1,3}[A-Za-z]{1,2}$/u.test(s);
  }

  function cellForArticle(art) {
    return art?.closest?.('[data-testid="cellInnerDiv"]') || art;
  }

  function getTweetIdFromArticle(art) {
    const link = art?.querySelector?.('a[href*="/status/"]');
    const m = link?.getAttribute('href')?.match(/\/status\/(\d+)/);
    return m?.[1] || null;
  }

  function currentStatusId() {
    const m = (window.location?.pathname || '').match(/\/status\/(\d+)/);
    return m?.[1] || null;
  }

  function applyHidesNow() {
    if (!gateOpen() || !SETTINGS.enabled) {
      revoke();
      updateSummary();
      return;
    }
    if (!isTweetDetailPage()) {
      revoke();
      updateSummary();
      return;
    }
    scanDomReplies();
    const arts = replyArticles();
    for (const art of arts) {
      const id = getTweetIdFromArticle(art);
      if (!id) continue;
      const d = decisions.get(id);
      const cell = cellForArticle(art);
      if (d?.hide) {
        if (cell?.style) cell.style.display = 'none';
        setHideMarker(art, cell, d.reason || 'matched');
        const record = recordFromDecision(id, d);
        hiddenRecords.set(id, record);
      } else if (hasContentHideMarker(art, cell)) {
        removeHideMarker(art, cell);
        hiddenRecords.delete(id);
        restoreCellIfNoOtherXvmMarker(art, cell);
      }
    }
    updateSummary();
  }

  function recordFromDecision(id, d) {
    const raw = d.raw || {};
    return {
      id,
      avatar: raw.author?.avatar || '',
      name: raw.author?.name || '',
      handle: raw.author?.handle || '',
      content: raw.content || '',
      matches: d.matches || [],
      ts: Date.now(),
    };
  }

  function hasOtherXvmHideMarker(art, cell = cellForArticle(art)) {
    return OTHER_HIDE_ATTRS.some((attr) => art?.hasAttribute?.(attr) || cell?.hasAttribute?.(attr));
  }

  function hasContentHideMarker(art, cell = cellForArticle(art)) {
    return art?.hasAttribute?.(HIDE_ATTR) || cell?.hasAttribute?.(HIDE_ATTR);
  }

  function setHideMarker(art, cell = cellForArticle(art), reason = 'matched') {
    art?.setAttribute?.(HIDE_ATTR, reason);
    if (cell && cell !== art) cell.setAttribute?.(HIDE_ATTR, reason);
  }

  function removeHideMarker(art, cell = cellForArticle(art)) {
    art?.removeAttribute?.(HIDE_ATTR);
    if (cell && cell !== art) cell.removeAttribute?.(HIDE_ATTR);
  }

  function restoreCellIfNoOtherXvmMarker(art, cell = cellForArticle(art)) {
    if (cell?.style && !hasOtherXvmHideMarker(art, cell)) cell.style.display = '';
  }

  function revoke() {
    const nodes = new Set(document.querySelectorAll(`article[${HIDE_ATTR}], [data-testid="cellInnerDiv"][${HIDE_ATTR}]`));
    nodes.forEach((node) => {
      const isCell = node?.matches?.('[data-testid="cellInnerDiv"]');
      const art = isCell ? node.querySelector?.('article[data-testid="tweet"]') : node;
      const cell = isCell ? node : cellForArticle(art);
      removeHideMarker(art, cell);
      restoreCellIfNoOtherXvmMarker(art, cell);
    });
    hiddenRecords.clear();
    summarySignature = '';
  }

  function ensureStyle() {
    if (document.getElementById('xvm-content-filter-style')) return;
    const style = document.createElement('style');
    style.id = 'xvm-content-filter-style';
    style.textContent = `
      .xvm-cf-summary{margin:8px 0;padding:9px 12px;border:1px solid rgba(251,146,60,.35);border-radius:10px;background:rgba(251,146,60,.10);color:inherit;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
      .xvm-cf-summary strong{font-weight:700}
      .xvm-cf-list{display:none;margin-top:8px;max-height:240px;overflow:auto}
      .xvm-cf-summary[data-open="1"] .xvm-cf-list{display:block}
      .xvm-cf-item{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:7px 0;border-top:1px solid rgba(148,163,184,.25)}
      .xvm-cf-item img{width:28px;height:28px;border-radius:999px}
      .xvm-cf-item b{display:block;font-size:12px}
      .xvm-cf-item p{margin:2px 0;color:inherit;opacity:.84;font-size:12px;line-height:1.35}
      .xvm-cf-tags{opacity:.7;font-size:11px}
    `;
    document.documentElement.appendChild(style);
  }

  function ensureSummaryBar() {
    ensureStyle();
    let bar = document.getElementById('xvm-content-filter-summary');
    if (bar) return bar;
    const anchor = findReplyAnchor();
    if (!anchor?.container) return null;
    bar = document.createElement('div');
    bar.id = 'xvm-content-filter-summary';
    bar.className = 'xvm-cf-summary';
    bar.addEventListener('click', () => {
      summaryOpen = !summaryOpen;
      bar.dataset.open = summaryOpen ? '1' : '0';
      summarySignature = '';
      updateSummary();
    });
    anchor.container.insertBefore(bar, anchor.before || null);
    return bar;
  }

  function isTweetDetailPage() {
    return /\/status\/\d+/.test(window.location?.pathname || '');
  }

  function articleCells() {
    if (!isTweetDetailPage()) return [];
    const cells = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
    return cells
      .map((cell) => ({ cell, art: cell.querySelector?.('article[data-testid="tweet"]') }))
      .filter((item) => item.art);
  }

  function mainArticleIndex(items = articleCells()) {
    const statusId = currentStatusId();
    if (!items.length) return -1;
    if (statusId) {
      const byId = items.findIndex((item) => getTweetIdFromArticle(item.art) === statusId);
      if (byId >= 0) return byId;
    }
    return 0;
  }

  function replyArticles() {
    const items = articleCells();
    const mainIdx = mainArticleIndex(items);
    if (mainIdx < 0) return [];
    const mainId = getTweetIdFromArticle(items[mainIdx].art);
    return items
      .filter((item, idx) => idx > mainIdx && getTweetIdFromArticle(item.art) !== mainId)
      .map((item) => item.art);
  }

  function findReplyAnchor() {
    const items = articleCells();
    const mainIdx = mainArticleIndex(items);
    if (mainIdx < 0) return null;
    const mainCell = items[mainIdx].cell;
    const container = mainCell?.parentElement;
    if (!container) return null;
    const siblings = Array.from(container.children || []);
    const siblingIdx = siblings.indexOf(mainCell);
    const before = mainCell.nextSibling || (siblingIdx >= 0 ? siblings[siblingIdx + 1] : null) || null;
    return { container, before };
  }

  function updateSummary() {
    const bar = ensureSummaryBar();
    if (!bar) return;
    const records = Array.from(hiddenRecords.values()).slice(-30).reverse();
    const hidden = !SETTINGS.enabled || !gateOpen() || records.length === 0;
    const signature = hidden
      ? `hidden:${SETTINGS.enabled}:${gateOpen()}:${records.length}`
      : `visible:${summaryOpen}:${hiddenRecords.size}:${records.map(summaryRecordSignature).join('|')}`;
    if (summarySignature === signature) return;
    summarySignature = signature;
    if (hidden) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.dataset.open = summaryOpen ? '1' : '0';
    const items = records.map((r) => {
      const tags = (r.matches || []).slice(0, 3).map((m) => `${escapeHtml(m.field)}:${escapeHtml(m.severity)}`).join(' / ');
      return `<div class="xvm-cf-item">${r.avatar ? `<img src="${escapeAttr(r.avatar)}" alt="">` : '<span></span>'}<div><b>${escapeHtml(r.name)} ${r.handle ? `@${escapeHtml(r.handle)}` : ''}</b><p>${escapeHtml((r.content || '').slice(0, 120))}</p><span class="xvm-cf-tags">${tags}</span></div></div>`;
    }).join('');
    bar.innerHTML = `<strong>已过滤 ${hiddenRecords.size} 条回复 - XVM</strong><div class="xvm-cf-list">${items}</div>`;
  }

  function summaryRecordSignature(r) {
    const matches = (r.matches || []).slice(0, 3).map((m) => `${m.field}:${m.severity}:${m.id || m.label || ''}`).join(',');
    return `${r.id}:${r.name}:${r.handle}:${(r.content || '').slice(0, 120)}:${matches}`;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function isOwnMutationNode(node) {
    if (!node) return false;
    if (node.id === 'xvm-content-filter-summary' || node.id === 'xvm-content-filter-style') return true;
    return Boolean(node.closest?.('#xvm-content-filter-summary, #xvm-content-filter-style'));
  }

  function isOwnMutation(mutation) {
    if (isOwnMutationNode(mutation?.target)) return true;
    const nodes = [...Array.from(mutation?.addedNodes || []), ...Array.from(mutation?.removedNodes || [])];
    return nodes.length > 0 && nodes.every(isOwnMutationNode);
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    const run = () => {
      applyScheduled = false;
      applyHidesNow();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  const mo = new MutationObserver((mutations) => {
    if (mutations?.length && mutations.every(isOwnMutation)) return;
    scheduleApply();
  });

  function activate() {
    subscribe();
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
    applyHidesNow();
  }

  window.__xvmPro?.onTierChange?.(() => {
    subscribe();
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
    if (!gateOpen()) revoke();
    applyHidesNow();
  });

  window.__xvmContentFilter = {
    updateSettings,
    reset() {
      revoke();
      decisions.clear();
      hiddenRecords.clear();
      summarySignature = '';
      applyScheduled = false;
      subscribed = false;
      try { mo.disconnect(); } catch (_) {}
      delete window.__xvmContentFilter;
    },
    _debug: {
      classify,
      extractTweet,
      activeRules,
      matchRule,
      normalizeSettings,
      createLocalRuleSource,
      scanForTweets,
      applyHidesNow,
      updateSummary,
      isTweetDetailPage,
      replyArticles,
      findReplyAnchor,
      currentStatusId,
      isOwnMutation,
      scheduleApply,
      gateOpen,
    },
  };

  activate();
})();
