(function () {
  'use strict';

  const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const OPS = {
    BookmarkFoldersSlice: { queryId: 'i78YDd0Tza-dV4SYs58kRg', operationName: 'BookmarkFoldersSlice' },
    bookmarkTweetToFolder: { queryId: '4KHZvvNbHNf07bsgnL9gWA', operationName: 'bookmarkTweetToFolder' },
    removeTweetFromBookmarkFolder: { queryId: '2Qbj9XZvtUvyJB4gFwWfaA', operationName: 'RemoveTweetFromBookmarkFolder' },
    createBookmarkFolder: { queryId: '6Xxqpq8TM_CREYiuof_h5w', operationName: 'createBookmarkFolder' },
    CreateBookmark: { queryId: 'aoDbu3RHznuiSkQ9aNM67Q', operationName: 'CreateBookmark' },
  };
  const DEFAULT_MESSAGES = {
    contentBookmarkMenuInFolder: 'In folder:',
    contentBookmarkMenuNotInAny: 'Not in any folder',
    contentBookmarkMenuCheckFailed: "Couldn’t check current folder. Click a folder to retry.",
    contentBookmarkMenuChecking: 'Checking current folder…',
    contentBookmarkMenuLoadingFolders: 'Loading bookmark folders…',
    contentBookmarkMenuLoadFailed: 'Failed to load folders. X Premium may be required.',
    contentBookmarkMenuNoFolders: 'No folders yet',
    contentBookmarkMenuNewFolderPlaceholder: '+ New folder (Enter)',
  };
  const MENU_WIDTH = 292;
  const MENU_MARGIN = 8;
  const FOLDER_COLORS = [
    '#1dc7a8',
    '#ffd400',
    '#ff9f2f',
    '#ffcc00',
    '#ffb86c',
    '#7b61ff',
    '#ff453a',
    '#64dcc6',
    '#ff69b4',
  ];

  let enabled = false;
  let menuEl = null;
  let anchorBtn = null;
  let currentTweetId = null;
  let hoverTimer = null;
  let hideTimer = null;
  let bookmarkFolderReloadScheduled = false;

  // Folder list cache (pushed from bridge.js)
  let cachedFolders = [];
  let foldersLoadedAt = 0;
  let lastRefreshRequestAt = 0;
  let messages = { ...DEFAULT_MESSAGES };
  // In-memory per-tweet containment cache: tweet_id -> { ids: Set, at: ms }
  const containsCache = new Map();
  const CONTAINS_TTL_MS = 30_000;
  // Tweets whose containment fetch most recently failed — tracked separately
  // from containsCache so we don't confuse "checked, in no folders" with
  // "couldn't check". A present entry means: last fetch threw; render menu
  // in an error state and re-check on click.
  const containsFailed = new Set();
  const dirtyBookmarkFolderIds = new Set();

  function getContainsFresh(tweetId) {
    const e = containsCache.get(tweetId);
    if (!e) return null;
    if (Date.now() - e.at > CONTAINS_TTL_MS) return null;
    return e.ids;
  }

  function setContains(tweetId, ids) {
    containsCache.set(tweetId, { ids, at: Date.now() });
    containsFailed.delete(tweetId);
  }

  function currentBookmarkFolderId() {
    return location.pathname.match(/^\/i\/bookmarks\/(\d+)/)?.[1] || null;
  }

  function markBookmarkFolderDirty(folderId) {
    if (!folderId) return;
    const id = String(folderId);
    dirtyBookmarkFolderIds.add(id);
    if (currentBookmarkFolderId() === id && !bookmarkFolderReloadScheduled) {
      bookmarkFolderReloadScheduled = true;
      setTimeout(() => window.location.reload(), 250);
    }
  }

  function notifyBookmarkFolderMutation(folderId, tweetId, action) {
    markBookmarkFolderDirty(folderId);
    window.postMessage({
      type: 'XVM_BOOKMARK_FOLDER_MUTATION',
      folderId: String(folderId || ''),
      tweetId: String(tweetId || ''),
      action,
      at: Date.now(),
    }, '*');
  }

  function getCsrf() {
    return document.cookie.match(/ct0=([^;]+)/)?.[1];
  }

  async function gql(op, method, vars) {
    const ct0 = getCsrf();
    if (!ct0) throw new Error('not-logged-in');
    const operation = OPS[op];
    const qid = operation?.queryId;
    const operationName = operation?.operationName || op;
    const init = {
      credentials: 'include',
      headers: {
        'authorization': X_BEARER,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'content-type': 'application/json',
      },
    };
    let r;
    if (method === 'GET') {
      const url = `/i/api/graphql/${qid}/${operationName}?variables=${encodeURIComponent(JSON.stringify(vars))}`;
      r = await fetch(url, init);
    } else {
      init.method = 'POST';
      init.body = JSON.stringify({ variables: vars, queryId: qid });
      r = await fetch(`/i/api/graphql/${qid}/${operationName}`, init);
    }
    if (!r.ok) throw new Error(`${op} HTTP ${r.status}`);
    const d = await r.json();
    if (Array.isArray(d?.errors) && d.errors.length) {
      const msg = d.errors[0]?.message || 'graphql error';
      const err = new Error(`${op}: ${msg}`);
      err.graphqlErrors = d.errors;
      throw err;
    }
    return d;
  }

  async function fetchContains(tweetId) {
    const d = await gql('BookmarkFoldersSlice', 'GET', { tweet_id: tweetId });
    const items = d?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items || [];
    const ids = new Set(items.filter((i) => i.contains_requested_tweet).map((i) => i.id));
    setContains(tweetId, ids);
    // If the fresh list differs from our cache, ask bridge to refresh (its
    // no-tweet-id endpoint is authoritative). Never overwrite cachedFolders
    // here — an empty or partial response would wipe a good cache.
    const freshList = items.map((i) => ({ id: i.id, name: i.name }));
    if (items.length > 0 && !foldersEqual(cachedFolders, freshList)) {
      requestRefresh();
    }
    return ids;
  }

  function requestRefresh() {
    const now = Date.now();
    if (now - lastRefreshRequestAt < 3000) return;
    lastRefreshRequestAt = now;
    window.postMessage({ type: 'XVM_REQUEST_FOLDER_REFRESH' }, '*');
  }

  function requestSettings() {
    window.postMessage({ type: 'XVM_REQUEST_SETTINGS' }, '*');
  }

  function requestTheme() {
    window.postMessage({ type: 'XVM_THEME_REQUEST' }, '*');
  }

  function luminanceFromRgb(rgb) {
    const m = String(rgb || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return null;
    const [r, g, b] = m.slice(1, 4).map((v) => Number.parseInt(v, 10) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function detectPageTheme() {
    const explicit = (document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme || '').toLowerCase();
    if (explicit.includes('dark')) return 'dark';
    if (explicit.includes('light')) return 'light';
    const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
    const lum = luminanceFromRgb(bg);
    if (lum !== null) return lum < 0.45 ? 'dark' : 'light';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyMenuTheme(theme) {
    if (!menuEl) return;
    menuEl.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  function findArticleByTweetId(tweetId) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const links = article.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const m = (link.getAttribute('href') || '').match(/\/status\/(\d+)/);
        if (m && m[1] === tweetId) return article;
      }
    }
    return null;
  }

  // Ensure the tweet is in "All Bookmarks" before assigning it to a folder.
  // Prefers clicking the native bookmark button so X's React state updates the
  // icon. Polls the DOM until the button flips to removeBookmark (up to 2s),
  // guaranteeing the CreateBookmark mutation has committed on the server before
  // we fire bookmarkTweetToFolder. Falls back to the CreateBookmark API if the
  // article isn't in the DOM or the native click doesn't take effect in time.
  async function ensureBookmarked(tweetId) {
    const initial = findArticleByTweetId(tweetId);
    if (initial?.querySelector('[data-testid="removeBookmark"]')) return 'already';

    const addBtn = initial?.querySelector('[data-testid="bookmark"]');
    if (addBtn) {
      addBtn.click();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80));
        const current = findArticleByTweetId(tweetId);
        if (current?.querySelector('[data-testid="removeBookmark"]')) return 'clicked';
      }
    }

    // Fallback: direct mutation. Data will be correct even if the icon lags.
    try {
      await gql('CreateBookmark', 'POST', { tweet_id: tweetId });
      return 'api';
    } catch (e) {
      console.warn('[XVM] ensureBookmarked API fallback failed', e);
      return 'failed';
    }
  }

  function getTweetIdFromButton(btn) {
    const article = btn.closest('article[data-testid="tweet"]');
    if (!article) return null;
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const m = link.getAttribute('href').match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  async function fetchFoldersDirect() {
    const d = await gql('BookmarkFoldersSlice', 'GET', {});
    const items = d?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items || [];
    return items.map((i) => ({ id: i.id, name: i.name }));
  }

  function foldersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;
    }
    return true;
  }

  function folderColor(folder) {
    const key = `${folder?.id || ''}:${folder?.name || ''}`;
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return FOLDER_COLORS[Math.abs(hash) % FOLDER_COLORS.length];
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'xvm-bk-menu';
    applyMenuTheme(detectPageTheme());
    menuEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    menuEl.addEventListener('mouseleave', scheduleHide);

    // Delegated click handler for folder items (re-rendered via innerHTML)
    menuEl.addEventListener('click', async (ev) => {
      const el = ev.target.closest('.xvm-bk-item');
      if (!el || !currentTweetId) return;
      const id = el.dataset.id;
      const tweetId = currentTweetId;
      if (el.classList.contains('xvm-bk-pending')) return;
      el.classList.add('xvm-bk-pending');

      // If we don't have a known containment set (pending or previous
      // failure), try to fetch it now so we pick the right mutation. A
      // failure here is fatal for this click — we must not guess.
      let contains = getContainsFresh(tweetId);
      if (!(contains instanceof Set)) {
        try {
          contains = await fetchContains(tweetId);
          if (currentTweetId === tweetId) renderMenu(tweetId);
        } catch (e) {
          console.warn('[XVM] containment recheck failed', e);
          containsFailed.add(tweetId);
          el.classList.remove('xvm-bk-pending');
          el.classList.add('xvm-bk-error');
          if (currentTweetId === tweetId) renderMenu(tweetId);
          return;
        }
      }
      const isIn = contains instanceof Set && contains.has(id);
      try {
        if (isIn) {
          await gql('removeTweetFromBookmarkFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          // Re-read the latest Set after awaiting so a concurrent refetch
          // that replaced containsCache doesn't get clobbered by a stale ref.
          const latest = getContainsFresh(tweetId) || new Set();
          latest.delete(id);
          setContains(tweetId, latest);
          notifyBookmarkFolderMutation(id, tweetId, 'remove');
        } else {
          if (!contains || contains.size === 0) {
            await ensureBookmarked(tweetId);
          }
          await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          const after = getContainsFresh(tweetId) || new Set();
          after.add(id);
          setContains(tweetId, after);
          notifyBookmarkFolderMutation(id, tweetId, 'add');
        }
        if (currentTweetId === tweetId) renderMenu(tweetId);
      } catch (e) {
        console.warn('[XVM] folder op failed', e);
        el.classList.remove('xvm-bk-pending');
        el.classList.add('xvm-bk-error');
      }
    });

    // Delegated keydown on the new-folder input
    menuEl.addEventListener('keydown', async (ev) => {
      const input = ev.target;
      if (!(input && input.classList?.contains('xvm-bk-input'))) return;
      if (ev.key !== 'Enter' || !currentTweetId) return;
      ev.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const tweetId = currentTweetId;
      input.disabled = true;
      try {
        await gql('createBookmarkFolder', 'POST', { name });
        const fresh = await fetchFoldersDirect();
        if (!foldersEqual(cachedFolders, fresh)) cachedFolders = fresh;
        requestRefresh();
        const created = fresh.find((f) => f.name === name);
        if (!created) {
          throw new Error('createBookmarkFolder: folder not found after refetch');
        }
        const cur = getContainsFresh(tweetId);
        if (!cur || cur.size === 0) {
          await ensureBookmarked(tweetId);
        }
        await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: created.id });
        const after = getContainsFresh(tweetId) || new Set();
        after.add(created.id);
        setContains(tweetId, after);
        notifyBookmarkFolderMutation(created.id, tweetId, 'add');
        if (currentTweetId === tweetId) renderMenu(tweetId);
      } catch (e) {
        console.warn('[XVM] create folder flow failed', e);
        input.disabled = false;
        input.classList.add('xvm-bk-error');
      }
    });

    document.body.appendChild(menuEl);
    return menuEl;
  }

  function positionMenu() {
    if (!anchorBtn) return;
    const rect = anchorBtn.getBoundingClientRect();
    const m = ensureMenu();
    applyMenuTheme(detectPageTheme());
    m.style.display = 'block';
    const menuWidth = MENU_WIDTH;
    let left = rect.right + MENU_MARGIN;
    if (left + menuWidth > window.innerWidth - MENU_MARGIN) {
      left = rect.left - menuWidth - MENU_MARGIN;
    }
    left = Math.max(MENU_MARGIN, Math.min(left, window.innerWidth - menuWidth - MENU_MARGIN));
    const menuHeight = m.offsetHeight || 320;
    const maxTop = Math.max(MENU_MARGIN, window.innerHeight - menuHeight - MENU_MARGIN);
    const top = Math.max(MENU_MARGIN, Math.min(rect.top, maxTop));
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function t(key) {
    return messages[key] || DEFAULT_MESSAGES[key] || key;
  }

  function renderEmpty(msg, isError) {
    const m = ensureMenu();
    m.innerHTML = `<div class="xvm-bk-empty${isError ? ' xvm-bk-error-msg' : ''}">${escapeHtml(msg)}</div>`;
    positionMenu();
  }

  function renderMenu(tweetId) {
    const m = ensureMenu();
    if (!cachedFolders.length && !foldersLoadedAt) {
      requestRefresh();
      renderEmpty(t('contentBookmarkMenuLoadingFolders'));
      return;
    }

    const containing = getContainsFresh(tweetId);
    const hasContains = containing instanceof Set;
    const failed = containsFailed.has(tweetId);

    let header;
    if (hasContains && containing.size) {
      header = `<div class="xvm-bk-header">${escapeHtml(t('contentBookmarkMenuInFolder'))} <b>${cachedFolders.filter((f) => containing.has(f.id)).map((f) => escapeHtml(f.name)).join(', ')}</b></div>`;
    } else if (hasContains) {
      header = `<div class="xvm-bk-header xvm-bk-muted">${escapeHtml(t('contentBookmarkMenuNotInAny'))}</div>`;
    } else if (failed) {
      header = `<div class="xvm-bk-header xvm-bk-error-msg">${escapeHtml(t('contentBookmarkMenuCheckFailed'))}</div>`;
    } else {
      header = `<div class="xvm-bk-header xvm-bk-muted">${escapeHtml(t('contentBookmarkMenuChecking'))}</div>`;
    }

    // Unknown containment is handled by the header; keep folder rows visually
    // quiet so users don't see a confusing marker before the fetch returns.
    const unknown = !hasContains;
    const list = cachedFolders.length ? cachedFolders.map((f) => {
      const inIt = hasContains && containing.has(f.id);
      return `
        <div class="xvm-bk-item${inIt ? ' xvm-bk-checked' : ''}${unknown ? ' xvm-bk-unknown' : ''}" data-id="${escapeHtml(f.id)}" style="--xvm-bk-folder-color: ${folderColor(f)}">
          <span class="xvm-bk-folder-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M7 4.8C7 3.8 7.8 3 8.8 3h6.4C16.2 3 17 3.8 17 4.8v14.7c0 .7-.8 1.1-1.4.7L12 17.9l-3.6 2.3c-.6.4-1.4 0-1.4-.7V4.8Z"/>
            </svg>
          </span>
          <span class="xvm-bk-name">${escapeHtml(f.name)}</span>
          <span class="xvm-bk-state" aria-hidden="true">${inIt ? '✓' : ''}</span>
          <svg class="xvm-bk-chevron" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M9 5l7 7-7 7"/>
          </svg>
        </div>`;
    }).join('') : `<div class="xvm-bk-empty">${escapeHtml(t('contentBookmarkMenuNoFolders'))}</div>`;

    m.innerHTML = `
      ${header}
      <div class="xvm-bk-list">${list}</div>
      <div class="xvm-bk-new">
        <input class="xvm-bk-input" placeholder="${escapeHtml(t('contentBookmarkMenuNewFolderPlaceholder'))}" maxlength="50" />
      </div>
    `;

    positionMenu();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (menuEl) menuEl.style.display = 'none';
      currentTweetId = null;
    }, 300);
  }

  function hideMenuNow() {
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    if (menuEl) menuEl.style.display = 'none';
    currentTweetId = null;
  }

  async function openForButton(btn) {
    const tweetId = getTweetIdFromButton(btn);
    if (!tweetId) return;

    // Re-find a live button in case React replaced the original article
    // during the hover delay. getBoundingClientRect on a detached element
    // returns zero, which would anchor the menu at the viewport corner.
    let liveBtn = btn;
    if (!btn.isConnected) {
      const freshArticle = findArticleByTweetId(tweetId);
      liveBtn = freshArticle?.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]') || null;
      if (!liveBtn) return; // nothing to anchor to
    }
    anchorBtn = liveBtn;
    currentTweetId = tweetId;

    // Render instantly from cache
    renderMenu(tweetId);

    // Background containment lookup (skip if cached and fresh)
    if (!getContainsFresh(tweetId)) {
      try {
        await fetchContains(tweetId);
        if (currentTweetId === tweetId) renderMenu(tweetId);
      } catch (e) {
        console.warn('[XVM] fetchContains failed', e);
        if (currentTweetId !== tweetId) return;
        if (!cachedFolders.length) {
          renderEmpty(t('contentBookmarkMenuLoadFailed'), true);
          return;
        }
        // Leave containsCache untouched so we don't claim "in no folders" —
        // record the failure so renderMenu shows an error header and the
        // click handler re-checks before firing a mutation.
        containsFailed.add(tweetId);
        renderMenu(tweetId);
      }
    }
  }

  function findBookmarkBtn(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-testid="bookmark"], [data-testid="removeBookmark"]');
  }

  document.addEventListener('mouseover', (e) => {
    if (!enabled) return;
    const btn = findBookmarkBtn(e.target);
    if (!btn) return;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openForButton(btn), 350);
  });

  document.addEventListener('mouseout', (e) => {
    if (!enabled) return;
    const btn = findBookmarkBtn(e.target);
    if (!btn) return;
    clearTimeout(hoverTimer);
    scheduleHide();
  });

  document.addEventListener('pointerdown', (ev) => {
    if (!enabled || !menuEl || menuEl.style.display === 'none') return;
    const target = ev.target;
    if (target instanceof Element && (menuEl.contains(target) || findBookmarkBtn(target))) return;
    hideMenuNow();
  }, true);

  document.addEventListener('click', (ev) => {
    const link = ev.target instanceof Element
      ? ev.target.closest('a[href^="/i/bookmarks/"], a[href^="https://x.com/i/bookmarks/"]')
      : null;
    if (!link) return;
    const url = new URL(link.href, location.href);
    const folderId = url.pathname.match(/^\/i\/bookmarks\/(\d+)/)?.[1];
    if (!folderId || !dirtyBookmarkFolderIds.has(folderId)) return;
    dirtyBookmarkFolderIds.delete(folderId);
    ev.preventDefault();
    ev.stopImmediatePropagation();
    window.location.assign(url.href);
  }, true);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const type = event.data?.type;
    if (type === 'XVM_SETTINGS_UPDATE') {
      if (event.data.messages && typeof event.data.messages === 'object') {
        messages = { ...DEFAULT_MESSAGES, ...event.data.messages };
      }
      const next = !!event.data.featureBookmarkFolders;
      if (next !== enabled) {
        enabled = next;
        if (!enabled) {
          if (menuEl) menuEl.style.display = 'none';
          containsFailed.clear();
        } else {
          requestRefresh();
        }
      }
      return;
    }
    if (type === 'XVM_FOLDERS_UPDATE') {
      const next = Array.isArray(event.data.folders) ? event.data.folders : [];
      const changed = !foldersEqual(cachedFolders, next);
      cachedFolders = next;
      foldersLoadedAt = Number.isFinite(event.data.cachedAt) && event.data.cachedAt > 0
        ? event.data.cachedAt
        : Date.now();
      // containsCache stores folder IDs; IDs survive rename, and deleted
      // folders are naturally filtered out at render time. Don't wipe it.
      if (changed && currentTweetId && menuEl && menuEl.style.display !== 'none') {
        renderMenu(currentTweetId);
      }
      return;
    }
    if (type === 'XVM_THEME_UPDATE') {
      applyMenuTheme(detectPageTheme());
    }
    if (type === 'XVM_BOOKMARK_FOLDER_DIRTY') {
      markBookmarkFolderDirty(event.data.folderId);
    }
  });

  requestSettings();
  requestTheme();
})();
