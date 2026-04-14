(function () {
  'use strict';

  const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const OPS = {
    BookmarkFoldersSlice: 'i78YDd0Tza-dV4SYs58kRg',
    bookmarkTweetToFolder: '4KHZvvNbHNf07bsgnL9gWA',
    removeTweetFromBookmarkFolder: '2Qbj9XZvtUvyJB4gFwWfaA',
    createBookmarkFolder: '6Xxqpq8TM_CREYiuof_h5w',
    CreateBookmark: 'aoDbu3RHznuiSkQ9aNM67Q',
  };

  let enabled = false;
  let menuEl = null;
  let anchorBtn = null;
  let currentTweetId = null;
  let hoverTimer = null;
  let hideTimer = null;

  // Folder list cache (pushed from bridge.js)
  let cachedFolders = [];
  // In-memory per-tweet containment cache: tweet_id -> { ids: Set, at: ms }
  const containsCache = new Map();
  const CONTAINS_TTL_MS = 30_000;

  function getContainsFresh(tweetId) {
    const e = containsCache.get(tweetId);
    if (!e) return null;
    if (Date.now() - e.at > CONTAINS_TTL_MS) return null;
    return e.ids;
  }

  function setContains(tweetId, ids) {
    containsCache.set(tweetId, { ids, at: Date.now() });
  }

  function getCsrf() {
    return document.cookie.match(/ct0=([^;]+)/)?.[1];
  }

  async function gql(op, method, vars) {
    const ct0 = getCsrf();
    if (!ct0) throw new Error('not-logged-in');
    const qid = OPS[op];
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
      const url = `/i/api/graphql/${qid}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}`;
      r = await fetch(url, init);
    } else {
      init.method = 'POST';
      init.body = JSON.stringify({ variables: vars, queryId: qid });
      r = await fetch(`/i/api/graphql/${qid}/${op}`, init);
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
    window.postMessage({ type: 'XVM_REQUEST_FOLDER_REFRESH' }, '*');
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

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'xvm-bk-menu';
    menuEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    menuEl.addEventListener('mouseleave', scheduleHide);

    // Delegated click handler for folder items (re-rendered via innerHTML)
    menuEl.addEventListener('click', async (ev) => {
      const el = ev.target.closest('.xvm-bk-item');
      if (!el || !currentTweetId) return;
      const id = el.dataset.id;
      const tweetId = currentTweetId;
      const contains = getContainsFresh(tweetId);
      const isIn = contains instanceof Set && contains.has(id);
      if (el.classList.contains('xvm-bk-pending')) return;
      el.classList.add('xvm-bk-pending');
      try {
        if (isIn) {
          await gql('removeTweetFromBookmarkFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          // Re-read the latest Set after awaiting so a concurrent refetch
          // that replaced containsCache doesn't get clobbered by a stale ref.
          const latest = getContainsFresh(tweetId) || new Set();
          latest.delete(id);
          setContains(tweetId, latest);
        } else {
          if (!contains || contains.size === 0) {
            await ensureBookmarked(tweetId);
          }
          await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          const after = getContainsFresh(tweetId) || new Set();
          after.add(id);
          setContains(tweetId, after);
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
    m.style.display = 'block';
    const menuWidth = 240;
    let left = rect.right + 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = rect.left - menuWidth - 8;
    }
    m.style.left = left + 'px';
    m.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 320)) + 'px';
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderEmpty(msg, isError) {
    const m = ensureMenu();
    m.innerHTML = `<div class="xvm-bk-empty${isError ? ' xvm-bk-error-msg' : ''}">${escapeHtml(msg)}</div>`;
    positionMenu();
  }

  function renderMenu(tweetId) {
    const m = ensureMenu();
    if (!cachedFolders.length) {
      renderEmpty('No folders cached. Open the extension popup to refresh.');
      return;
    }

    const containing = getContainsFresh(tweetId);
    const hasContains = containing instanceof Set;

    const header = hasContains && containing.size
      ? `<div class="xvm-bk-header">In folder: <b>${cachedFolders.filter((f) => containing.has(f.id)).map((f) => escapeHtml(f.name)).join(', ')}</b></div>`
      : hasContains
        ? '<div class="xvm-bk-header xvm-bk-muted">Not in any folder</div>'
        : '<div class="xvm-bk-header xvm-bk-muted">Checking current folder…</div>';

    const list = cachedFolders.map((f) => {
      const inIt = hasContains && containing.has(f.id);
      return `
        <div class="xvm-bk-item${inIt ? ' xvm-bk-checked' : ''}" data-id="${escapeHtml(f.id)}">
          <span class="xvm-bk-check">${inIt ? '✓' : ''}</span>
          <span class="xvm-bk-name">${escapeHtml(f.name)}</span>
        </div>`;
    }).join('');

    m.innerHTML = `
      ${header}
      <div class="xvm-bk-list">${list}</div>
      <div class="xvm-bk-new">
        <input class="xvm-bk-input" placeholder="+ New folder (Enter)" maxlength="50" />
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
          renderEmpty('Failed to load folders. X Premium may be required.', true);
          return;
        }
        // Mark containment as "unknown but resolved" so the header stops
        // saying "Checking…" and the user can still click folders.
        setContains(tweetId, new Set());
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

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const type = event.data?.type;
    if (type === 'XVM_SETTINGS_UPDATE') {
      const next = !!event.data.featureBookmarkFolders;
      if (next !== enabled) {
        enabled = next;
        if (!enabled && menuEl) menuEl.style.display = 'none';
      }
      return;
    }
    if (type === 'XVM_FOLDERS_UPDATE') {
      const next = Array.isArray(event.data.folders) ? event.data.folders : [];
      const changed = !foldersEqual(cachedFolders, next);
      cachedFolders = next;
      // containsCache stores folder IDs; IDs survive rename, and deleted
      // folders are naturally filtered out at render time. Don't wipe it.
      if (changed && currentTweetId && menuEl && menuEl.style.display !== 'none') {
        renderMenu(currentTweetId);
      }
    }
  });
})();
