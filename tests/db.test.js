import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, upsertTweet, putSample, getTweet, listTweets, getSamples, getLastSample } from '../lib/db.js';

beforeEach(async () => {
  indexedDB.deleteDatabase('viral-history');
});

describe('db', () => {
  it('upserts a tweet and reads it back', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', text: 'hi', created_at: 100, status: 'active' });
    const t = await getTweet(db, 't1');
    expect(t.author).toBe('foo');
  });

  it('writes samples ordered by [tweet_id, ts]', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', created_at: 0, status: 'active' });
    await putSample(db, { tweet_id: 't1', ts: 200, impressions: 50, likes: 1, retweets: 0, replies: 0, bookmarks: 0, d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
    await putSample(db, { tweet_id: 't1', ts: 100, impressions: 30, likes: 0, retweets: 0, replies: 0, bookmarks: 0, d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
    const samples = await getSamples(db, 't1');
    expect(samples.map((s) => s.ts)).toEqual([100, 200]);
    const last = await getLastSample(db, 't1');
    expect(last.ts).toBe(200);
  });

  it('listTweets returns all stored tweets', async () => {
    const db = await openDb();
    await upsertTweet(db, { tweet_id: 't1', author: 'foo', created_at: 0, status: 'active' });
    await upsertTweet(db, { tweet_id: 't2', author: 'bar', created_at: 0, status: 'active' });
    const all = await listTweets(db);
    expect(all.map((t) => t.tweet_id).sort()).toEqual(['t1', 't2']);
  });
});
