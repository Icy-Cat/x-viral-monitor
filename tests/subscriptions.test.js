import { describe, it, expect } from 'vitest';
import { normalizeHandle, addSubscription, removeSubscription, isSubscribed } from '../lib/subscriptions.js';

describe('normalizeHandle', () => {
  it('strips leading @ and lowercases', () => {
    expect(normalizeHandle('@ElonMusk')).toBe('elonmusk');
    expect(normalizeHandle('sama')).toBe('sama');
  });
  it('extracts handle from x.com URL', () => {
    expect(normalizeHandle('https://x.com/paulg/status/123')).toBe('paulg');
    expect(normalizeHandle('https://twitter.com/sama')).toBe('sama');
  });
  it('returns null for invalid input', () => {
    expect(normalizeHandle('')).toBe(null);
    expect(normalizeHandle('   ')).toBe(null);
    expect(normalizeHandle(null)).toBe(null);
  });
});

describe('addSubscription / removeSubscription / isSubscribed', () => {
  it('adds, dedupes, and removes', () => {
    let list = [];
    list = addSubscription(list, '@Foo');
    list = addSubscription(list, 'foo'); // dedupe
    list = addSubscription(list, '@bar');
    expect(list).toEqual(['foo', 'bar']);
    expect(isSubscribed(list, '@FOO')).toBe(true);
    list = removeSubscription(list, '@foo');
    expect(list).toEqual(['bar']);
  });
  it('ignores invalid handles', () => {
    expect(addSubscription(['foo'], '')).toEqual(['foo']);
    expect(addSubscription(['foo'], null)).toEqual(['foo']);
  });
});
