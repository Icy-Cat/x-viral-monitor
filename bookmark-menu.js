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
  let foldersCache = null;
  let cacheTweetId = null;

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

  async function fetchFolders(tweetId) {
    const d = await gql('BookmarkFoldersSlice', 'GET', tweetId ? { tweet_id: tweetId } : {});
    return d?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items || [];
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
    m.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 280)) + 'px';
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderLoading() {
    const m = ensureMenu();
    m.innerHTML = '<div class="xvm-bk-loading">Loading folders…</div>';
    positionMenu();
  }

  function renderError(msg) {
    const m = ensureMenu();
    m.innerHTML = `<div class="xvm-bk-error-msg">${escapeHtml(msg)}</div>`;
    positionMenu();
  }

  function renderMenu(tweetId, folders) {
    const m = ensureMenu();
    const containing = folders.filter((f) => f.contains_requested_tweet);

    const header = containing.length
      ? `<div class="xvm-bk-header">In folder: <b>${containing.map((f) => escapeHtml(f.name)).join(', ')}</b></div>`
      : '<div class="xvm-bk-header xvm-bk-muted">Not in any folder</div>';

    const list = folders.length
      ? folders.map((f) => `
          <div class="xvm-bk-item${f.contains_requested_tweet ? ' xvm-bk-checked' : ''}" data-id="${f.id}" data-contains="${f.contains_requested_tweet ? '1' : '0'}">
            <span class="xvm-bk-check">${f.contains_requested_tweet ? '✓' : ''}</span>
            <span class="xvm-bk-name">${escapeHtml(f.name)}</span>
          </div>`).join('')
      : '<div class="xvm-bk-muted xvm-bk-empty">No folders yet. Create one below.</div>';

    m.innerHTML = `
      ${header}
      <div class="xvm-bk-list">${list}</div>
      <div class="xvm-bk-new">
        <input class="xvm-bk-input" placeholder="+ New folder (press Enter)" maxlength="50" />
      </div>
    `;

    m.querySelectorAll('.xvm-bk-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        const contains = el.dataset.contains === '1';
        el.classList.add('xvm-bk-pending');
        try {
          if (contains) {
            await gql('removeTweetFromBookmarkFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          } else {
            await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: id });
          }
          foldersCache = null;
          const refreshed = await fetchFolders(tweetId);
          foldersCache = refreshed;
          cacheTweetId = tweetId;
          if (currentTweetId === tweetId) renderMenu(tweetId, refreshed);
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
        const updated = await fetchFolders(tweetId);
        const created = updated.find((f) => f.name === name);
        if (created) {
          await gql('bookmarkTweetToFolder', 'POST', { tweet_id: tweetId, bookmark_collection_id: created.id });
        }
        foldersCache = null;
        const refreshed = await fetchFolders(tweetId);
        foldersCache = refreshed;
        cacheTweetId = tweetId;
        if (currentTweetId === tweetId) renderMenu(tweetId, refreshed);
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

    if (foldersCache && cacheTweetId === tweetId) {
      renderMenu(tweetId, foldersCache);
      return;
    }
    renderLoading();
    try {
      const folders = await fetchFolders(tweetId);
      if (currentTweetId !== tweetId) return;
      foldersCache = folders;
      cacheTweetId = tweetId;
      renderMenu(tweetId, folders);
    } catch (e) {
      if (e?.message === 'not-logged-in') {
        renderError('Not signed in to X.');
      } else {
        renderError('Failed to load folders. X Premium may be required.');
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
    if (event.data?.type !== 'XVM_SETTINGS_UPDATE') return;
    const next = !!event.data.featureBookmarkFolders;
    if (next !== enabled) {
      enabled = next;
      foldersCache = null;
      cacheTweetId = null;
      if (!enabled && menuEl) menuEl.style.display = 'none';
    }
  });
})();
