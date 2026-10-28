import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();
const source = readFileSync(resolve(repo, 'lib/x-paths.js'), 'utf8');
const content = readFileSync(resolve(repo, 'content.js'), 'utf8');
const bookmarkMenu = readFileSync(resolve(repo, 'bookmark-menu.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

function loadPaths() {
  const ctx = { window: {}, globalThis: {}, URL, JSON, decodeURIComponent };
  vm.runInNewContext(source, ctx);
  return ctx.window.__xvmPaths;
}

const BOOKMARKS_URL = '/i/api/graphql/zFGFGLIm1akEv8PE3uut8w/Bookmarks?variables=%7B%22count%22%3A20%2C%22includePromotedContent%22%3Atrue%7D';
const LIKES_URL = '/i/api/graphql/mzOgReEsktOIIXzWkqf0ig/Likes?variables=%7B%22userId%22%3A%221%22%2C%22count%22%3A20%7D';
const FOLDER_URL = `/i/api/graphql/oKopHt25pa6yhDn1ek7Qng/BookmarkFolderTimeline?variables=${encodeURIComponent(JSON.stringify({ bookmark_collection_id: '998877', count: 20 }))}`;
const FOLDER_SLICE_URL = '/i/api/graphql/i78YDd0Tza-dV4SYs58kRg/BookmarkFoldersSlice?variables=%7B%7D';

describe('history / bookmarks paths', () => {
  const api = loadPaths();

  it('treats history and the legacy bookmarks index as the all-bookmarks surface', () => {
    expect(api.isAllBookmarksPath('/i/history')).toBe(true);
    expect(api.isAllBookmarksPath('/i/history/')).toBe(true);
    expect(api.isAllBookmarksPath('/i/bookmarks')).toBe(true);
    expect(api.isAllBookmarksPath('https://x.com/i/bookmarks/all')).toBe(true);
    expect(api.isAllBookmarksPath('/i/history/likes')).toBe(false);
    expect(api.isHistoryLikesPath('/i/history/likes')).toBe(true);
    expect(api.isBookmarkSurfacePath('/i/history')).toBe(true);
    expect(api.isBookmarkSurfacePath('/i/history/likes')).toBe(false);
  });

  it('keeps numeric folder ids and does not treat likes or all as folders', () => {
    expect(api.bookmarkFolderIdFromPath('/i/bookmarks/998877')).toBe('998877');
    expect(api.bookmarkFolderIdFromPath('/i/history/998877')).toBe('998877');
    expect(api.bookmarkFolderIdFromPath('/i/bookmarks/all')).toBeNull();
    expect(api.bookmarkFolderIdFromPath('/i/history')).toBeNull();
    expect(api.bookmarkFolderIdFromPath('/i/history/likes')).toBeNull();
    expect(api.isBookmarkSurfacePath('/i/bookmarks/998877')).toBe(true);
  });

  it('rewrites legacy all-bookmarks deep links to /i/history', () => {
    expect(api.canonicalBookmarkPath('/i/bookmarks')).toBe('/i/history');
    expect(api.canonicalBookmarkPath('/i/bookmarks/')).toBe('/i/history');
    expect(api.canonicalBookmarkPath('/i/bookmarks/all')).toBe('/i/history');
    expect(api.canonicalBookmarkPath('/i/history/bookmarks')).toBe('/i/history');
    expect(api.canonicalBookmarkPath('/i/bookmarks/998877')).toBe('/i/bookmarks/998877');
    expect(api.canonicalBookmarkPath('/i/history')).toBe('/i/history');
    expect(api.canonicalBookmarkPath('/i/history/likes')).toBe('/i/history/likes');
  });

  it('caches the live Bookmarks op on the history surface and keeps folder timelines', () => {
    expect(api.graphqlOperationName(BOOKMARKS_URL)).toBe('Bookmarks');
    expect(api.bookmarkTimelineCacheId(BOOKMARKS_URL, '/i/history')).toBe(api.ALL_BOOKMARKS_CACHE_ID);
    expect(api.bookmarkTimelineCacheId(BOOKMARKS_URL, '/i/bookmarks/all')).toBe(api.ALL_BOOKMARKS_CACHE_ID);
    expect(api.bookmarkTimelineCacheId(BOOKMARKS_URL, '/home')).toBeNull();
    expect(api.bookmarkTimelineCacheId(BOOKMARKS_URL, '/i/history/likes')).toBeNull();
    expect(api.bookmarkTimelineCacheId(LIKES_URL, '/i/history/likes')).toBeNull();
    expect(api.bookmarkTimelineCacheId(FOLDER_SLICE_URL, '/i/history')).toBeNull();
    expect(api.bookmarkTimelineCacheId(FOLDER_URL, '/home')).toBe('998877');
    expect(api.bookmarkTimelineCacheId(FOLDER_URL, '/i/history')).toBe('998877');
    expect(api.bookmarkTimelineCacheId(
      '/i/api/graphql/oKopHt25pa6yhDn1ek7Qng/BookmarkFolderTimeline',
      '/i/bookmarks/42',
    )).toBe('42');
  });
});

describe('history surface wiring', () => {
  it('loads path helpers before content and the bookmark menu', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    expect(main.js.indexOf('lib/x-paths.js')).toBeGreaterThan(-1);
    expect(main.js.indexOf('lib/x-paths.js')).toBeLessThan(main.js.indexOf('content.js'));
    expect(main.js.indexOf('lib/x-paths.js')).toBeLessThan(main.js.indexOf('bookmark-menu.js'));
  });

  it('hooks Bookmarks without dropping BookmarkFolderTimeline', () => {
    expect(content).toContain('cacheObservedBookmarkTimeline');
    expect(content).toContain('bookmarkTimelineCacheId');
    expect(content).toContain('XVM_BOOKMARKS_TIMELINE_QID_CAPTURED');
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_QID_CAPTURED');
    expect(content).toContain('(?:Bookmarks|BookmarkFolderTimeline)');
    expect(content).toContain('button[data-testid="retweet"], button[data-testid="unretweet"]');
    expect(content).toContain('app-text-transition-container');
    expect(content).not.toContain("location.pathname.match(/^\\/i\\/bookmarks\\/([^/?#]+)/)");
  });

  it('rewrites legacy bookmark links and still reloads dirty numeric folders', () => {
    expect(bookmarkMenu).toContain('canonicalBookmarkPath');
    expect(bookmarkMenu).toContain('bookmarkFolderIdFromPath');
    expect(bookmarkMenu).toContain('dirtyBookmarkFolderIds');
    expect(bookmarkMenu).toContain("url.pathname = canonical");
    expect(bookmarkMenu).not.toContain('a[href^="/i/bookmarks/"]');
  });
});
