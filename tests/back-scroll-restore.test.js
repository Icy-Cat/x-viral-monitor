// Back-navigation scroll-restore guard (content.js tail IIFE).
//
// Live-verified failure: on a conversation page with XVM-hidden replies,
// X's back-navigation restore loop compounds its relative scrollBy deltas
// (2 hidden cells: saved y≈1900 → settles ≈4534; 15 hidden cells: X issues
// the same +1171 delta 17× and lands ~500px off with the clicked reply
// above the viewport). The same failure hits home/list/profile → tweet →
// back when rate-filter hides re-collapse on remount. The guard records
// the true reading position per pageKey (status id on conversations,
// normalized pathname on feeds) — most precisely at pointerdown on the
// tweet being opened — and corrects, anchor-first, once X settles wrong.
// These tests run the extracted guard against a scripted fake DOM/clock.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const content = readFileSync(resolve(repo, 'content.js'), 'utf8');
const MARKER = '// Back-navigation scroll-restore guard.';
const guardSrc = content.slice(content.indexOf(MARKER));

const HIDE_SEL = '[data-xvm-content-filter-hidden], [data-xvm-rate-hidden]';

function makeArticle(h, { docTop, id }) {
  const art = {
    id,
    docTop,
    matches: () => false,
    closest: () => null,
    getBoundingClientRect: () => ({
      top: art.docTop - h.scrollY,
      bottom: art.docTop - h.scrollY + art.height,
      height: art.height,
    }),
    height: 100,
  };
  return art;
}

function makeHarness({ hiddenPresent = true } = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  let rafQ = [];
  const h = {
    clock: 0,
    scrollY: 0,
    scrollToCalls: [],
    hiddenPresent,
    articles: [],
  };
  const listen = (map) => (ev, fn) => {
    if (!map.has(ev)) map.set(ev, []);
    map.get(ev).push(fn);
  };
  const unlisten = (map) => (ev, fn) => {
    const l = map.get(ev) || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  h.pathname = '/someone/status/111';
  const win = {
    location: { get pathname() { return h.pathname; } },
    get scrollY() { return h.scrollY; },
    scrollTo(x, y) { h.scrollToCalls.push(Math.round(y)); h.scrollY = y; },
    addEventListener: listen(winListeners),
    removeEventListener: unlisten(winListeners),
  };
  h.styleEls = new Map();
  const doc = {
    querySelector: (sel) => (sel === HIDE_SEL && h.hiddenPresent ? {} : null),
    querySelectorAll: (sel) => (sel === 'article[data-testid="tweet"]' ? h.articles : []),
    addEventListener: listen(docListeners),
    removeEventListener: unlisten(docListeners),
    getElementById: (id) => h.styleEls.get(id) || null,
    createElement: () => {
      const el = { id: '', textContent: '', remove() { h.styleEls.delete(el.id); } };
      return el;
    },
    documentElement: { appendChild: (el) => { h.styleEls.set(el.id, el); } },
  };
  const ctx = {
    window: win,
    document: doc,
    performance: { now: () => h.clock },
    requestAnimationFrame: (cb) => { rafQ.push(cb); },
    getTweetIdFromArticle: (art) => art.id || null,
    setTimeout: (fn) => { h.pendingTimeouts.push(fn); return h.pendingTimeouts.length; },
    clearTimeout: () => {},
    Math,
    Map,
    Set,
    Infinity,
  };
  h.pendingTimeouts = [];
  vm.createContext(ctx);
  vm.runInContext(guardSrc, ctx);
  h.fire = (ev, detail = {}) => {
    for (const fn of [...(winListeners.get(ev) || [])]) fn({ type: ev, ...detail });
  };
  h.firePointerDown = (art) => {
    for (const fn of [...(docListeners.get('pointerdown') || [])]) {
      fn({ target: { closest: (sel) => (sel === 'article[data-testid="tweet"]' ? art : null) } });
    }
  };
  // One frame ≈ 16ms: advance the clock, then run everything queued.
  h.pumpFrames = (n) => {
    for (let i = 0; i < n; i++) {
      h.clock += 16;
      const q = rafQ;
      rafQ = [];
      for (const cb of q) cb();
    }
  };
  h.win = win;
  return h;
}

function recordAt(h, y) {
  h.scrollY = y;
  h.fire('scroll');
  h.pumpFrames(1); // record() commits on the next animation frame
}

describe('back-navigation scroll-restore guard', () => {
  it('corrects X\'s compounded restore back to the recorded anchor position', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900); // reading position: anchor A222 at viewport top 16

    // X's broken restore lands ~2600px past the reading position and stays.
    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(60); // ~960ms of quiet — settle threshold is 400/350ms

    // Anchor delta: top −2618 vs saved 16 → scrollTo(4534 − 2634) = 1900.
    expect(h.scrollToCalls).toContain(1900);
    expect(h.scrollY).toBe(1900);
  });

  it('prefers the tweet captured at pointerdown over scroll samples', () => {
    const h = makeHarness();
    const clicked = makeArticle(h, { docTop: 1424, id: 'B333' });
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' }), clicked];
    h.scrollY = 1224;
    h.firePointerDown(clicked); // user clicks B333 at viewport top 200
    // X's pre-navigation scrollIntoView churn fires scroll events that
    // would otherwise overwrite the click capture with junk geometry.
    recordAt(h, 534);

    h.scrollY = 1731; // X settles ~500px off (live 15-hidden-cell trace)
    h.fire('popstate');
    h.pumpFrames(60);

    // B333 back at viewport top 200 → scrollTo(1731 + (−307) − 200 + 307)… = 1224.
    expect(h.scrollY).toBe(1224);
  });

  it('fixes small errors the raw-offset check would tolerate', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900);

    h.scrollY = 1990; // only 90px off in scrollY, but wrong content on screen
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollY).toBe(1900);
  });

  it('leaves a pixel-accurate restore alone', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900);

    h.scrollY = 1912; // anchor delta 12px — within tolerance
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollToCalls).toEqual([]);
  });

  it('falls back to the raw saved offset when the anchor is collapsed', () => {
    const h = makeHarness();
    const art = makeArticle(h, { docTop: 1916, id: 'A222' });
    h.articles = [art];
    recordAt(h, 1900);

    art.height = 0; // anchor got filtered/collapsed after recording
    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollToCalls).toContain(1900); // scrollTo(want.y)
  });

  it('records nothing on pages without XVM-hidden cells', () => {
    const h = makeHarness({ hiddenPresent: false });
    const art = makeArticle(h, { docTop: 1916, id: 'A222' });
    h.articles = [art];
    h.scrollY = 1900;
    h.firePointerDown(art);
    recordAt(h, 1900);

    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollToCalls).toEqual([]); // guard never interferes
  });

  it('a user scroll gesture cancels the pending correction', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900);

    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(5); // still inside the settle window
    h.fire('wheel', { deltaX: 0, deltaY: 120 });
    h.pumpFrames(60);

    expect(h.scrollToCalls).toEqual([]);
  });

  it('inertial swipe-back wheel events (deltaX-dominant) do not cancel it', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900);

    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(5);
    h.fire('wheel', { deltaX: -48, deltaY: 3 }); // two-finger back gesture tail
    h.pumpFrames(60);

    expect(h.scrollY).toBe(1900);
  });

  it('veils the content column from popstate until the correction lands', () => {
    const h = makeHarness();
    h.articles = [makeArticle(h, { docTop: 1916, id: 'A222' })];
    recordAt(h, 1900);

    h.scrollY = 4534;
    h.fire('popstate');
    const veil = h.styleEls.get('xvm-restore-veil');
    expect(veil.textContent).toContain('opacity:0'); // masked immediately

    h.pumpFrames(60); // settle → correct → finish
    expect(h.scrollY).toBe(1900);
    expect(veil.textContent).toContain('transition'); // revealed with a fade
  });

  it('keeps working after the virtualizer unmounts every hidden cell', () => {
    const h = makeHarness();
    const art = makeArticle(h, { docTop: 1916, id: 'A222' });
    h.articles = [art];
    recordAt(h, 500); // markers mounted here — status remembered in hadHides

    h.hiddenPresent = false; // reading far away: markers virtualized out
    h.scrollY = 1224;
    h.firePointerDown(art); // click capture must still record…
    recordAt(h, 1900); // …and scroll samples must not erase it… (clickTs shield)
    h.pumpFrames(130); // …but after the shield lapses they may refresh it

    recordAt(h, 1900);
    h.scrollY = 4534;
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollY).toBe(1900); // corrected despite zero mounted markers
  });

  it('restores home timeline position after tweet → back', () => {
    const h = makeHarness();
    h.pathname = '/home';
    const clicked = makeArticle(h, { docTop: 1424, id: 'H777' });
    h.articles = [
      makeArticle(h, { docTop: 1000, id: 'H111' }),
      clicked,
      makeArticle(h, { docTop: 1800, id: 'H999' }),
    ];
    h.scrollY = 1224;
    h.firePointerDown(clicked); // click H777 at viewport top 200

    // Simulate leaving for the status page (URL changes; save must survive
    // under the /home key, not the status id).
    h.pathname = '/someone/status/H777';
    h.scrollY = 0;
    // Returning via back: popstate fires with /home already restored.
    h.pathname = '/home';
    h.scrollY = 3100; // X + rate-filter remount landed far from the click
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollY).toBe(1224);
  });

  it('normalizes "/" to the same key as "/home"', () => {
    const h = makeHarness();
    h.pathname = '/';
    const clicked = makeArticle(h, { docTop: 1424, id: 'H777' });
    h.articles = [clicked];
    h.scrollY = 1224;
    h.firePointerDown(clicked);

    h.pathname = '/home'; // X often canonicalizes to /home on return
    h.scrollY = 3100;
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollY).toBe(1224);
  });

  it('does not arm on home when no XVM hides are present', () => {
    const h = makeHarness({ hiddenPresent: false });
    h.pathname = '/home';
    const art = makeArticle(h, { docTop: 1424, id: 'H777' });
    h.articles = [art];
    h.scrollY = 1224;
    h.firePointerDown(art);
    recordAt(h, 1224);

    h.scrollY = 3100;
    h.fire('popstate');
    h.pumpFrames(60);

    expect(h.scrollToCalls).toEqual([]);
  });
});
