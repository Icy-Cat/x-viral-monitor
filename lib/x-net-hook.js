// X net-hook: single chokepoint for fetch + XHR observation.
//
// Modules register `onRequest(matcher, fn)` / `onResponse(matcher, fn)` to be
// notified when X's bundle (or anything else on the page) issues HTTP calls.
// Centralising the wrap means we only patch window.fetch / XMLHttpRequest
// once and concerns (star chart capture, tweet scanning, rate-limit reports,
// bearer cache) can subscribe independently.
//
// Exposes `window.__xvmNet`:
//   originalFetch          : reference to the unhooked native fetch
//   onRequest(re, cb)      : cb({ url, init, headers, source })
//                              fetch source: fired before send (can read
//                                            outgoing headers; can NOT yet
//                                            mutate them — defensive use only)
//                              xhr   source: fired AT load time (i.e. after
//                                            the response is back). Safe for
//                                            reading the final header set;
//                                            do NOT use for blocking/modifying.
//   onResponse(re, cb)     : cb({ url, response, source })
//                              fetch source: response is a real Response
//                              xhr   source: response = {
//                                status, getHeader(name), text(), json()
//                              }
//   getBearer()            : latest "authorization: Bearer ..." seen on any X
//                            API request (auto-tracked from outgoing headers)

(() => {
  // On hot-reload, content.js re-runs and re-registers subscribers. Clear the
  // old list so we don't double up — the previous instance's `__xvmNet` keeps
  // its closed-over arrays, but we expose a reset entrypoint.
  if (window.__xvmNet) {
    window.__xvmNet._resetSubs();
    return;
  }

  const reqSubs = []; // [{ matcher, fn }]
  const resSubs = [];
  let latestBearer = null;

  function notifyReq(url, init, headers, source) {
    if (!url) return;
    for (const sub of reqSubs) {
      if (!sub.matcher.test(url)) continue;
      try { sub.fn({ url, init, headers, source }); } catch (_) {}
    }
  }

  function notifyRes(url, response, source) {
    if (!url) return;
    for (const sub of resSubs) {
      if (!sub.matcher.test(url)) continue;
      try { sub.fn({ url, response, source }); } catch (_) {}
    }
  }

  function trackBearer(headers) {
    // headers passed here is always normalized to lowercase keys.
    const auth = headers?.authorization;
    if (auth) latestBearer = auth;
  }

  function extractUrl(input) {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    if (typeof input === 'string') return input;
    return null;
  }

  // Normalize any header source into a plain object with lowercased keys.
  // Subscribers can rely on `headers['x-foo']` regardless of how the caller
  // originally supplied them (Headers instance, Request object, plain object
  // with mixed case).
  function normalize(headersLike) {
    const out = {};
    if (!headersLike) return out;
    try {
      if (headersLike instanceof Headers) {
        headersLike.forEach((v, k) => { out[k.toLowerCase()] = v; });
      } else if (typeof headersLike === 'object') {
        for (const k of Object.keys(headersLike)) {
          out[k.toLowerCase()] = headersLike[k];
        }
      }
    } catch (_) {}
    return out;
  }

  // === fetch ===
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = extractUrl(args[0]);
    const init = args[1] || {};
    let raw = null;
    if (init.headers) raw = init.headers;
    else if (args[0] instanceof Request) raw = args[0].headers;
    const headers = normalize(raw);
    trackBearer(headers);
    notifyReq(url, init, headers, 'fetch');
    const response = await originalFetch.apply(this, args);
    notifyRes(url, response, 'fetch');
    return response;
  };

  // === XHR ===
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const urlStr = url instanceof URL ? url.href : (typeof url === 'string' ? url : null);
    this.__xvmNet = { method, url: urlStr, headers: {} };
    if (urlStr) {
      this.addEventListener('load', function () {
        const xhr = this;
        // Fire request notification at load time (we now have the full set of
        // headers the caller installed via setRequestHeader). Then response.
        notifyReq(urlStr, { method: xhr.__xvmNet.method }, xhr.__xvmNet.headers, 'xhr');
        notifyRes(urlStr, {
          status: xhr.status,
          getHeader: (n) => xhr.getResponseHeader(n),
          text: () => xhr.responseText,
          json: () => JSON.parse(xhr.responseText),
        }, 'xhr');
      });
    }
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__xvmNet) {
      this.__xvmNet.headers[String(name).toLowerCase()] = value;
      if (/^authorization$/i.test(name) && value) latestBearer = value;
    }
    return xhrSetH.apply(this, arguments);
  };

  window.__xvmNet = {
    originalFetch,
    onRequest(matcher, fn) { reqSubs.push({ matcher, fn }); },
    onResponse(matcher, fn) { resSubs.push({ matcher, fn }); },
    getBearer: () => latestBearer,
    _resetSubs() { reqSubs.length = 0; resSubs.length = 0; },
  };
})();
