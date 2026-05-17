// === Long Image Viewer for X ===
// Tall images (h/w > 2.0) in the photo modal are displayed at a fixed reading
// width with vertical scroll instead of zoom/pan. The companion image-viewer.js
// detects our `.xvm-liv-dialog` class and stands down, so the two never fight
// for the same image.
//
// v1.6.10 multi-image fix (post-#9 codex root-cause):
//
//   - Only activate for the photo currently visible in the carousel (parsed
//     from `/photo/N` in location.pathname). Previous logic loop-processed
//     every `pbs.twimg.com/media` image in the dialog, including the
//     off-screen slides that X keeps in the DOM for swipe transitions.
//   - Always `deactivate()` before re-activating, so when the user clicks
//     next/prev nav the previous slide's `.xvm-liv-*` classes are stripped
//     and the new active image gets fresh markers.
//   - `markAncestors()` / `refreshScroller()` stop at X's carousel boundary
//     (swipe-to-dismiss / li[role=listitem] / ul[role=list] /
//     div[aria-roledescription=carousel]). The boundary node itself stays
//     unmarked. Without this gate the `width:100%; max-width:none;
//     transform:none` CSS rule below grew the slide containers to ~2x
//     viewport, eating the next/prev hit-test region and hiding the
//     subsequent image off-screen.
(() => {
  const RATIO_THRESHOLD = 2.0;
  const READING_WIDTH = 900;

  function isTwitterImage(img) {
    return /pbs\.twimg\.com\/media\//.test(img.src || '');
  }

  function isTall(img) {
    if (!img.naturalWidth || !img.naturalHeight) return false;
    return img.naturalHeight / img.naturalWidth > RATIO_THRESHOLD;
  }

  function upgradeQuality(img) {
    try {
      const url = new URL(img.src);
      if (url.hostname !== 'pbs.twimg.com') return;
      const name = url.searchParams.get('name');
      if (name && name !== '4096x4096' && name !== 'orig') {
        url.searchParams.set('name', '4096x4096');
        img.src = url.toString();
      }
    } catch (_) {}
  }

  // X's photo modal embeds its slides inside several carousel-machinery
  // nodes whose layout MUST stay unmodified — otherwise next/prev nav
  // breaks and the off-screen slide bleeds onto the screen. Stop walking
  // ancestors the moment we hit any of these.
  function isCarouselBoundary(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute('data-testid') === 'swipe-to-dismiss') return true;
    const role = el.getAttribute('role');
    if (role === 'list' || role === 'listitem' || role === 'group') return true;
    if (el.getAttribute('aria-roledescription') === 'carousel') return true;
    return false;
  }

  // Walk up to 16 ancestors and tag them so CSS can defeat X's nested
  // max-width / aspect-ratio / transform constraints. Stops (and does NOT
  // tag) at the first carousel boundary.
  function markAncestors(img, dialog) {
    let el = img.parentElement;
    let depth = 0;
    while (el && el !== dialog && depth < 16) {
      if (isCarouselBoundary(el)) break;
      el.classList.add('xvm-liv-ancestor');
      el = el.parentElement;
      depth++;
    }
  }

  // Pick the scroll container: the first ancestor whose height is in the
  // viewport-height band [0.55vh, 1.6vh]. That band catches X's modal image
  // panel without grabbing the whole dialog or a tiny inner wrapper. Same
  // carousel-boundary stop as markAncestors.
  function refreshScroller(img, dialog) {
    const pick = () => {
      const vh = window.innerHeight;
      let el = img.parentElement;
      let depth = 0;
      let scroller = null;
      while (el && el !== dialog && depth < 16) {
        if (isCarouselBoundary(el)) break;
        const h = el.getBoundingClientRect().height;
        if (!scroller && h >= vh * 0.55 && h <= vh * 1.6) scroller = el;
        el = el.parentElement;
        depth++;
      }
      if (!scroller) return false;
      dialog.querySelectorAll('.xvm-liv-scroll').forEach((e) => {
        if (e !== scroller) e.classList.remove('xvm-liv-scroll');
      });
      scroller.classList.add('xvm-liv-scroll');
      return true;
    };
    if (pick()) return;
    requestAnimationFrame(() => {
      if (pick()) return;
      setTimeout(pick, 200);
    });
  }

  function activate(img, dialog) {
    dialog.classList.add('xvm-liv-dialog');
    img.classList.add('xvm-liv-img');
    markAncestors(img, dialog);
    refreshScroller(img, dialog);
    upgradeQuality(img);

    // Wheel handler bound at dialog level (stable container); the scroller is
    // resolved per-event so React rerenders / next-prev nav don't break it.
    if (!dialog.__xvmLivWheelBound) {
      dialog.__xvmLivWheelBound = true;
      dialog.addEventListener('wheel', (e) => {
        const sc = dialog.querySelector('.xvm-liv-scroll');
        if (!sc) return;
        if (sc.scrollHeight > sc.clientHeight) {
          sc.scrollTop += e.deltaY;
          e.preventDefault();
          e.stopPropagation();
        }
      }, { capture: true, passive: false });
    }

    // X's "click backdrop to dismiss" only fires when e.target is the
    // swipe-to-dismiss element itself. Our scroller now covers that area, so
    // click events land on the scroller and X ignores them. Re-implement
    // dismissal via history.back() — that's how X's own modal close works
    // (the photo modal lives at /photo/N in the URL).
    if (!dialog.__xvmLivClickBound) {
      dialog.__xvmLivClickBound = true;
      dialog.addEventListener('click', (e) => {
        const sc = dialog.querySelector('.xvm-liv-scroll');
        if (!sc) return;
        // Only treat clicks landing on the scroller's own backdrop (not on
        // the image or any inner control) as a dismiss intent.
        if (e.target !== sc) return;
        e.preventDefault();
        e.stopPropagation();
        if (/\/photo\/\d+/.test(location.pathname)) {
          history.back();
        } else {
          // Fallback: synthesize Escape, which X's modal also listens to.
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
          }));
        }
      }, true);
    }
  }

  function deactivate(dialog) {
    dialog.classList.remove('xvm-liv-dialog');
    dialog.querySelectorAll('.xvm-liv-img').forEach((e) => e.classList.remove('xvm-liv-img'));
    dialog.querySelectorAll('.xvm-liv-ancestor').forEach((e) => e.classList.remove('xvm-liv-ancestor'));
    dialog.querySelectorAll('.xvm-liv-scroll').forEach((e) => e.classList.remove('xvm-liv-scroll'));
  }

  function isInViewport(img) {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0
      && r.right > 0 && r.left < window.innerWidth
      && r.bottom > 0 && r.top < window.innerHeight;
  }

  // Pick the image that the user is currently looking at. X keeps off-screen
  // carousel slides mounted; we only want the one visible at `/photo/N`.
  //
  // /photo/N is the PREFERRED hint, but X's URL is not strongly synced with
  // the carousel's transform state — during a swipe / arrow-key transition
  // location.pathname can be /photo/1 while the centered image is still
  // /photo/2's <img> (Codex caught this on bb-browser, see #dev:6b624dfe).
  // So we only trust the URL candidate if it's actually on-screen; otherwise
  // fall back to viewport-visible detection.
  function getActiveMediaImg(dialog) {
    const mediaImgs = [...dialog.querySelectorAll('img')].filter(isTwitterImage);
    if (mediaImgs.length === 0) return null;
    const m = location.pathname.match(/\/photo\/(\d+)/);
    if (m) {
      const candidate = mediaImgs[Number(m[1]) - 1];
      if (candidate && isInViewport(candidate)) return candidate;
    }
    return mediaImgs.find(isInViewport) || null;
  }

  function scanDialog(dialog) {
    const img = getActiveMediaImg(dialog);
    // No tall active image → tear down so image-viewer.js can run its
    // normal zoom/pan path on the wide slide and the off-screen tall
    // slide doesn't leak its LIV markers into the dialog.
    if (!img || !img.complete || !img.naturalWidth) {
      // Image not yet loaded — wait for it before deciding.
      if (img && !img.__xvmLivLoadBound) {
        img.__xvmLivLoadBound = true;
        img.addEventListener('load', () => scanDialog(dialog), { once: true });
      }
      if (dialog.classList.contains('xvm-liv-dialog')) deactivate(dialog);
      return;
    }
    if (!isTall(img)) {
      if (dialog.classList.contains('xvm-liv-dialog')) deactivate(dialog);
      return;
    }
    // Tall active image: ALWAYS clear previous slide's markers first.
    // activate() is idempotent on the wheel/click bindings (they live on
    // `dialog.__xvmLiv*Bound` guards), and markAncestors/refreshScroller
    // re-resolve from scratch. Without this clear, the prior slide's
    // `.xvm-liv-ancestor` / `.xvm-liv-scroll` classes leak into the next
    // photo and cause the bug user reported.
    deactivate(dialog);
    activate(img, dialog);
  }

  // Re-process when the modal swaps images (next/prev arrows).
  function watchDialog(dialog) {
    if (dialog.__xvmLivObserved) return;
    dialog.__xvmLivObserved = true;
    new MutationObserver(() => scanDialog(dialog))
      .observe(dialog, { childList: true, subtree: true });
  }

  function findDialog() {
    return document.querySelector('[role="dialog"][aria-modal="true"]');
  }

  function check() {
    const dialog = findDialog();
    if (!dialog) return;
    watchDialog(dialog);
    scanDialog(dialog);
  }

  function init() {
    let timer = null;
    new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 120);
    }).observe(document.body, { childList: true, subtree: true });
    // Also re-scan on URL change (next/prev arrows change /photo/N without
    // necessarily mutating the dialog subtree fast enough for our observer).
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        check();
      }
    }, 200);
    check();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
