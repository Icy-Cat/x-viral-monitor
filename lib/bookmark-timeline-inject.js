// Bookmark timeline injection helpers. Loaded as a classic content script and
// exposed on window for content.js; tests execute the same file in a VM.
(() => {
  const api = {};

  function isObject(v) {
    return !!v && typeof v === 'object';
  }

  function getTweetId(entry) {
    const result = entry?.content?.itemContent?.tweet_results?.result;
    return result?.rest_id || result?.tweet?.rest_id || null;
  }

  function isTweetEntry(entry) {
    return !!getTweetId(entry)
      && entry?.content?.entryType === 'TimelineTimelineItem'
      && entry?.content?.itemContent?.itemType === 'TimelineTweet';
  }

  function findEntryArrays(obj, out = []) {
    if (!isObject(obj)) return out;
    if (Array.isArray(obj)) {
      for (const item of obj) findEntryArrays(item, out);
      return out;
    }
    if (Array.isArray(obj.entries) && obj.entries.some(isTweetEntry)) out.push(obj.entries);
    for (const value of Object.values(obj)) findEntryArrays(value, out);
    return out;
  }

  function cloneEntry(entry) {
    if (typeof structuredClone === 'function') return structuredClone(entry);
    return JSON.parse(JSON.stringify(entry));
  }

  function sortIndexBetween(prev, next) {
    try {
      const a = /^\d+$/.test(String(prev || '')) ? BigInt(prev) : null;
      const b = /^\d+$/.test(String(next || '')) ? BigInt(next) : null;
      if (a !== null && b !== null && a > b + 1n) return String((a + b) / 2n);
      if (a !== null && a > 0n) return String(a - 1n);
      if (b !== null) return String(b + 1n);
    } catch (_) {}
    return String(Date.now());
  }

  function cacheBookmarkTimelineEntries(cache, folderId, json) {
    if (!cache || !folderId || !isObject(json)) return 0;
    const entries = findEntryArrays(json).flat().filter(isTweetEntry);
    if (!entries.length) return 0;
    const seen = new Set();
    const unique = [];
    for (const entry of entries) {
      const id = getTweetId(entry);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(cloneEntry(entry));
    }
    if (unique.length) cache.set(String(folderId), unique);
    return unique.length;
  }

  function getHomeEntries(json) {
    const instructions = json?.data?.home?.home_timeline_urt?.instructions
      || json?.data?.home?.home_timeline?.instructions
      || [];
    for (const instruction of instructions) {
      if (Array.isArray(instruction?.entries) && instruction.entries.some(isTweetEntry)) {
        return instruction.entries;
      }
    }
    const arrays = findEntryArrays(json);
    return arrays.find((entries) => entries.length && entries.some(isTweetEntry)) || null;
  }

  function injectBookmarkTimelineEntries(json, cache, options = {}) {
    if (!options.enabled || !isObject(json) || !cache?.size) return json;
    const every = Math.max(1, Number.parseInt(options.every, 10) || 20);
    const folderIds = Array.isArray(options.folderIds) && options.folderIds.length
      ? options.folderIds.map(String)
      : [];
    if (!folderIds.length) return json;
    const sourceEntries = folderIds.flatMap((id) => (cache.get(id) || []).map((entry) => ({ folderId: id, entry })));
    if (!sourceEntries.length) return json;

    const target = getHomeEntries(json);
    if (!target) return json;
    const existingIds = new Set(target.map(getTweetId).filter(Boolean));
    const additions = sourceEntries.filter(({ entry }) => !existingIds.has(getTweetId(entry)));
    if (!additions.length) return json;

    const out = [];
    let tweetCount = 0;
    let addIdx = 0;
    for (const entry of target) {
      out.push(entry);
      if (!isTweetEntry(entry)) continue;
      tweetCount += 1;
      if (tweetCount % every !== 0 || addIdx >= additions.length) continue;
      const { folderId, entry: bookmarkEntry } = additions[addIdx++];
      const cloned = cloneEntry(bookmarkEntry);
      const tweetId = getTweetId(cloned) || addIdx;
      cloned.entryId = `xvm-bookmark-${folderId}-${tweetId}-${Date.now()}-${addIdx}`;
      cloned.sortIndex = sortIndexBetween(out[out.length - 1]?.sortIndex, entry?.sortIndex);
      out.push(cloned);
    }
    if (!addIdx) return json;
    target.splice(0, target.length, ...out);
    return json;
  }

  api.cacheBookmarkTimelineEntries = cacheBookmarkTimelineEntries;
  api.injectBookmarkTimelineEntries = injectBookmarkTimelineEntries;
  api._findEntryArrays = findEntryArrays;
  api._getTweetId = getTweetId;

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.__xvmBookmarkTimelineInject = api;
})();
