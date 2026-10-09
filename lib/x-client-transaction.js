// Use X's own transaction generator. Its obfuscated animation/fingerprint logic
// changes independently of the public algorithm ports. Loading the current
// ondemand.s through X's webpack runtime keeps signatures tied to this page's
// bundle, without eval, hard-coded module IDs, or captured Grok UI requests.
(() => {
  if (window.__xvmXct) return;
  let buildingPromise = null;
  const FRAME_SELECTOR = '[id^="loading-x-anim-"]';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function getRuntime(chunks) {
    let runtime;
    const entry = [[`xvm-xct-${crypto.randomUUID()}`], {}, (r) => { runtime = r; }];
    chunks.push(entry);
    const index = chunks.indexOf(entry);
    if (index >= 0) chunks.splice(index, 1);
    if (typeof runtime !== 'function' || typeof runtime.e !== 'function') {
      throw new Error('xct: X webpack runtime unavailable; refresh X and retry');
    }
    return runtime;
  }

  // Recreate only the SVG geometry required by the native generator, never
  // scripts, styles, links or event attributes from the fetched HTML.
  function makeFrames(homeDoc) {
    const host = document.createElement('div');
    host.hidden = true;
    const frames = Array.from(homeDoc.querySelectorAll(FRAME_SELECTOR));
    if (frames.length !== 4) throw new Error('xct: expected four X animation frames');
    for (const [i, source] of frames.entries()) {
      const paths = Array.from(source.querySelectorAll('path'));
      if (paths.length < 2) throw new Error('xct: X animation paths missing');
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.id = `loading-x-anim-${i}`;
      // Native variants select frames by an X CSS class rather than by ID.
      svg.setAttribute('class', source.getAttribute('class') || '');
      const group = document.createElementNS(SVG_NS, 'g');
      for (const path of paths) {
        const copy = document.createElementNS(SVG_NS, 'path');
        copy.setAttribute('d', path.getAttribute('d') || '');
        group.appendChild(copy);
      }
      svg.appendChild(group);
      host.appendChild(svg);
    }
    return host;
  }

  async function build() {
    const chunks = window.webpackChunk_twitter_responsive_web;
    if (!Array.isArray(chunks)) throw new Error('xct: X bundle not ready; refresh X and retry');
    const runtime = getRuntime(chunks);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let homeHtml;
    try {
      const fetchHome = window.__xvmNet?.originalFetch || window.fetch;
      const res = await fetchHome('https://x.com/', { credentials: 'include', signal: controller.signal });
      if (!res.ok) throw new Error(`xct: X home request failed (${res.status})`);
      homeHtml = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const idMatch = homeHtml.match(/["']?(\d+)["']?\s*:\s*["']ondemand\.s["']/);
    if (!idMatch) throw new Error('xct: ondemand.s chunk not found in X home');
    const chunkId = Number(idMatch[1]);
    // X's loader resolves its own hash (including current 16-character hashes).
    // Never build a CDN URL from a fixed-length hash regex.
    await runtime.e(chunkId);
    const chunk = chunks.find((entry) => entry[0]?.includes(chunkId));
    const moduleIds = Object.keys(chunk?.[1] || {});
    if (moduleIds.length !== 1) throw new Error('xct: unsupported X transaction module layout');
    const initialize = runtime(moduleIds[0])?.default;
    if (typeof initialize !== 'function') throw new Error('xct: X transaction initializer missing');
    const generate = initialize();
    if (typeof generate !== 'function') throw new Error('xct: X transaction generator missing');

    const homeDoc = new DOMParser().parseFromString(homeHtml, 'text/html');
    const verification = (doc) => doc.querySelector('meta[name="twitter-site-verification"]')?.getAttribute('content');
    // A fresh home response has its own verification key. The native module
    // reads the running page's key; only restore the static animation geometry.
    if (!verification(document)) {
      throw new Error('xct: X page context changed; refresh X and retry');
    }
    const host = makeFrames(homeDoc);
    // X normally consumes/removes these frames on its first API call. Protect
    // any frames it has not consumed yet while priming our separate instance.
    const originals = Array.from(document.querySelectorAll(FRAME_SELECTOR));
    const ids = originals.map((node) => node.id);
    const classes = originals.map((node) => node.getAttribute('class'));
    let pending;
    try {
      originals.forEach((node, i) => {
        node.id = `xvm-saved-frame-${i}`;
        node.removeAttribute('class');
      });
      document.body.appendChild(host);
      // Native animation sampling is synchronous, before its first digest await.
      pending = generate('/2/grok/add_response.json', 'POST');
    } finally {
      host.remove();
      originals.forEach((node, i) => {
        node.id = ids[i];
        if (classes[i] !== null) node.setAttribute('class', classes[i]);
      });
    }
    await pending;
    return generate;
  }

  function ensureReady() {
    if (!buildingPromise) {
      buildingPromise = build().catch((err) => {
        buildingPromise = null;
        throw err;
      });
    }
    return buildingPromise;
  }

  async function generateTxId(method, path) {
    const generate = await ensureReady();
    return generate(path, method);
  }

  function reset() { buildingPromise = null; }
  function warmup() { ensureReady().catch(() => {}); }
  window.__xvmXct = { generateTxId, ensureReady, reset, warmup };
})();
