const URL_RE = /(?:^|\/\/)(?:www\.|m\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/;
const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;

export function normalizeHandle(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const urlMatch = s.match(URL_RE);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const hMatch = s.match(HANDLE_RE);
  if (hMatch) return hMatch[1].toLowerCase();
  return null;
}

export function isSubscribed(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return list.includes(h);
}

export function addSubscription(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return list;
  if (list.includes(h)) return list;
  return [...list, h];
}

export function removeSubscription(list, handle) {
  const h = normalizeHandle(handle);
  if (!h) return list;
  return list.filter((x) => x !== h);
}
