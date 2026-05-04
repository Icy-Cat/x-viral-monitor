// ==UserScript==
// @name         X Viral Monitor Minimal Badge
// @namespace    https://github.com/x-viral-monitor
// @version      0.1.0
// @description  Minimal X velocity badges from GraphQL tweet metrics.
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const GRAPHQL_RE = /\/i\/api\/graphql\//;
  const tweetDataStore = new Map();
  const velocityThresholds = { trending: 1000, viral: 10000 };
  const labels = {
    views: 'Views',
    likes: 'Likes',
    retweets: 'Retweets',
    replies: 'Replies',
    bookmarks: 'Bookmarks',
    velocity: 'Velocity',
    score: 'Score',
    posted: 'Posted',
  };
  const debugWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const debugState = {
    capturedGraphql: 0,
    extractedTweets: 0,
    leaderboardItems: 0,
    hookInstalled: false,
    receivedMessages: 0,
    ignoredMessages: 0,
    lastMessageUrl: '',
    lastIgnoredReason: '',
    lastCapturedAt: 0,
    getTweets: () => Array.from(tweetDataStore.values()),
  };
  window.__xvmTampermonkey = debugState;
  try { debugWindow.__xvmTampermonkey = debugState; } catch (_) {}

  function injectCss() {
    if (document.getElementById('xvm-tm-style')) return;
    const style = document.createElement('style');
    style.id = 'xvm-tm-style';
    style.textContent = `
.xvm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  color: #fff;
  vertical-align: middle;
  cursor: default;
  user-select: none;
}
.xvm-badge::before { content: attr(data-prefix); }
.xvm-badge::after { content: attr(data-velocity) "/h"; }
.xvm-badge--green { background: #16a34a; }
.xvm-badge--orange { background: #ea580c; }
.xvm-badge--red { background: #dc2626; }
.xvm-lb {
  display: none;
  position: fixed;
  right: 16px;
  top: 72px;
  width: 300px;
  max-width: calc(100vw - 32px);
  background: #fffcf6;
  color: #24180f;
  border: 1px solid rgba(86, 60, 34, 0.18);
  border-radius: 14px;
  font-family: "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif;
  box-shadow: 0 10px 28px rgba(36, 24, 15, 0.22), 0 2px 6px rgba(36, 24, 15, 0.08);
  z-index: 2147483646;
  overflow: hidden;
}
.xvm-lb.xvm-lb-dragging {
  box-shadow: 0 16px 36px rgba(36, 24, 15, 0.32), 0 2px 6px rgba(36, 24, 15, 0.12);
  opacity: 0.96;
}
.xvm-lb-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px 6px;
  border-bottom: 1px solid rgba(86, 60, 34, 0.14);
  background: linear-gradient(180deg, rgba(191, 90, 42, 0.06), rgba(191, 90, 42, 0));
  cursor: grab;
  user-select: none;
}
.xvm-lb-head:active,
.xvm-lb.xvm-lb-dragging .xvm-lb-head { cursor: grabbing; }
.xvm-lb-title {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: #6e5b4d;
}
.xvm-lb-count {
  font-size: 10px;
  font-weight: 700;
  color: #9b877a;
  font-variant-numeric: tabular-nums;
}
.xvm-lb-list {
  list-style: none;
  margin: 0;
  padding: 2px 0;
  max-height: 300px;
  overflow-y: auto;
}
.xvm-lb-list::-webkit-scrollbar { width: 5px; }
.xvm-lb-list::-webkit-scrollbar-thumb {
  background: rgba(86, 60, 34, 0.2);
  border-radius: 2px;
}
.xvm-lb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.xvm-lb-item:hover { background: rgba(191, 90, 42, 0.08); }
.xvm-lb-item-selected {
  background: rgba(191, 90, 42, 0.14);
  box-shadow: inset 0 0 0 1.5px #bf5a2a;
  border-radius: 6px;
}
.xvm-lb-rank {
  width: 16px;
  text-align: center;
  color: #9b877a;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.xvm-lb-icon { flex-shrink: 0; }
.xvm-lb-handle {
  flex: 0 1 auto;
  max-width: 110px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #24180f;
  font-weight: 600;
}
.xvm-lb-preview {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #3a2b1f;
  font-size: 11.5px;
}
.xvm-lb-vel {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 800;
  flex-shrink: 0;
}
.xvm-lb-green .xvm-lb-vel { color: #3b8a3f; }
.xvm-lb-orange .xvm-lb-vel { color: #bf5a2a; }
.xvm-lb-red .xvm-lb-vel { color: #c23c1c; }
article[data-testid="tweet"].xvm-article-linked {
  outline: 2px solid #bf5a2a;
  outline-offset: -1px;
  transition: outline-color 0.2s;
}
.xvm-tooltip {
  position: fixed;
  z-index: 2147483647;
  display: none;
  max-width: 260px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(15, 20, 25, 0.96);
  color: #fff;
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  white-space: pre-line;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function installPageHook(targetWindow) {
    const pageWindow = targetWindow || window;
    if (pageWindow.__xvmTampermonkeyPageHook) return;
    pageWindow.__xvmTampermonkeyPageHook = true;
    const GRAPHQL_RE = /\/i\/api\/graphql\//;

    function extractUrl(input) {
      if (pageWindow.Request && input instanceof pageWindow.Request) return input.url;
      if (pageWindow.URL && input instanceof pageWindow.URL) return input.href;
      if (input && typeof input.url === 'string') return input.url;
      if (input && typeof input.href === 'string') return input.href;
      return typeof input === 'string' ? input : '';
    }

    function opNameFromUrl(url) {
      try {
        const path = new pageWindow.URL(url, pageWindow.location.origin).pathname;
        return decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
      } catch (_) {
        return '';
      }
    }

    function postGraphql(url, payload, source) {
      if (!payload || typeof payload !== 'object') return;
      pageWindow.postMessage({
        type: 'XVM_TM_GRAPHQL_RESPONSE',
        url,
        opName: opNameFromUrl(url),
        source,
        payload,
        capturedAt: Date.now(),
      }, '*');
    }

    const originalFetch = pageWindow.fetch;
    pageWindow.fetch = async function (...args) {
      const url = extractUrl(args[0]);
      const response = await originalFetch.apply(this, args);
      if (url && GRAPHQL_RE.test(url)) {
        response.clone().json().then((payload) => postGraphql(url, payload, 'fetch')).catch(() => {});
      }
      return response;
    };

    const xhrOpen = pageWindow.XMLHttpRequest.prototype.open;
    pageWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const urlStr = pageWindow.URL && url instanceof pageWindow.URL ? url.href : (typeof url === 'string' ? url : '');
      this.__xvmTmUrl = urlStr;
      if (urlStr && GRAPHQL_RE.test(urlStr)) {
        this.addEventListener('load', function () {
          try { postGraphql(urlStr, JSON.parse(this.responseText), 'xhr'); } catch (_) {}
        });
      }
      return xhrOpen.call(this, method, url, ...rest);
    };

    try { pageWindow.__xvmTampermonkey.hookInstalled = true; } catch (_) {}
    console.debug('[XVM-TM] page GraphQL hook installed');
  }

  function injectPageHook() {
    try {
      installPageHook(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
    } catch (err) {
      console.debug('[XVM-TM] page GraphQL hook install failed', err);
    }
  }

  function scanForTweets(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    let found = 0;
    if (obj.tweet_results?.result) {
      const data = extractTweetData(obj.tweet_results.result);
      if (data) {
        tweetDataStore.set(data.id, data);
        found += 1;
      }
    }
    if (Array.isArray(obj)) {
      for (const item of obj) found += scanForTweets(item);
    } else {
      for (const key of Object.keys(obj)) {
        if (key === 'tweet_results') continue;
        found += scanForTweets(obj[key]);
      }
    }
    return found;
  }

  function extractTweetData(result) {
    const tweet = result?.tweet || result;
    const legacy = tweet?.legacy;
    if (!legacy) return null;
    const rtResult = legacy.retweeted_status_result?.result;
    if (rtResult) return extractTweetData(rtResult);
    if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

    const viewCount = Number.parseInt(tweet.views?.count, 10);
    if (!viewCount || (tweet.views?.state && tweet.views.state !== 'EnabledWithCount')) return null;
    const id = legacy.id_str || tweet.rest_id || result?.rest_id;
    if (!id) return null;

    const user = tweet.core?.user_results?.result || {};
    const userLegacy = user.legacy || {};
    const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
    return {
      id,
      views: viewCount,
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      bookmarks: legacy.bookmark_count || 0,
      createdAt: legacy.created_at,
      text: noteText || legacy.full_text || '',
      authorName: userLegacy.name || '',
      authorScreenName: userLegacy.screen_name || '',
    };
  }

  function formatVelocity(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v).toString();
  }

  function computeScore(data) {
    const created = new Date(data.createdAt).getTime();
    const hours = Math.max((Date.now() - created) / 3600000, 0.1);
    const velocity = data.views / hours;
    const engagements = data.likes + data.retweets + data.replies;
    const engagementRate = data.views > 0 ? engagements / data.views : 0;
    const rtRatio = data.likes > 0 ? data.retweets / data.likes : 0;
    const bmRatio = data.likes > 0 ? data.bookmarks / data.likes : 0;
    const score = Math.round(
      Math.min(velocity / 50000, 1) * 40
      + Math.min(engagementRate / 0.1, 1) * 25
      + Math.min(rtRatio / 0.5, 1) * 20
      + Math.min(bmRatio / 0.3, 1) * 15
    );
    return { velocity, score: Math.min(score, 100) };
  }

  let tooltipEl = null;
  function getTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'xvm-tooltip';
      tooltipEl.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function getTweetIdFromArticle(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const match = (link.getAttribute('href') || '').match(/\/status\/(\d+)$/);
      if (match && tweetDataStore.has(match[1])) return match[1];
    }
    const firstLink = article.querySelector('a[href*="/status/"]');
    const match = (firstLink?.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  let leaderboardEl = null;
  let selectedLeaderboardId = '';
  let leaderboardHtml = '';
  let leaderboardDragInstalled = false;

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function formatViews(n) {
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function tierForVelocity(velocity) {
    if (velocity >= velocityThresholds.viral) return 'red';
    if (velocity >= velocityThresholds.trending) return 'orange';
    return 'green';
  }

  function iconForTier(tier) {
    if (tier === 'red') return '🔥';
    if (tier === 'orange') return '🚀';
    return '🌱';
  }

  function ensureLeaderboard() {
    if (leaderboardEl) return leaderboardEl;
    leaderboardEl = document.createElement('div');
    leaderboardEl.className = 'xvm-lb';
    leaderboardEl.innerHTML = `
      <div class="xvm-lb-head">
        <span class="xvm-lb-title">🔥 Velocity Monitor</span>
        <span class="xvm-lb-count">0</span>
      </div>
      <ul class="xvm-lb-list"></ul>
    `;
    document.body.appendChild(leaderboardEl);
    installLeaderboardDrag();
    return leaderboardEl;
  }

  function clampLeaderboardToViewport(left, top) {
    const rect = leaderboardEl.getBoundingClientRect();
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)),
    };
  }

  function installLeaderboardDrag() {
    if (!leaderboardEl || leaderboardDragInstalled) return;
    leaderboardDragInstalled = true;
    const head = leaderboardEl.querySelector('.xvm-lb-head');
    if (!head) return;
    let dragState = null;
    let dragRaf = 0;
    let pendingX = 0;
    let pendingY = 0;

    const flush = () => {
      dragRaf = 0;
      if (!dragState) return;
      const pos = clampLeaderboardToViewport(pendingX - dragState.offsetX, pendingY - dragState.offsetY);
      leaderboardEl.style.left = `${pos.left}px`;
      leaderboardEl.style.top = `${pos.top}px`;
      leaderboardEl.style.right = 'auto';
    };

    head.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = leaderboardEl.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      leaderboardEl.classList.add('xvm-lb-dragging');
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!dragState) return;
      pendingX = event.clientX;
      pendingY = event.clientY;
      if (!dragRaf) dragRaf = requestAnimationFrame(flush);
    }, { passive: true });
    window.addEventListener('mouseup', () => {
      if (!dragState) return;
      dragState = null;
      leaderboardEl.classList.remove('xvm-lb-dragging');
      if (dragRaf) {
        cancelAnimationFrame(dragRaf);
        dragRaf = 0;
      }
    });
  }

  function getArticleByTweetId(id) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      if (getTweetIdFromArticle(article) === id) return article;
    }
    return null;
  }

  function collectLeaderboardItems() {
    return Array.from(tweetDataStore.values())
      .map((data) => {
        const { velocity } = computeScore(data);
        return {
          ...data,
          velocity,
          tier: tierForVelocity(velocity),
          article: getArticleByTweetId(data.id),
        };
      })
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 10);
  }

  function openTweetFallback(data) {
    const handle = (data.authorScreenName || '').replace(/^@/, '');
    const path = handle ? `/${handle}/status/${data.id}` : `/i/status/${data.id}`;
    window.location.assign(path);
  }

  function focusLeaderboardTweet(data) {
    document.querySelectorAll('.xvm-lb-item-selected').forEach((el) => el.classList.remove('xvm-lb-item-selected'));
    document.querySelectorAll('article[data-testid="tweet"].xvm-article-linked').forEach((el) => el.classList.remove('xvm-article-linked'));
    selectedLeaderboardId = data.id;

    const article = getArticleByTweetId(data.id);
    if (!article) {
      openTweetFallback(data);
      return;
    }
    article.classList.add('xvm-article-linked');
    article.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const row = leaderboardEl?.querySelector(`[data-id="${data.id}"]`);
    if (row) row.classList.add('xvm-lb-item-selected');
  }

  function renderLeaderboard() {
    if (!document.body) return;
    const items = collectLeaderboardItems();
    debugState.leaderboardItems = items.length;
    const el = ensureLeaderboard();
    const list = el.querySelector('.xvm-lb-list');
    const count = el.querySelector('.xvm-lb-count');
    if (!items.length) {
      el.style.display = 'none';
      list.innerHTML = '';
      count.textContent = '0';
      leaderboardHtml = '';
      return;
    }

    el.style.display = 'block';
    count.textContent = String(items.length);
    const nextHtml = items.map((item, index) => {
      const handle = item.authorScreenName ? `@${item.authorScreenName}` : item.authorName || 'Tweet';
      const text = (item.text || '').replace(/\s+/g, ' ').trim();
      const selected = item.id === selectedLeaderboardId ? ' xvm-lb-item-selected' : '';
      return `
        <li class="xvm-lb-item xvm-lb-${item.tier}${selected}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(text || handle)}">
          <span class="xvm-lb-rank">${index + 1}</span>
          <span class="xvm-lb-icon">${iconForTier(item.tier)}</span>
          <span class="xvm-lb-handle">${escapeHtml(handle)}</span>
          <span class="xvm-lb-preview">${escapeHtml(text)}</span>
          <span class="xvm-lb-vel">${formatVelocity(item.velocity)}/h</span>
        </li>
      `;
    }).join('');
    if (nextHtml === leaderboardHtml) return;

    leaderboardHtml = nextHtml;
    list.innerHTML = nextHtml;
    list.querySelectorAll('.xvm-lb-item').forEach((row) => {
      row.addEventListener('click', () => {
        const item = items.find((candidate) => candidate.id === row.dataset.id);
        if (item) focusLeaderboardTweet(item);
      });
    });
  }

  function renderBadges() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const tweetId = getTweetIdFromArticle(article);
      if (!tweetId || article.hasAttribute('data-xvm-tm-scored')) continue;
      const data = tweetDataStore.get(tweetId);
      if (!data) continue;

      const caretBtn = article.querySelector('[data-testid="caret"]');
      if (!caretBtn) continue;
      let headerRow = caretBtn;
      while (headerRow && headerRow !== article) {
        if (headerRow.getBoundingClientRect().width > 200) break;
        headerRow = headerRow.parentElement;
      }
      if (!headerRow || headerRow === article) continue;

      const { velocity, score } = computeScore(data);
      const tier = velocity >= velocityThresholds.viral ? 'viral' : velocity >= velocityThresholds.trending ? 'trending' : 'normal';
      const badge = document.createElement('span');
      badge.className = `xvm-badge xvm-badge--${tier === 'viral' ? 'red' : tier === 'trending' ? 'orange' : 'green'}`;
      badge.dataset.prefix = tier === 'viral' ? '🔥' : tier === 'trending' ? '🚀' : '🌱';
      badge.dataset.velocity = formatVelocity(velocity);

      const posted = new Date(data.createdAt);
      const tooltipText = [
        `${labels.views}: ${data.views.toLocaleString()}`,
        `${labels.likes}: ${data.likes.toLocaleString()}`,
        `${labels.retweets}: ${data.retweets.toLocaleString()}`,
        `${labels.replies}: ${data.replies.toLocaleString()}`,
        `${labels.bookmarks}: ${data.bookmarks.toLocaleString()}`,
        `${labels.velocity}: ${formatVelocity(velocity)}/h`,
        `${labels.score}: ${score}/100`,
        `${labels.posted}: ${Number.isNaN(posted.getTime()) ? data.createdAt : posted.toLocaleString()}`,
      ].join('\\n');

      badge.addEventListener('mouseenter', () => {
        const tip = getTooltip();
        tip.textContent = tooltipText;
        const rect = badge.getBoundingClientRect();
        tip.style.display = 'block';
        tip.style.top = `${rect.bottom + 6}px`;
        const tipWidth = tip.offsetWidth;
        tip.style.left = `${Math.max(8, rect.right - tipWidth)}px`;
      });
      badge.addEventListener('mouseleave', (e) => {
        const tip = getTooltip();
        if (!tip.contains(e.relatedTarget)) tip.style.display = 'none';
      });

      article.setAttribute('data-xvm-tm-scored', '1');
      headerRow.insertBefore(badge, headerRow.lastElementChild);
    }
  }

  function scheduleRender() {
    if (scheduleRender.raf) return;
    scheduleRender.raf = requestAnimationFrame(() => {
      scheduleRender.raf = 0;
      renderBadges();
      renderLeaderboard();
    });
  }

  const seenGraphqlMessages = new Set();

  function handleGraphqlMessage(event) {
    if (event.data?.type !== 'XVM_TM_GRAPHQL_RESPONSE') return;
    const messageKey = [
      event.data.source || '',
      event.data.url || '',
      event.data.capturedAt || '',
    ].join('|');
    if (seenGraphqlMessages.has(messageKey)) return;
    seenGraphqlMessages.add(messageKey);
    if (seenGraphqlMessages.size > 1000) seenGraphqlMessages.clear();

    debugState.receivedMessages += 1;
    debugState.lastMessageUrl = event.data.url || '';
    if (!GRAPHQL_RE.test(event.data.url || '')) {
      debugState.ignoredMessages += 1;
      debugState.lastIgnoredReason = 'non-graphql-url';
      return;
    }
    debugState.capturedGraphql += 1;
    const found = scanForTweets(event.data.payload);
    if (found) {
      debugState.extractedTweets += found;
      console.debug('[XVM-TM] GraphQL captured', event.data.opName, 'tweets:', found);
      scheduleRender();
    }
    debugState.lastCapturedAt = Date.now();
  }

  window.addEventListener('message', handleGraphqlMessage);
  if (debugWindow !== window && debugWindow.addEventListener) {
    debugWindow.addEventListener('message', handleGraphqlMessage);
  }

  function bootDomObservers() {
    injectCss();
    const observer = new MutationObserver(scheduleRender);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scheduleRender, 2000);
    scheduleRender();
  }

  injectPageHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDomObservers, { once: true });
  } else {
    bootDomObservers();
  }
})();
