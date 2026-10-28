// X surface paths after the 2026-10 history redesign.
// /i/bookmarks and /i/bookmarks/all redirect to /i/history (书签 tab).
// /i/history/likes is the 喜欢 tab and is not a bookmark folder.
// Numeric folder pages still use /i/bookmarks/<id> (and /i/history/<id> if
// a folder link is nested under history). BookmarkFolderTimeline stays the
// per-folder GraphQL op; the all-bookmarks feed is the Bookmarks op.
(() => {
  const ALL_BOOKMARKS_CACHE_ID = '__bookmarks__';
  const ALL_BOOKMARK_PATHS = new Set(['/i/bookmarks', '/i/bookmarks/all', '/i/history']);

  function normalizePath(pathname) {
    let path = String(pathname || '/');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
      try { path = new URL(path).pathname; } catch (_) {}
    }
    path = path.split('?')[0].split('#')[0];
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path || '/';
  }

  function isAllBookmarksPath(pathname) {
    return ALL_BOOKMARK_PATHS.has(normalizePath(pathname));
  }

  function isHistoryLikesPath(pathname) {
    return normalizePath(pathname) === '/i/history/likes';
  }

  function bookmarkFolderIdFromPath(pathname) {
    const path = normalizePath(pathname);
    const match = path.match(/^\/i\/(?:bookmarks|history)\/([^/]+)$/);
    if (!match) return null;
    let id = match[1];
    try { id = decodeURIComponent(id); } catch (_) {}
    return /^\d{1,32}$/.test(id) ? id : null;
  }

  function isBookmarkSurfacePath(pathname) {
    return isAllBookmarksPath(pathname) || !!bookmarkFolderIdFromPath(pathname);
  }

  // Legacy all-bookmarks URLs. Folder ids are left untouched.
  function canonicalBookmarkPath(pathname) {
    const path = normalizePath(pathname);
    if (path === '/i/bookmarks' || path === '/i/bookmarks/all' || path === '/i/history/bookmarks') {
      return '/i/history';
    }
    return path;
  }

  function graphqlOperationName(url) {
    const match = String(url || '').match(/\/graphql\/[^/]+\/([^/?#]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }

  function bookmarkCollectionIdFromUrl(url) {
    try {
      const value = new URL(String(url), 'https://x.com').searchParams.get('variables');
      if (!value) return null;
      const id = JSON.parse(value)?.bookmark_collection_id;
      return /^\d{1,32}$/.test(String(id || '')) ? String(id) : null;
    } catch (_) {
      return null;
    }
  }

  // Cache key for a bookmark-timeline GraphQL response.
  // BookmarkFolderTimeline → numeric folder id (inject source).
  // Bookmarks → all-bookmarks sentinel, only while the viewer is on that surface.
  // Likes and other ops return null so they cannot be stored as a folder.
  function bookmarkTimelineCacheId(url, pathname) {
    const op = graphqlOperationName(url);
    if (op === 'BookmarkFolderTimeline') {
      return bookmarkCollectionIdFromUrl(url) || bookmarkFolderIdFromPath(pathname);
    }
    if (op === 'Bookmarks' && isAllBookmarksPath(pathname)) return ALL_BOOKMARKS_CACHE_ID;
    return null;
  }

  const api = {
    ALL_BOOKMARKS_CACHE_ID,
    normalizePath,
    isAllBookmarksPath,
    isHistoryLikesPath,
    bookmarkFolderIdFromPath,
    isBookmarkSurfacePath,
    canonicalBookmarkPath,
    graphqlOperationName,
    bookmarkCollectionIdFromUrl,
    bookmarkTimelineCacheId,
  };
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.__xvmPaths = api;
})();
