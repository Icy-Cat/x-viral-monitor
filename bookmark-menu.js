(function () {
  'use strict';

  const X_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const OPS = {
    BookmarkFoldersSlice: 'i78YDd0Tza-dV4SYs58kRg',
    bookmarkTweetToFolder: '4KHZvvNbHNf07bsgnL9gWA',
    removeTweetFromBookmarkFolder: '2Qbj9XZvtUvyJB4gFwWfaA',
    createBookmarkFolder: '6Xxqpq8TM_CREYiuof_h5w',
  };

  let enabled = false;
  let menuEl = null;
  let anchorBtn = null;
  let currentTweetId = null;
  let hoverTimer = null;
  let hideTimer = null;

  // Folder list cache (pushed from bridge.js)
  let cachedFolders = [];
  // In-memory per-tweet containment cache (tweet_id -> Set(folder_id))
  const containsCache = new Map();

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
    if (method === 'GET') {
      const url = `/i/api/graphql/${qid}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}`;
      const r = await fetch(url, init);
      return r.json();
    }
    init.method = 'POST';
    init.body = JSON.stringify({ variables: vars, queryId: qid });
    const r = await fetch(`/i/api/graphql/${qid}/${op}`, init);
    return r.json();
  }

  async function fetchContains(tweetId) {
    const d = await gql('BookmarkFoldersSlice', 'GET', { tweet_id: tweetId });
    const items = d?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items || [];
    const ids = new Set(items.filter((i) => i.contains_requested_tweet).map((i) => i.id));
    containsCache.set(tweetId, ids);
    if (items.length !== cachedFolders.length) requestRefresh();
    return ids;
  }

  function requestRefresh() {
    window.postMessage({ type: 'XVM_REQUEST_FOLDER_REFRESH' }, '*');
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

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'xvm-bk-menu';
    menuEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    menuEl.addEventListener('mouseleave', scheduleHide);
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

    const containing = containsCache.get(tweetId);
    const hasContains = containing instanceof Set;

    const header = hasContains && containing.size
      ? `<div class="xvm-bk-header">In folder: <b>${cachedFolders.filter((f) => containing.has(f.id)).map((f) => escapeHtml(f.name)).join(', ')}</b></div>`
      : hasContains
        ? '<div class="xvm-bk-header xvm-bk-muted">Not in any folder</div>'
        : '<div class="xvm-bk-header xvm-bk-muted">Checking current folder…</div>';

    const list = cachedFolders.map((f) => {
      const inIt = hasContains && containing.has(f.id);
      return `
        <div class="xvm-bk-item${inIt ? ' xvm-bk-checked' : ''}" data-id="${f.id}">
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

    m.querySelectorAll('.xvm-bk-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        const contains = containsCache.get(tweetId);
        const isIn = contains instanceof Set && contains.has(id);
        el.classList.add('xvm-bk-pending');
        try {
          if (isIn) {
            await gql('removeTweetFromBookmarkFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
            contains.delete(id);
          } else {
            await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
            if (contains instanceof Set) contains.add(id);
            else containsCache.set(tweetId, new Set([id]));
          }
          if (currentTweetId === tweetId) renderMenu(tweetId);
        } catch (e) {
          el.classList.remove('xvm-bk-pending');
          el.classList.add('xvm-bk-error');
        }
      });
    });

    const input = m.querySelector('.xvm-bk-input');
    input.addEventListener('keydown', async (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.disabled = true;
      try {
        await gql('createBookmarkFolder', 'POST', { name });
        requestRefresh();
        // Wait briefly for bridge to push the updated cache
        await new Promise((r) => setTimeout(r, 500));
        const created = cachedFolders.find((f) => f.name === name);
        if (created) {
          await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: created.id });
          const cur = containsCache.get(tweetId);
          if (cur instanceof Set) cur.add(created.id);
          else containsCache.set(tweetId, new Set([created.id]));
        }
        if (currentTweetId === tweetId) renderMenu(tweetId);
      } catch (e) {
        input.disabled = false;
        input.classList.add('xvm-bk-error');
      }
    });

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
    anchorBtn = btn;
    currentTweetId = tweetId;

    // Render instantly from cache
    renderMenu(tweetId);

    // Background containment lookup
    if (!containsCache.has(tweetId)) {
      try {
        await fetchContains(tweetId);
        if (currentTweetId === tweetId) renderMenu(tweetId);
      } catch (e) {
        if (currentTweetId === tweetId && !cachedFolders.length) {
          renderEmpty('Failed to load folders. X Premium may be required.', true);
        }
      }
    }
  }

  document.addEventListener('mouseover', (e) => {
    if (!enabled) return;
    const btn = e.target.closest?.('[data-testid="bookmark"], [data-testid="removeBookmark"]');
    if (!btn) return;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openForButton(btn), 350);
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!enabled) return;
    const btn = e.target.closest?.('[data-testid="bookmark"], [data-testid="removeBookmark"]');
    if (!btn) return;
    clearTimeout(hoverTimer);
    scheduleHide();
  }, true);

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
      cachedFolders = Array.isArray(event.data.folders) ? event.data.folders : [];
      containsCache.clear();
      if (currentTweetId && menuEl && menuEl.style.display !== 'none') {
        renderMenu(currentTweetId);
      }
    }
  });
})();
