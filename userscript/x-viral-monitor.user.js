// ==UserScript==
// @name         X Viral Monitor Minimal Badge
// @namespace    https://github.com/x-viral-monitor
// @version      0.1.5
// @description  Minimal X velocity badges from GraphQL tweet metrics.
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const GRAPHQL_RE = /\/i\/api\/graphql\//;
  const tweetDataStore = new Map();
  const velocityThresholds = { trending: 1000, viral: 10000 };
  const DEFAULT_COLUMNS = [
    { id: 'rank', visible: true },
    { id: 'icon', visible: true },
    { id: 'handle', visible: false },
    { id: 'preview', visible: true },
    { id: 'views', visible: true },
    { id: 'velocity', visible: true },
  ];
  const I18N = {
    en: {
      colRank: 'Rank',
      colIcon: 'Icon',
      colHandle: 'Handle',
      colPreview: 'Preview',
      colViews: 'Views',
      colVelocity: 'Velocity',
      contentViews: 'Views',
      contentLikes: 'Likes',
      contentRetweets: 'Retweets',
      contentReplies: 'Replies',
      contentBookmarks: 'Bookmarks',
      contentVelocity: 'Velocity',
      contentViralScore: 'Viral Score',
      contentPosted: 'Posted',
      contentFallbackTweetLabel: 'Tweet',
      contentLeaderboardTitle: 'Velocity Monitor',
      contentLeaderboardDragToMove: 'Drag to move',
      contentLeaderboardSettings: 'Settings',
      contentLeaderboardBackToPrevious: 'Back to previous position',
      contentLeaderboardTotalViews: 'Total views',
      settingBadgeStyle: 'Badge style',
      settingBadgePillSolid: 'Pill solid',
      settingBadgeInlineClassic: 'Inline classic',
      settingTrending: 'Trending /h',
      settingViral: 'Viral /h',
      settingRows: 'Rows',
      settingColumns: 'Columns',
      settingLeaderboardEnabled: 'Floating leaderboard',
      settingSave: 'Save',
    },
    zh: {
      colRank: '排名',
      colIcon: '等级图标',
      colHandle: '用户名',
      colPreview: '推文预览',
      colViews: '浏览量',
      colVelocity: '流速',
      contentViews: '浏览量',
      contentLikes: '点赞',
      contentRetweets: '转发',
      contentReplies: '回复',
      contentBookmarks: '收藏',
      contentVelocity: '流速',
      contentViralScore: '爆帖指数',
      contentPosted: '发布时间',
      contentFallbackTweetLabel: '推文',
      contentLeaderboardTitle: '本页热点',
      contentLeaderboardDragToMove: '拖动以移动',
      contentLeaderboardSettings: '设置',
      contentLeaderboardBackToPrevious: '返回之前的滚动位置',
      contentLeaderboardTotalViews: '总浏览量',
      settingBadgeStyle: '徽章样式',
      settingBadgePillSolid: '胶囊实底',
      settingBadgeInlineClassic: '经典行内',
      settingTrending: '蹿升阈值 /h',
      settingViral: '爆款阈值 /h',
      settingRows: '显示行数',
      settingColumns: '显示字段',
      settingLeaderboardEnabled: '悬浮榜',
      settingSave: '保存',
    },
    ja: {
      colRank: '順位',
      colIcon: 'ティアアイコン',
      colHandle: 'ユーザー名',
      colPreview: '投稿プレビュー',
      colViews: '表示回数',
      colVelocity: '流速',
      contentViews: '表示回数',
      contentLikes: 'いいね',
      contentRetweets: 'リポスト',
      contentReplies: '返信',
      contentBookmarks: 'ブックマーク',
      contentVelocity: '流速',
      contentViralScore: 'バズ指数',
      contentPosted: '投稿日時',
      contentFallbackTweetLabel: '投稿',
      contentLeaderboardTitle: 'このページの注目投稿',
      contentLeaderboardDragToMove: 'ドラッグして移動',
      contentLeaderboardSettings: '設定',
      contentLeaderboardBackToPrevious: '前のスクロール位置に戻る',
      contentLeaderboardTotalViews: '総表示回数',
      settingBadgeStyle: 'バッジスタイル',
      settingBadgePillSolid: 'ソリッドピル',
      settingBadgeInlineClassic: 'クラシックインライン',
      settingTrending: '上昇中のしきい値 /h',
      settingViral: 'バズのしきい値 /h',
      settingRows: '表示件数',
      settingColumns: '表示項目',
      settingLeaderboardEnabled: 'フローティングリーダーボード',
      settingSave: '保存',
    },
  };

  function detectLanguage() {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'en'];
    for (const lang of candidates) {
      const normalized = String(lang || '').toLowerCase();
      if (normalized.startsWith('zh')) return 'zh';
      if (normalized.startsWith('ja')) return 'ja';
      if (normalized.startsWith('en')) return 'en';
    }
    return 'en';
  }

  const currentLanguage = detectLanguage();
  const currentLocale = currentLanguage === 'zh' ? 'zh-CN' : currentLanguage === 'ja' ? 'ja-JP' : 'en-US';

  function t(key) {
    return I18N[currentLanguage]?.[key] || I18N.en[key] || key;
  }

  const COLUMN_LABELS = {
    rank: 'colRank',
    icon: 'colIcon',
    handle: 'colHandle',
    preview: 'colPreview',
    views: 'colViews',
    velocity: 'colVelocity',
  };
  const KNOWN_COLUMN_IDS = DEFAULT_COLUMNS.map((column) => column.id);
  const settings = loadSettings();
  velocityThresholds.trending = settings.trending;
  velocityThresholds.viral = Math.max(settings.viral, settings.trending + 1);
  const debugWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const debugState = {
    language: currentLanguage,
    locale: currentLocale,
    capturedGraphql: 0,
    extractedTweets: 0,
    leaderboardItems: 0,
    settings,
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

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem('xvmTampermonkeySettings') || '{}');
      const trending = Number.parseInt(parsed.trending, 10);
      const viral = Number.parseInt(parsed.viral, 10);
      const leaderboardCount = Number.parseInt(parsed.leaderboardCount, 10);
      const leaderboardWidth = Number.parseInt(parsed.leaderboardWidth, 10);
      const leaderboardHeight = Number.parseInt(parsed.leaderboardHeight, 10);
      const pos = parsed.leaderboardPos;
      return {
        trending: Number.isFinite(trending) && trending > 0 ? trending : 1000,
        viral: Number.isFinite(viral) && viral > 0 ? viral : 10000,
        leaderboardEnabled: parsed.leaderboardEnabled !== false,
        leaderboardCount: Number.isFinite(leaderboardCount) ? Math.max(1, Math.min(50, leaderboardCount)) : 10,
        leaderboardWidth: Number.isFinite(leaderboardWidth) ? Math.max(240, Math.min(640, leaderboardWidth)) : 280,
        leaderboardHeight: Number.isFinite(leaderboardHeight) ? Math.max(120, Math.min(800, leaderboardHeight)) : 300,
        leaderboardPos: pos && Number.isFinite(pos.left) && Number.isFinite(pos.top) ? { left: pos.left, top: pos.top } : null,
        leaderboardColumns: normalizeColumns(parsed.leaderboardColumns),
        badgeStyle: parsed.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid',
      };
    } catch (_) {
      return { trending: 1000, viral: 10000, leaderboardEnabled: true, leaderboardCount: 10, leaderboardWidth: 280, leaderboardHeight: 300, leaderboardPos: null, leaderboardColumns: normalizeColumns(null), badgeStyle: 'pill-solid' };
    }
  }

  function normalizeColumns(raw) {
    if (!Array.isArray(raw)) return DEFAULT_COLUMNS.map((column) => ({ ...column }));
    const seen = new Set();
    const out = [];
    for (const column of raw) {
      if (!column || typeof column.id !== 'string' || !KNOWN_COLUMN_IDS.includes(column.id)) continue;
      if (seen.has(column.id)) continue;
      seen.add(column.id);
      out.push({ id: column.id, visible: !!column.visible });
    }
    for (const column of DEFAULT_COLUMNS) {
      if (!seen.has(column.id)) out.push({ ...column });
    }
    return out;
  }

  function saveSettings() {
    localStorage.setItem('xvmTampermonkeySettings', JSON.stringify(settings));
  }

  function applySettings() {
    velocityThresholds.trending = settings.trending;
    velocityThresholds.viral = Math.max(settings.viral, settings.trending + 1);
    document.documentElement.dataset.xvmBadgeStyle = settings.badgeStyle;
    document.querySelectorAll('article[data-xvm-tm-scored]').forEach((article) => article.removeAttribute('data-xvm-tm-scored'));
    document.querySelectorAll('.xvm-badge').forEach((badge) => badge.remove());
    leaderboardHtml = '';
    if (!settings.leaderboardEnabled) hideLeaderboard();
    scheduleRender();
  }

  function injectCss() {
    document.documentElement.dataset.xvmBadgeStyle = settings.badgeStyle;
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
.xvm-badge--green { color: #15803d; background: rgba(22, 163, 74, 0.25); }
.xvm-badge--orange { color: #c2410c; background: rgba(234, 88, 12, 0.25); }
.xvm-badge--red { color: #b91c1c; background: rgba(220, 38, 38, 0.25); }
html[data-xvm-badge-style="inline-classic"] .xvm-badge {
  gap: 0;
  margin-left: 0;
  margin-right: 4px;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: rgb(83, 100, 113);
  background: transparent;
  white-space: nowrap;
  transition: color 0.2s;
}
html[data-xvm-badge-style="inline-classic"] .xvm-badge::before {
  content: attr(data-prefix) " " attr(data-velocity) "/h";
}
html[data-xvm-badge-style="inline-classic"] .xvm-badge::after { content: ""; }
html[data-xvm-badge-style="inline-classic"] .xvm-badge:hover { color: rgb(29, 155, 240); }
html[data-xvm-badge-style="inline-classic"] .xvm-badge--green { color: #4caf50; background: transparent; }
html[data-xvm-badge-style="inline-classic"] .xvm-badge--orange { color: #ff9800; background: transparent; }
html[data-xvm-badge-style="inline-classic"] .xvm-badge--red { color: #f44336; background: transparent; }
.xvm-lb {
  display: none;
  position: fixed;
  right: 16px;
  top: 72px;
  width: 280px;
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
.xvm-lb.xvm-lb-resizing {
  box-shadow: 0 16px 36px rgba(36, 24, 15, 0.32), 0 2px 6px rgba(36, 24, 15, 0.12);
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
.xvm-lb-grip {
  font-size: 10px;
  color: #9b877a;
  letter-spacing: -1px;
}
.xvm-lb-title {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: #6e5b4d;
}
.xvm-lb-settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #9b877a;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background 0.12s, color 0.12s;
}
.xvm-lb-settings-btn:hover {
  background: rgba(191, 90, 42, 0.14);
  color: #8f3d17;
}
.xvm-lb-count {
  font-size: 10px;
  font-weight: 700;
  color: #9b877a;
  font-variant-numeric: tabular-nums;
}
.xvm-lb-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #bf5a2a;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.xvm-lb-back:hover {
  background: rgba(191, 90, 42, 0.14);
  color: #8f3d17;
}
.xvm-lb-back[hidden] { display: none; }
.xvm-lb-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 12px;
  height: 100%;
  cursor: ew-resize;
}
.xvm-lb-resize::before {
  content: "";
  position: absolute;
  top: 50%;
  right: 3px;
  width: 3px;
  height: 28px;
  border-radius: 999px;
  background: rgba(110, 91, 77, 0.22);
  transform: translateY(-50%);
  transition: background 0.12s;
}
.xvm-lb:hover .xvm-lb-resize::before,
.xvm-lb.xvm-lb-resizing .xvm-lb-resize::before {
  background: rgba(191, 90, 42, 0.35);
}
.xvm-lb-resize-v {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 12px;
  cursor: ns-resize;
}
.xvm-lb-resize-v::before {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 28px;
  height: 3px;
  border-radius: 999px;
  background: rgba(110, 91, 77, 0.22);
  transform: translateX(-50%);
  transition: background 0.12s;
}
.xvm-lb:hover .xvm-lb-resize-v::before,
.xvm-lb.xvm-lb-resizing .xvm-lb-resize-v::before {
  background: rgba(191, 90, 42, 0.35);
}
.xvm-settings {
  display: none;
  padding: 9px 10px 10px;
  border-bottom: 1px solid rgba(86, 60, 34, 0.14);
  background: rgba(255, 248, 241, 0.92);
}
.xvm-settings.xvm-settings-open { display: grid; gap: 8px; }
.xvm-setting-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #6e5b4d;
}
.xvm-setting-row input,
.xvm-setting-row select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid rgba(86, 60, 34, 0.22);
  border-radius: 6px;
  padding: 4px 6px;
  background: #fff;
  color: #24180f;
  font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.xvm-setting-row input[type="checkbox"] {
  width: auto;
  min-width: 0;
  justify-self: start;
}
.xvm-setting-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 8px;
}
.xvm-setting-col {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 11px;
  color: #6e5b4d;
}
.xvm-setting-col input {
  width: auto;
  min-width: 0;
  margin: 0;
}
.xvm-settings-actions {
  display: flex;
  justify-content: flex-end;
}
.xvm-settings-save {
  border: none;
  border-radius: 6px;
  padding: 5px 9px;
  background: #bf5a2a;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
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
  height: 28px;
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
.xvm-lb-item-selected:hover { background: rgba(191, 90, 42, 0.18); }
.xvm-lb-rank {
  width: 14px;
  text-align: center;
  color: #9b877a;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 600;
}
.xvm-lb-icon { flex-shrink: 0; }
.xvm-lb-handle {
  flex: 0 0 auto;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #24180f;
  font-weight: 500;
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
.xvm-lb-views {
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: #6e5b4d;
  flex-shrink: 0;
}
.xvm-lb-vel {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.xvm-lb-green .xvm-lb-vel { color: #3b8a3f; }
.xvm-lb-orange .xvm-lb-vel { color: #bf5a2a; }
.xvm-lb-red .xvm-lb-vel { color: #c23c1c; }
article[data-testid="tweet"].xvm-article-linked {
  outline: 2px solid #bf5a2a;
  outline-offset: -1px;
  border-radius: 12px;
  transition: outline-color 0.18s;
}
.xvm-lb-link-path {
  stroke: #bf5a2a;
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 2px 4px rgba(191, 90, 42, 0.35));
}
.xvm-lb-link-dot {
  fill: #fff8f1;
  stroke: #bf5a2a;
  stroke-width: 2;
  filter: drop-shadow(0 1px 3px rgba(191, 90, 42, 0.4));
}
.xvm-lb-link-start { animation: xvm-lb-pulse 1.8s ease-in-out infinite; }
@keyframes xvm-lb-pulse {
  0%, 100% { r: 5; }
  50% { r: 7; }
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

  function getAuthorInfo(article) {
    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    let displayName = '';
    let handle = '';
    if (nameBlock) {
      const spans = nameBlock.querySelectorAll('span');
      for (const span of spans) {
        const text = (span.textContent || '').trim();
        if (!handle && text.startsWith('@')) handle = text;
        else if (!displayName && text && !text.startsWith('@') && text !== '·') displayName = text;
        if (displayName && handle) break;
      }
    }
    return { displayName, handle };
  }

  let leaderboardEl = null;
  let selectedLeaderboardId = '';
  let leaderboardHtml = '';
  let leaderboardDragInstalled = false;
  let leaderboardResizeInstalled = false;
  let leaderboardResizeHeightInstalled = false;
  let savedScrollY = null;
  let linkState = null;
  let linkUpdateRaf = 0;
  let linkFollowRaf = 0;
  let leaderboardListClickInstalled = false;
  let lbScrollTick = false;
  const SVG_NS = 'http://www.w3.org/2000/svg';

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

  function formatPostedDate(date, fallback) {
    if (Number.isNaN(date.getTime())) return fallback || '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

  const leaderboardColumnRenderers = {
    rank: (_item, index) => `<span class="xvm-lb-rank">${index + 1}</span>`,
    icon: (item) => `<span class="xvm-lb-icon">${iconForTier(item.tier)}</span>`,
    handle: (item) => {
      const handle = (item.handle || '').trim() || item.authorName || t('contentFallbackTweetLabel');
      return `<span class="xvm-lb-handle" title="${escapeHtml(handle)}">${escapeHtml(handle)}</span>`;
    },
    preview: (item) => {
      const text = (item.text || '').replace(/\s+/g, ' ').trim();
      return `<span class="xvm-lb-preview" title="${escapeHtml(text.slice(0, 280))}">${escapeHtml(text)}</span>`;
    },
    views: (item) => `<span class="xvm-lb-views" title="${escapeHtml(t('contentLeaderboardTotalViews'))}">👁 ${formatViews(item.views)}</span>`,
    velocity: (item) => `<span class="xvm-lb-vel">${formatVelocity(item.velocity)}/h</span>`,
  };

  function ensureLeaderboard() {
    if (leaderboardEl) return leaderboardEl;
    leaderboardEl = document.createElement('div');
    leaderboardEl.className = 'xvm-lb';
    leaderboardEl.innerHTML = `
      <div class="xvm-lb-head" title="${escapeHtml(t('contentLeaderboardDragToMove'))}">
        <span class="xvm-lb-grip">⋮⋮</span>
        <span class="xvm-lb-title">🔥 ${escapeHtml(t('contentLeaderboardTitle'))}</span>
        <button class="xvm-lb-settings-btn" type="button" title="${escapeHtml(t('contentLeaderboardSettings'))}" aria-label="${escapeHtml(t('contentLeaderboardSettings'))}">⚙</button>
        <span class="xvm-lb-count">0</span>
        <button class="xvm-lb-back" type="button" title="${escapeHtml(t('contentLeaderboardBackToPrevious'))}" aria-label="${escapeHtml(t('contentLeaderboardBackToPrevious'))}" hidden>
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 16 L12.5 16 Q16 16 16 12.5 L16 8.5 Q16 5 12.5 5 L5 5"></path>
            <path d="M8 2 L5 5 L8 8"></path>
          </svg>
        </button>
      </div>
      <div class="xvm-settings">
        <label class="xvm-setting-row">
          <span>${escapeHtml(t('settingLeaderboardEnabled'))}</span>
          <input class="xvm-setting-enabled" type="checkbox">
        </label>
        <label class="xvm-setting-row">
          <span>${escapeHtml(t('settingBadgeStyle'))}</span>
          <select class="xvm-setting-badge-style">
            <option value="pill-solid">${escapeHtml(t('settingBadgePillSolid'))}</option>
            <option value="inline-classic">${escapeHtml(t('settingBadgeInlineClassic'))}</option>
          </select>
        </label>
        <label class="xvm-setting-row">
          <span>${escapeHtml(t('settingTrending'))}</span>
          <input class="xvm-setting-trending" type="number" min="1" step="1">
        </label>
        <label class="xvm-setting-row">
          <span>${escapeHtml(t('settingViral'))}</span>
          <input class="xvm-setting-viral" type="number" min="2" step="1">
        </label>
        <label class="xvm-setting-row">
          <span>${escapeHtml(t('settingRows'))}</span>
          <input class="xvm-setting-count" type="number" min="1" max="50" step="1">
        </label>
        <div class="xvm-setting-row">
          <span>${escapeHtml(t('settingColumns'))}</span>
          <div class="xvm-setting-columns"></div>
        </div>
        <div class="xvm-settings-actions">
          <button class="xvm-settings-save" type="button">${escapeHtml(t('settingSave'))}</button>
        </div>
      </div>
      <ul class="xvm-lb-list"></ul>
      <div class="xvm-lb-resize" aria-hidden="true"></div>
      <div class="xvm-lb-resize-v" aria-hidden="true"></div>
    `;
    document.body.appendChild(leaderboardEl);
    applyLeaderboardWidth();
    applyLeaderboardHeight();
    applyLeaderboardPosition();
    installLeaderboardDrag();
    installLeaderboardResize();
    installLeaderboardResizeHeight();
    installLeaderboardBackButton();
    installSettingsPanel();
    return leaderboardEl;
  }

  function syncSettingsForm() {
    if (!leaderboardEl) return;
    const enabled = leaderboardEl.querySelector('.xvm-setting-enabled');
    const badgeStyle = leaderboardEl.querySelector('.xvm-setting-badge-style');
    const trending = leaderboardEl.querySelector('.xvm-setting-trending');
    const viral = leaderboardEl.querySelector('.xvm-setting-viral');
    const count = leaderboardEl.querySelector('.xvm-setting-count');
    if (enabled) enabled.checked = settings.leaderboardEnabled !== false;
    if (badgeStyle) badgeStyle.value = settings.badgeStyle;
    if (trending) trending.value = String(settings.trending);
    if (viral) viral.value = String(settings.viral);
    if (count) count.value = String(settings.leaderboardCount);
    renderColumnSettings();
  }

  function renderColumnSettings() {
    const root = leaderboardEl?.querySelector('.xvm-setting-columns');
    if (!root) return;
    root.innerHTML = settings.leaderboardColumns.map((column) => `
      <label class="xvm-setting-col">
        <input type="checkbox" data-column-id="${escapeHtml(column.id)}" ${column.visible ? 'checked' : ''}>
        <span>${escapeHtml(t(COLUMN_LABELS[column.id]) || column.id)}</span>
      </label>
    `).join('');
  }

  function installSettingsPanel() {
    const btn = leaderboardEl?.querySelector('.xvm-lb-settings-btn');
    const panel = leaderboardEl?.querySelector('.xvm-settings');
    const save = leaderboardEl?.querySelector('.xvm-settings-save');
    if (!btn || !panel || !save) return;
    syncSettingsForm();
    btn.addEventListener('mousedown', (event) => event.stopPropagation());
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      panel.classList.toggle('xvm-settings-open');
      syncSettingsForm();
    });
    panel.addEventListener('mousedown', (event) => event.stopPropagation());
    panel.addEventListener('click', (event) => event.stopPropagation());
    save.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextTrending = Number.parseInt(leaderboardEl.querySelector('.xvm-setting-trending')?.value, 10);
      const nextViral = Number.parseInt(leaderboardEl.querySelector('.xvm-setting-viral')?.value, 10);
      const nextCount = Number.parseInt(leaderboardEl.querySelector('.xvm-setting-count')?.value, 10);
      const nextStyle = leaderboardEl.querySelector('.xvm-setting-badge-style')?.value;
      const nextEnabled = leaderboardEl.querySelector('.xvm-setting-enabled')?.checked;
      const nextColumns = settings.leaderboardColumns.map((column) => {
        const checkbox = leaderboardEl.querySelector(`.xvm-setting-columns input[data-column-id="${column.id}"]`);
        return { id: column.id, visible: checkbox ? checkbox.checked : column.visible };
      });
      settings.trending = Number.isFinite(nextTrending) && nextTrending > 0 ? nextTrending : 1000;
      settings.viral = Number.isFinite(nextViral) && nextViral > settings.trending ? nextViral : Math.max(10000, settings.trending + 1);
      settings.leaderboardCount = Number.isFinite(nextCount) ? Math.max(1, Math.min(50, nextCount)) : 10;
      settings.leaderboardColumns = normalizeColumns(nextColumns);
      settings.badgeStyle = nextStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid';
      settings.leaderboardEnabled = nextEnabled !== false;
      saveSettings();
      applySettings();
      syncSettingsForm();
      panel.classList.remove('xvm-settings-open');
    });
  }

  function setBackButtonVisible(visible) {
    const btn = leaderboardEl?.querySelector('.xvm-lb-back');
    if (!btn) return;
    if (visible) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  function installLeaderboardBackButton() {
    const btn = leaderboardEl?.querySelector('.xvm-lb-back');
    if (!btn) return;
    btn.addEventListener('mousedown', (event) => event.stopPropagation());
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (savedScrollY === null) return;
      const target = savedScrollY;
      clearLink();
      window.scrollTo({ top: target, behavior: 'smooth' });
      savedScrollY = null;
      setBackButtonVisible(false);
    });
  }

  function clampLeaderboardWidth(width) {
    const safeWidth = Number.isFinite(width) ? width : 280;
    const maxByViewport = Math.max(240, Math.min(640, window.innerWidth - 16));
    const left = settings.leaderboardPos?.left;
    const maxByPosition = Number.isFinite(left)
      ? Math.max(240, Math.min(maxByViewport, window.innerWidth - left - 8))
      : maxByViewport;
    return Math.max(240, Math.min(safeWidth, maxByPosition));
  }

  function applyLeaderboardWidth() {
    if (!leaderboardEl) return;
    settings.leaderboardWidth = clampLeaderboardWidth(settings.leaderboardWidth);
    leaderboardEl.style.width = `${settings.leaderboardWidth}px`;
  }

  function clampLeaderboardHeight(height) {
    const safeHeight = Number.isFinite(height) ? height : 300;
    const maxByViewport = Math.max(120, Math.min(800, window.innerHeight - 80));
    const top = settings.leaderboardPos?.top;
    const maxByPosition = Number.isFinite(top)
      ? Math.max(120, Math.min(maxByViewport, window.innerHeight - top - 16))
      : maxByViewport;
    return Math.max(120, Math.min(safeHeight, maxByPosition));
  }

  function applyLeaderboardHeight() {
    if (!leaderboardEl) return;
    settings.leaderboardHeight = clampLeaderboardHeight(settings.leaderboardHeight);
    const list = leaderboardEl.querySelector('.xvm-lb-list');
    if (list) list.style.maxHeight = `${settings.leaderboardHeight}px`;
  }

  function applyLeaderboardPosition() {
    if (!leaderboardEl) return;
    applyLeaderboardWidth();
    applyLeaderboardHeight();
    const pos = settings.leaderboardPos;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      const clamped = clampLeaderboardToViewport(pos.left, pos.top);
      settings.leaderboardPos = clamped;
      leaderboardEl.style.left = `${clamped.left}px`;
      leaderboardEl.style.top = `${clamped.top}px`;
      leaderboardEl.style.right = 'auto';
    }
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
      settings.leaderboardPos = pos;
      updateLinkGeometry();
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
      saveSettings();
      updateLinkGeometry();
    });
  }

  function installLeaderboardResize() {
    if (!leaderboardEl || leaderboardResizeInstalled) return;
    leaderboardResizeInstalled = true;
    const handle = leaderboardEl.querySelector('.xvm-lb-resize');
    if (!handle) return;
    let resizeState = null;
    let resizeRaf = 0;
    let pendingX = 0;

    const flush = () => {
      resizeRaf = 0;
      if (!resizeState) return;
      settings.leaderboardWidth = clampLeaderboardWidth(resizeState.startWidth + (pendingX - resizeState.startX));
      applyLeaderboardWidth();
      applyLeaderboardPosition();
      updateLinkGeometry();
    };

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      resizeState = {
        startWidth: leaderboardEl.getBoundingClientRect().width,
        startX: event.clientX,
      };
      leaderboardEl.classList.add('xvm-lb-resizing');
      event.stopPropagation();
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!resizeState) return;
      pendingX = event.clientX;
      if (!resizeRaf) resizeRaf = requestAnimationFrame(flush);
    }, { passive: true });
    window.addEventListener('mouseup', () => {
      if (!resizeState) return;
      resizeState = null;
      leaderboardEl.classList.remove('xvm-lb-resizing');
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      saveSettings();
      updateLinkGeometry();
    });
  }

  function installLeaderboardResizeHeight() {
    if (!leaderboardEl || leaderboardResizeHeightInstalled) return;
    leaderboardResizeHeightInstalled = true;
    const handle = leaderboardEl.querySelector('.xvm-lb-resize-v');
    if (!handle) return;
    let resizeState = null;
    let resizeRaf = 0;
    let pendingY = 0;

    const flush = () => {
      resizeRaf = 0;
      if (!resizeState) return;
      settings.leaderboardHeight = clampLeaderboardHeight(resizeState.startHeight + (pendingY - resizeState.startY));
      applyLeaderboardHeight();
      updateLinkGeometry();
    };

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const list = leaderboardEl.querySelector('.xvm-lb-list');
      resizeState = {
        startHeight: list ? list.getBoundingClientRect().height : settings.leaderboardHeight,
        startY: event.clientY,
      };
      leaderboardEl.classList.add('xvm-lb-resizing');
      event.stopPropagation();
      event.preventDefault();
    });
    window.addEventListener('mousemove', (event) => {
      if (!resizeState) return;
      pendingY = event.clientY;
      if (!resizeRaf) resizeRaf = requestAnimationFrame(flush);
    }, { passive: true });
    window.addEventListener('mouseup', () => {
      if (!resizeState) return;
      resizeState = null;
      leaderboardEl.classList.remove('xvm-lb-resizing');
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = 0;
      }
      saveSettings();
      updateLinkGeometry();
    });
  }

  function getArticleByTweetId(id) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      if (getTweetIdFromArticle(article) === id) return article;
    }
    return null;
  }

  function getLeaderboardItemById(id) {
    const article = getArticleByTweetId(id);
    const data = tweetDataStore.get(id);
    if (!article || !data) return null;
    const { velocity } = computeScore(data);
    const { displayName, handle: domHandle } = getAuthorInfo(article);
    return {
      ...data,
      velocity,
      tier: tierForVelocity(velocity),
      handle: displayName || domHandle || (data.authorScreenName ? `@${data.authorScreenName}` : '') || data.authorName || '',
      article,
    };
  }

  function collectLeaderboardItems() {
    const seen = new Set();
    const items = [];
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const id = getTweetIdFromArticle(article);
      if (!id || seen.has(id)) continue;
      const data = tweetDataStore.get(id);
      if (!data) continue;
      seen.add(id);
      const { velocity } = computeScore(data);
      const { displayName, handle: domHandle } = getAuthorInfo(article);
      items.push({
        ...data,
        velocity,
        tier: tierForVelocity(velocity),
        handle: displayName || domHandle || (data.authorScreenName ? `@${data.authorScreenName}` : '') || data.authorName || '',
        article,
      });
    }
    return items
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, settings.leaderboardCount);
  }

  function ensureLinkSvg() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'xvm-lb-link');
    svg.style.position = 'fixed';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100vw';
    svg.style.height = '100vh';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '2147483645';
    svg.innerHTML = `
      <path class="xvm-lb-link-path" fill="none" />
      <circle class="xvm-lb-link-dot xvm-lb-link-start" r="5" />
      <circle class="xvm-lb-link-dot xvm-lb-link-end" r="5" />
    `;
    document.body.appendChild(svg);
    return svg;
  }

  function updateLinkGeometry() {
    if (!linkState) return;
    const { tweetId, itemEl, svg } = linkState;
    let article = linkState.article;
    if (!article || !article.isConnected) {
      article = getArticleByTweetId(tweetId);
      linkState.article = article;
    }
    if (!itemEl.isConnected || !article) {
      if (!article) svg.style.display = 'none';
      return;
    }
    svg.style.display = '';
    if (!article.classList.contains('xvm-article-linked')) article.classList.add('xvm-article-linked');

    const itemRect = itemEl.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    const itemCx = itemRect.left + itemRect.width / 2;
    const articleCx = articleRect.left + articleRect.width / 2;
    const startOnRight = articleCx >= itemCx;
    const startX = startOnRight ? itemRect.right : itemRect.left;
    const startY = itemRect.top + itemRect.height / 2;
    const articleVisibleTop = Math.max(articleRect.top, 8);
    const articleVisibleBottom = Math.min(articleRect.bottom, window.innerHeight - 8);
    const endY = Math.max(articleVisibleTop, Math.min(startY, articleVisibleBottom));
    const endX = startOnRight ? articleRect.left : articleRect.right;
    const dx = Math.abs(endX - startX);
    const handle = Math.max(60, dx * 0.4);
    const c1x = startX + (startOnRight ? handle : -handle);
    const c2x = endX - (startOnRight ? handle : -handle);

    svg.querySelector('.xvm-lb-link-path')?.setAttribute('d', `M ${startX},${startY} C ${c1x},${startY} ${c2x},${endY} ${endX},${endY}`);
    const start = svg.querySelector('.xvm-lb-link-start');
    start?.setAttribute('cx', startX);
    start?.setAttribute('cy', startY);
    const end = svg.querySelector('.xvm-lb-link-end');
    end?.setAttribute('cx', endX);
    end?.setAttribute('cy', endY);
  }

  function scheduleLinkUpdate() {
    if (!linkState || linkUpdateRaf) return;
    linkUpdateRaf = requestAnimationFrame(() => {
      linkUpdateRaf = 0;
      updateLinkGeometry();
    });
  }

  function startLinkFollowLoop() {
    if (linkFollowRaf) return;
    const tick = () => {
      if (!linkState) return;
      updateLinkGeometry();
      linkFollowRaf = requestAnimationFrame(tick);
    };
    linkFollowRaf = requestAnimationFrame(tick);
  }

  function setLink(tweetId, itemEl, article) {
    clearLink();
    const svg = ensureLinkSvg();
    selectedLeaderboardId = tweetId;
    itemEl.classList.add('xvm-lb-item-selected');
    article.classList.add('xvm-article-linked');
    linkState = { tweetId, itemEl, article, svg };
    updateLinkGeometry();
    startLinkFollowLoop();
  }

  function clearLink() {
    if (!linkState) return;
    linkState.itemEl?.classList.remove('xvm-lb-item-selected');
    linkState.article?.classList.remove('xvm-article-linked');
    const stale = getArticleByTweetId(linkState.tweetId);
    stale?.classList.remove('xvm-article-linked');
    linkState.svg?.remove();
    selectedLeaderboardId = '';
    linkState = null;
    if (linkUpdateRaf) {
      cancelAnimationFrame(linkUpdateRaf);
      linkUpdateRaf = 0;
    }
    if (linkFollowRaf) {
      cancelAnimationFrame(linkFollowRaf);
      linkFollowRaf = 0;
    }
  }

  function installLeaderboardListClick(list) {
    if (leaderboardListClickInstalled) return;
    leaderboardListClickInstalled = true;
    list.addEventListener('click', (event) => {
      const row = event.target.closest('.xvm-lb-item');
      if (!row) return;
      event.stopPropagation();
      const id = row.dataset.id;
      const item = getLeaderboardItemById(id);
      if (!item?.article?.isConnected) return;
      if (linkState && linkState.tweetId === item.id) {
        clearLink();
        return;
      }
      if (savedScrollY === null) {
        savedScrollY = window.scrollY;
        setBackButtonVisible(true);
      }
      item.article.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setLink(item.id, row, item.article);
    });
  }

  function hideLeaderboard() {
    if (leaderboardEl) leaderboardEl.style.display = 'none';
    clearLink();
  }

  function renderLeaderboard() {
    if (!document.body) return;
    if (!settings.leaderboardEnabled) {
      hideLeaderboard();
      return;
    }
    const items = collectLeaderboardItems();
    debugState.leaderboardItems = items.length;
    const el = ensureLeaderboard();
    const list = el.querySelector('.xvm-lb-list');
    const count = el.querySelector('.xvm-lb-count');
    installLeaderboardListClick(list);
    if (!items.length) {
      el.style.display = 'none';
      list.innerHTML = '';
      count.textContent = '0';
      leaderboardHtml = '';
      clearLink();
      return;
    }

    el.style.display = 'block';
    count.textContent = String(items.length);
    const visibleColumns = settings.leaderboardColumns.filter((column) => column.visible && leaderboardColumnRenderers[column.id]);
    const nextHtml = items.map((item, index) => {
      const handle = (item.handle || '').trim() || item.authorName || t('contentFallbackTweetLabel');
      const text = (item.text || '').replace(/\s+/g, ' ').trim();
      const selected = item.id === selectedLeaderboardId ? ' xvm-lb-item-selected' : '';
      const cells = visibleColumns.map((column) => leaderboardColumnRenderers[column.id](item, index)).join('');
      return `
        <li class="xvm-lb-item xvm-lb-${item.tier}${selected}" data-id="${escapeHtml(item.id)}" title="${escapeHtml(text || handle)}">
          ${cells}
        </li>
      `;
    }).join('');
    if (nextHtml === leaderboardHtml) return;

    leaderboardHtml = nextHtml;
    list.innerHTML = nextHtml;
    if (linkState) {
      const row = list.querySelector(`.xvm-lb-item[data-id="${linkState.tweetId}"]`);
      if (row) {
        linkState.itemEl = row;
        row.classList.add('xvm-lb-item-selected');
        updateLinkGeometry();
      } else {
        clearLink();
      }
    }
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
        `${t('contentViews')}: ${data.views.toLocaleString(currentLocale)}`,
        `${t('contentLikes')}: ${data.likes.toLocaleString(currentLocale)}`,
        `${t('contentRetweets')}: ${data.retweets.toLocaleString(currentLocale)}`,
        `${t('contentReplies')}: ${data.replies.toLocaleString(currentLocale)}`,
        `${t('contentBookmarks')}: ${data.bookmarks.toLocaleString(currentLocale)}`,
        `${t('contentVelocity')}: ${formatVelocity(velocity)}/h`,
        `${t('contentViralScore')}: ${score}/100`,
        `${t('contentPosted')}: ${formatPostedDate(posted, data.createdAt)}`,
      ].join('\n');

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
      if (settings.leaderboardEnabled) renderLeaderboard();
      else hideLeaderboard();
    });
  }

  window.addEventListener('scroll', scheduleLinkUpdate, { capture: true, passive: true });
  window.addEventListener('scroll', () => {
    if (lbScrollTick) return;
    lbScrollTick = true;
    setTimeout(() => {
      lbScrollTick = false;
      if (settings.leaderboardEnabled) renderLeaderboard();
    }, 250);
  }, { passive: true });
  window.addEventListener('resize', () => {
    applyLeaderboardWidth();
    applyLeaderboardHeight();
    applyLeaderboardPosition();
    scheduleLinkUpdate();
  }, { passive: true });
  document.addEventListener('click', (event) => {
    if (!linkState) return;
    const insideItem = linkState.itemEl && linkState.itemEl.contains(event.target);
    const insideArticle = linkState.article && linkState.article.contains(event.target);
    const insidePanel = leaderboardEl && leaderboardEl.contains(event.target);
    if (!insideItem && !insideArticle && !insidePanel) clearLink();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && linkState) clearLink();
  });

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

  function openSettingsPanel() {
    settings.leaderboardEnabled = true;
    saveSettings();
    const el = ensureLeaderboard();
    el.style.display = 'block';
    const panel = el.querySelector('.xvm-settings');
    if (panel) panel.classList.add('xvm-settings-open');
    syncSettingsForm();
    scheduleRender();
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(t('contentLeaderboardSettings') || 'Settings', openSettingsPanel);
  }

  injectPageHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDomObservers, { once: true });
  } else {
    bootDomObservers();
  }
})();
