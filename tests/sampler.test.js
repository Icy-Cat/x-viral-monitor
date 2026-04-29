import { describe, it, expect } from 'vitest';
import { decide, MAX_TRACK_AGE_MS } from '../lib/sampler.js';

const baseMetrics = { impressions: 100, likes: 1, retweets: 0, replies: 0, bookmarks: 0 };

describe('decide()', () => {
  it('writes the first sample as baseline (no deltas counted as events)', () => {
    const r = decide({ last: null, current: baseMetrics, ageMs: 5 * 60_000, nowMs: 1000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('baseline');
    expect(r.deltas).toEqual({ d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 });
  });

  it('rejects sample after MAX_TRACK_AGE_MS', () => {
    const r = decide({ last: { ts: 0, ...baseMetrics }, current: baseMetrics, ageMs: MAX_TRACK_AGE_MS + 1, nowMs: 1 });
    expect(r.shouldWrite).toBe(false);
    expect(r.reason).toBe('aged-out');
  });

  it('writes when interval-floor reached (0-1h: 60s)', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: baseMetrics, ageMs: 30 * 60_000, nowMs: 1000 + 60_000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('interval');
  });

  it('does NOT write within interval-floor when no engagement change', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: { ...baseMetrics, impressions: 105 }, ageMs: 30 * 60_000, nowMs: 1000 + 30_000 });
    expect(r.shouldWrite).toBe(false);
    expect(r.reason).toBe('throttled');
  });

  it('writes immediately when likes increase, even within interval-floor', () => {
    const last = { ts: 1000, ...baseMetrics };
    const r = decide({ last, current: { ...baseMetrics, likes: 4 }, ageMs: 30 * 60_000, nowMs: 1000 + 5_000 });
    expect(r.shouldWrite).toBe(true);
    expect(r.reason).toBe('event');
    expect(r.deltas.d_likes).toBe(3);
  });

  it('clamps negative deltas to zero (API regressions)', () => {
    const last = { ts: 1000, ...baseMetrics, retweets: 10 };
    const r = decide({ last, current: { ...baseMetrics, retweets: 7 }, ageMs: 60_000, nowMs: 1000 + 90_000 });
    expect(r.deltas.d_retweets).toBe(0);
  });

  it('uses 1-6h interval floor (5 min)', () => {
    const last = { ts: 0, ...baseMetrics };
    const r1 = decide({ last, current: baseMetrics, ageMs: 2 * 60 * 60_000, nowMs: 4 * 60_000 });
    expect(r1.shouldWrite).toBe(false);
    const r2 = decide({ last, current: baseMetrics, ageMs: 2 * 60 * 60_000, nowMs: 6 * 60_000 });
    expect(r2.shouldWrite).toBe(true);
  });

  it('uses 6-48h interval floor (30 min)', () => {
    const last = { ts: 0, ...baseMetrics };
    const r1 = decide({ last, current: baseMetrics, ageMs: 12 * 60 * 60_000, nowMs: 20 * 60_000 });
    expect(r1.shouldWrite).toBe(false);
    const r2 = decide({ last, current: baseMetrics, ageMs: 12 * 60 * 60_000, nowMs: 31 * 60_000 });
    expect(r2.shouldWrite).toBe(true);
  });
});
