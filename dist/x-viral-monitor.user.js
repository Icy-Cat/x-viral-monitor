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
