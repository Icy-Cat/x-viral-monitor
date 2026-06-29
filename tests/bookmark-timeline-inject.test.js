import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const source = readFileSync(resolve(repo, 'lib/bookmark-timeline-inject.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const bridge = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const content = readFileSync(resolve(repo, 'content.js'), 'utf8');
const styles = readFileSync(resolve(repo, 'styles.css'), 'utf8');

function loadApi() {
  const ctx = { window: {}, globalThis: {}, Date, structuredClone };
  vm.runInNewContext(source, ctx);
  return ctx.window.__xvmBookmarkTimelineInject;
}

function tweetEntry(id) {
  return {
    entryId: `tweet-${id}`,
    sortIndex: String(1000000 - Number(id || 0) * 1000),
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: {
          result: {
            rest_id: String(id),
            legacy: { full_text: `tweet ${id}` },
          },
        },
      },
    },
  };
}

function homeTimeline(ids) {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: ids.map(tweetEntry),
            },
          ],
        },
      },
    },
  };
}

describe('bookmark timeline injection', () => {
  it('loads the helper before content.js in the MAIN-world content script', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    const order = main.js;
    expect(order.indexOf('lib/bookmark-timeline-inject.js')).toBeLessThan(order.indexOf('content.js'));
  });

  it('exposes a bridge message for saving experimental inject settings', () => {
    expect(bridge).toContain('XVM_BOOKMARK_TIMELINE_INJECT_SAVE');
    expect(bridge).toContain('XVM_BOOKMARK_TIMELINE_REFRESH');
    expect(bridge).toContain('XVM_BOOKMARK_TIMELINE_CACHE_UPDATE');
    expect(bridge).toContain('bookmarkTimelineInjectFolderIds');
    expect(bridge).toContain('bookmarkTimelineInjectEvery');
  });

  it('builds BookmarkFolderTimeline requests like Xillot', () => {
    expect(bridge).toContain("OP_BOOKMARK_FOLDER_TIMELINE = { name: 'BookmarkFolderTimeline'");
    expect(bridge).toContain('oKopHt25pa6yhDn1ek7Qng');
    expect(bridge).toContain('bookmark_collection_id: folderId');
    expect(bridge).toContain('includePromotedContent: false');
    expect(bridge).toContain('discoverBookmarkFolderTimelineQueryId');
    expect(bridge).toContain('X_MAIN_BUNDLE_RE');
    expect(bridge).toContain('client-web\\/main\\.');
    expect(bridge).toContain('featureSwitches');
    expect(bridge).toContain('buildBookmarkTimelineFeatures');
    expect(bridge).toContain('BookmarkFolderTimeline 404');
    expect(bridge).toContain('retryWithFreshQueryId');
    expect(bridge).toContain('requestBookmarkTimelineTxId');
    expect(content).toContain('captureBookmarkTimelineQueryId');
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_QID_CAPTURED');
    expect(bridge).toContain('BOOKMARK_TIMELINE_QID_CACHE_KEY');
    expect(bridge).toContain('applyBookmarkTimelineQueryId');
    expect(bridge).toContain("'x-client-transaction-id'");
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_TXID_REQUEST');
    expect(content).toContain('window.__xvmXct?.generateTxId');
  });

  it('adds an in-page cog entry and modal for bookmark timeline settings', () => {
    expect(content).toContain('ensureBookmarkTimelineCog');
    expect(content).toContain('showBookmarkTimelineSettings');
    expect(content).toContain("const firstTab = tl?.querySelector?.('[role=\"tab\"]')");
    expect(content).toContain("const firstTabItem = firstTab.closest('[role=\"presentation\"]') || firstTab");
    expect(content).toContain('firstTabItem.after(btn)');
    expect(content).toContain('_bookmarkTimelineCogTimer = setInterval');
    expect(content).toContain('window.__xvmBtiState');
    expect(content).toContain("console.debug('[XVM-BTI]'");
    expect(content).toContain("localStorage.getItem('xvmBtiDebug') === '1'");
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_REFRESH');
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_CACHE_UPDATE');
    expect(content).toContain('XVM_BOOKMARK_TIMELINE_INJECT_SAVE');
    expect(content).toContain('bookmarkTimelineInsertedTweetIds');
    expect(content).toContain('renderBookmarkTimelineBadges');
    expect(styles).toContain('.xvm-bookmark-timeline-badge');
    expect(styles).toContain('.xvm-bti-cog');
    expect(styles).toContain('.xvm-bti-backdrop');
  });

  it('inserts cached bookmark entries after the configured number of timeline tweets', () => {
    const { cacheBookmarkTimelineEntries, injectBookmarkTimelineEntries } = loadApi();
    const cache = new Map();
    cacheBookmarkTimelineEntries(cache, 'folder-a', {
      data: {
        bookmark_timeline: {
          timeline: {
            instructions: [{ type: 'TimelineAddEntries', entries: [tweetEntry('90'), tweetEntry('91')] }],
          },
        },
      },
    });

    const patched = injectBookmarkTimelineEntries(homeTimeline(['1', '2', '3']), cache, {
      enabled: true,
      folderIds: ['folder-a'],
      every: 2,
    });

    const entries = patched.data.home.home_timeline_urt.instructions[0].entries;
    expect(entries.map((entry) => entry.content.itemContent.tweet_results.result.rest_id))
      .toEqual(['1', '2', '90', '3']);
    expect(entries[2].entryId).toMatch(/^xvm-bookmark-folder-a-90-/);
    expect(entries[2].content.entryType).toBe('TimelineTimelineItem');
    expect(entries[2].content.itemContent.itemType).toBe('TimelineTweet');
    expect(BigInt(entries[1].sortIndex)).toBeGreaterThan(BigInt(entries[2].sortIndex));
    expect(BigInt(entries[2].sortIndex)).toBeGreaterThan(BigInt(entries[3].sortIndex));
  });

  it('skips bookmark entries already present in the timeline response', () => {
    const { injectBookmarkTimelineEntries } = loadApi();
    const cache = new Map();
    cache.set('folder-a', [tweetEntry('2'), tweetEntry('90')]);

    const patched = injectBookmarkTimelineEntries(homeTimeline(['1', '2']), cache, {
      enabled: true,
      folderIds: ['folder-a'],
      every: 1,
    });

    const ids = patched.data.home.home_timeline_urt.instructions[0].entries
      .map((entry) => entry.content.itemContent.tweet_results.result.rest_id);
    expect(ids).toEqual(['1', '90', '2']);
  });

  it('targets the home timeline entries instead of earlier unrelated entry arrays', () => {
    const { injectBookmarkTimelineEntries } = loadApi();
    const cache = new Map([['folder-a', [tweetEntry('90')]]]);
    const timeline = {
      unrelated: { entries: [tweetEntry('999')] },
      ...homeTimeline(['1', '2']),
    };

    const patched = injectBookmarkTimelineEntries(timeline, cache, {
      enabled: true,
      folderIds: ['folder-a'],
      every: 1,
    });

    expect(patched.unrelated.entries.map((entry) => entry.content.itemContent.tweet_results.result.rest_id))
      .toEqual(['999']);
    expect(patched.data.home.home_timeline_urt.instructions[0].entries
      .map((entry) => entry.content.itemContent.tweet_results.result.rest_id))
      .toEqual(['1', '90', '2']);
  });

  it('does not inject anything until at least one folder is selected', () => {
    const { injectBookmarkTimelineEntries } = loadApi();
    const cache = new Map([['folder-a', [tweetEntry('90')]]]);
    const timeline = homeTimeline(['1', '2']);

    const patched = injectBookmarkTimelineEntries(timeline, cache, {
      enabled: true,
      folderIds: [],
      every: 1,
    });

    const ids = patched.data.home.home_timeline_urt.instructions[0].entries
      .map((entry) => entry.content.itemContent.tweet_results.result.rest_id);
    expect(ids).toEqual(['1', '2']);
  });
});
