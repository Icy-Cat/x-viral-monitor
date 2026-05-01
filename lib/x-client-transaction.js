// X Client Transaction ID generator.
//
// Replicates the algorithm X's web bundle uses to compute the
// `x-client-transaction-id` header that gates calls to anti-abuse-protected
// endpoints (such as /2/grok/add_response.json on grok.x.com). Without a
// path-bound tx-id the server returns 404 with code 34.
//
// Pipeline:
//   1. Fetch x.com home HTML, extract:
//        a) twitter-site-verification meta value (base64 → keyBytes)
//        b) webpack chunk map: id named "ondemand.s" → its hash
//        c) four `<g id="loading-x-anim-N">` SVG groups; the *second* <path>
//           in each is the animation curve data
//   2. Fetch the on-demand JS chunk, parse `(w[NN], 16)` patterns to recover
//      the row index and key-byte indices used during animation evaluation
//   3. Compute animationKey by picking one frame (chosen by keyBytes[5] % 4),
//      slicing its curve points, and running them through cubic-bezier +
//      linear interpolation + rotation matrix → hex string
//   4. Per request: SHA-256(`${method}!${path}!${time}${KEYWORD}${animKey}`),
//      mix with keyBytes/timeBytes/random byte, base64 encode
//
// References:
//   - https://github.com/iSarabjitDhiman/XClientTransaction (Python)
//   - https://github.com/swyxio/XClientTransactionJS (JS port)

(() => {
  if (window.__xvmXct) return; // idempotent on hot reload

  // X bundle constants — historically stable for years but X *can* rotate them.
  // If every generated tx-id starts returning 404, these are the first suspects:
  // diff a fresh capture from x.com/i/grok against this file.
  const EPOCH = 1682924400000;
  const DEFAULT_KEYWORD = 'obfiowerehiring';
  const ADDITIONAL_RANDOM_NUMBER = 3;
  const INDICES_REGEX = /\(\w\[(\d{1,2})\],\s*16\)/g;
  const ON_DEMAND_BASE = 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.';

  // Memory-only cache. We deliberately don't persist to localStorage:
  // keyBytes / animationKey are tied to the running X bundle, and X redeploys
  // (or session-bound bundle variants) can invalidate them at any time.
  // Reusing a stale cached pair after a deploy produces silent 404s. The
  // ~200-400ms home + on-demand fetch only happens once per page load anyway.
  let cached = null;          // { keyBytes, animationKey }
  let buildingPromise = null;

  function isOdd(n) { return n % 2 ? -1.0 : 0.0; }

  function mathRound(num) {
    const x = Math.floor(num);
    return (num - x) >= 0.5 ? Math.ceil(num) : Math.sign(num) * x;
  }

  function floatToHex(x) {
    const out = [];
    let q = Math.trunc(x);
    let frac = x - q;
    while (q > 0) {
      const nq = Math.trunc(q / 16);
      const r = q - nq * 16;
      out.unshift(r > 9 ? String.fromCharCode(r + 55) : String(r));
      q = nq;
    }
    if (frac === 0) return out.join('');
    out.push('.');
    let f = frac;
    while (f > 0) {
      f *= 16;
      const i = Math.trunc(f);
      f -= i;
      out.push(i > 9 ? String.fromCharCode(i + 55) : String(i));
    }
    return out.join('');
  }

  function base64Encode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }

  function rotationMatrix(rot) {
    const r = rot * Math.PI / 180;
    return [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)];
  }

  function interpolate(a, b, f) {
    const out = [];
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) out.push(a[i] * (1 - f) + b[i] * f);
    return out;
  }

  function cubicCalc(a, b, m) {
    return 3 * a * (1 - m) * (1 - m) * m + 3 * b * (1 - m) * m * m + m * m * m;
  }

  function cubicValue(curves, time) {
    if (time <= 0) {
      let g = 0;
      if (curves[0] > 0) g = curves[1] / curves[0];
      else if (curves[1] === 0 && curves[2] > 0) g = curves[3] / curves[2];
      return g * time;
    }
    if (time >= 1) {
      let g = 0;
      if (curves[2] < 1) g = (curves[3] - 1) / (curves[2] - 1);
      else if (curves[2] === 1 && curves[0] < 1) g = (curves[1] - 1) / (curves[0] - 1);
      return 1 + g * (time - 1);
    }
    let s = 0, e = 1, m = 0;
    while (s < e) {
      m = (s + e) / 2;
      const x = cubicCalc(curves[0], curves[2], m);
      if (Math.abs(time - x) < 1e-5) return cubicCalc(curves[1], curves[3], m);
      if (x < time) s = m; else e = m;
    }
    return cubicCalc(curves[1], curves[3], m);
  }

  async function sha256Bytes(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf));
  }

  // Use unhooked native fetch so xct's own home/on-demand requests don't
  // round-trip through net-hook subscribers (they wouldn't match anything
  // today, but xct is a low-level dep — it shouldn't feed the observation pipe).
  function rawFetch(url, init) {
    const f = window.__xvmNet?.originalFetch || window.fetch;
    return f(url, init);
  }

  async function build() {
    const homeHtml = await (await rawFetch('https://x.com/', { credentials: 'include' })).text();

    // Resolve chunk id → hash for "ondemand.s". X's home page has two parallel
    // chunk maps: a name table (`<id>:"ondemand.s"`) and a hash table
    // (`<id>:"<hex>"`), with the hash table appearing after the name table.
    // We locate the chunk id from the name table, then take the LAST matching
    // hash entry to skip past the name table.
    const idMatch = homeHtml.match(/(\d+)\s*:\s*['"]ondemand\.s['"]/);
    if (!idMatch) throw new Error('xct: chunk id for "ondemand.s" not found');
    const chunkId = idMatch[1];
    const hashRe = new RegExp(chunkId + ':"([a-f0-9]{6,12})"', 'g');
    let hash = null;
    let m;
    while ((m = hashRe.exec(homeHtml)) !== null) hash = m[1];
    if (!hash) throw new Error('xct: hash for chunk ' + chunkId + ' not found');

    const odJs = await (await rawFetch(ON_DEMAND_BASE + hash + 'a.js')).text();
    const indices = [...odJs.matchAll(INDICES_REGEX)].map((mm) => parseInt(mm[1], 10));
    if (indices.length < 2) throw new Error('xct: indices not found in on-demand JS');
    const rowIndex = indices[0];
    const keyBytesIndices = indices.slice(1);

    const keyMatch = homeHtml.match(/<meta[^>]*name=['"]twitter-site-verification['"][^>]*content=['"]([^'"]+)['"]/);
    if (!keyMatch) throw new Error('xct: twitter-site-verification meta missing');
    const keyBytes = Array.from(atob(keyMatch[1]), (c) => c.charCodeAt(0));

    // Each `<g id="loading-x-anim-N">` contains two paths: the first is the
    // static X logo, the second is the animation curve data. Take the second.
    const groupRe = /id=['"]loading-x-anim-\d+['"][^>]*>([\s\S]*?)<\/g>/g;
    const frames = [];
    let g;
    while ((g = groupRe.exec(homeHtml)) !== null) {
      const paths = [...g[1].matchAll(/<path[^>]*d=['"]([^'"]+)['"]/g)].map((x) => x[1]);
      if (paths[1]) frames.push(paths[1]);
    }
    if (frames.length < 4) throw new Error('xct: not enough animation frames (' + frames.length + ')');

    const path = frames[keyBytes[5] % 4];
    // Strip the leading move command (e.g. "M 10,30 ") which has variable
    // length depending on coordinate digits. The original Python ref hard-coded
    // path[9:]; regex makes it robust to coord-length changes.
    const arr2d = path.replace(/^M\s*\d+\s*,\s*\d+\s+/i, '').split('C').map((s) =>
      s.replace(/[^\d]+/g, ' ').trim().split(/\s+/).map(Number)
    );

    const totalTime = 4096;
    const rIdx = keyBytes[rowIndex] % 16;
    const frameTime = keyBytesIndices.reduce((a, i) => a * (keyBytes[i] % 16), 1);
    const roundedFT = mathRound(frameTime / 10) * 10;
    const frameRow = arr2d[rIdx % arr2d.length];
    const targetTime = roundedFT / totalTime;

    const animationKey = computeAnimationKey(frameRow, targetTime);
    return { keyBytes, animationKey };
  }

  function solve(v, mn, mx, round) {
    const x = v * (mx - mn) / 255 + mn;
    return round ? Math.floor(x) : Math.round(x * 100) / 100;
  }

  function computeAnimationKey(frameRow, targetTime) {
    const fc = frameRow.slice(0, 3).map(Number).concat([1]);
    const tc = frameRow.slice(3, 6).map(Number).concat([1]);
    const fRot = [0.0];
    const tRot = [solve(frameRow[6], 60, 360, true)];
    const curveCoeffs = frameRow.slice(7).map((v, i) => solve(v, isOdd(i), 1.0, false));
    const val = cubicValue(curveCoeffs, targetTime);
    const color = interpolate(fc, tc, val).map((v) => Math.max(0, Math.min(255, v)));
    const rot = interpolate(fRot, tRot, val);
    const mat = rotationMatrix(rot[0]);
    const sa = color.slice(0, 3).map((v) => Math.round(v).toString(16));
    for (const v of mat) {
      let r = Math.round(v * 100) / 100;
      if (r < 0) r = -r;
      const h = floatToHex(r);
      sa.push(h.startsWith('.') ? ('0' + h).toLowerCase() : (h || '0'));
    }
    sa.push('0', '0');
    return sa.join('').replace(/[.-]/g, '');
  }

  async function ensureReady() {
    if (cached) return cached;
    if (!buildingPromise) {
      buildingPromise = build().catch((err) => {
        buildingPromise = null;
        throw err;
      });
    }
    cached = await buildingPromise;
    return cached;
  }

  async function generateTxId(method, path) {
    const ctx = await ensureReady();
    const t = Math.floor((Date.now() - EPOCH) / 1000);
    const tBytes = [t & 0xFF, (t >> 8) & 0xFF, (t >> 16) & 0xFF, (t >> 24) & 0xFF];
    const hashBytes = await sha256Bytes(`${method}!${path}!${t}${DEFAULT_KEYWORD}${ctx.animationKey}`);
    const rnd = Math.floor(Math.random() * 256);
    const arr = [...ctx.keyBytes, ...tBytes, ...hashBytes.slice(0, 16), ADDITIONAL_RANDOM_NUMBER];
    const out = [rnd, ...arr.map((b) => b ^ rnd)];
    return base64Encode(Uint8Array.from(out)).replace(/=+$/, '');
  }

  function reset() {
    cached = null;
    buildingPromise = null;
  }

  // Optionally pre-warm so the first user-triggered call doesn't pay the
  // home + on-demand fetch latency.
  function warmup() { ensureReady().catch(() => {}); }

  window.__xvmXct = { generateTxId, ensureReady, reset, warmup };
})();
