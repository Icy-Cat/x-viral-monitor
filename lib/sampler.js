export const MAX_TRACK_AGE_MS = 48 * 60 * 60 * 1000;

const INTERVAL_TIERS = [
  { maxAgeMs: 1 * 60 * 60_000,  floorMs: 60_000      },
  { maxAgeMs: 6 * 60 * 60_000,  floorMs: 5 * 60_000  },
  { maxAgeMs: MAX_TRACK_AGE_MS, floorMs: 30 * 60_000 },
];

function intervalFloor(ageMs) {
  for (const t of INTERVAL_TIERS) if (ageMs <= t.maxAgeMs) return t.floorMs;
  return Infinity;
}

function deltaOf(current, last, key) {
  const d = (current[key] || 0) - (last[key] || 0);
  return d > 0 ? d : 0;
}

export function decide({ last, current, ageMs, nowMs }) {
  if (ageMs > MAX_TRACK_AGE_MS) {
    return { shouldWrite: false, reason: 'aged-out', deltas: null };
  }
  if (!last) {
    return {
      shouldWrite: true,
      reason: 'baseline',
      deltas: { d_likes: 0, d_retweets: 0, d_replies: 0, d_bookmarks: 0 },
    };
  }
  const deltas = {
    d_likes:     deltaOf(current, last, 'likes'),
    d_retweets:  deltaOf(current, last, 'retweets'),
    d_replies:   deltaOf(current, last, 'replies'),
    d_bookmarks: deltaOf(current, last, 'bookmarks'),
  };
  const hasEvent = deltas.d_likes + deltas.d_retweets + deltas.d_replies + deltas.d_bookmarks > 0;
  if (hasEvent) return { shouldWrite: true, reason: 'event', deltas };

  const sinceLast = nowMs - last.ts;
  if (sinceLast >= intervalFloor(ageMs)) {
    return { shouldWrite: true, reason: 'interval', deltas };
  }
  return { shouldWrite: false, reason: 'throttled', deltas };
}
