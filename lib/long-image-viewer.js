// === Long Image Viewer for X ===
// Tall images (h/w > RATIO_THRESHOLD; currently 3.0) in the photo modal are
// displayed at a fixed reading width with vertical scroll instead of zoom/pan.
// The companion image-viewer.js detects our `.xvm-liv-dialog` class and stands
// down, so the two never fight for the same image. image-viewer.js reads our
// RATIO_THRESHOLD off `window.__xvmLiv` to stay lock-step (#44 防回归).
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
  // Ratio threshold for activating LIV's "expand to reading width" mode.
  //
  // Why 3.0 (not 2.0): @Codex bb-browser repro on
  // https://x.com/ChappelDae55911/status/2056354028137939232 showed two
  // phone screenshots at 942×2048 (ratio 2.17) being treated as "tall"
  // by the previous 2.0 threshold. LIV then expanded the slide wrapper
  // to 1495px and centered the image at 900px wide, which threw off X's
  // own carousel transform (still calculated for the native ~413px-wide
  // image) and left the active slide cropped/off-screen.
  //
  // 3.0 covers extreme-ratio cases that genuinely need scroll-mode
  // reading (e.g. 207×2048 ratio 9.89 from earlier test corpus) without
  // catching medium phone screenshots that look fine in X's native
  // zoom/pan flow. If users later want a narrow-but-medium-tall mode
  // (e.g. 600×1400, ratio 2.33), implement that as a separate overlay
  // rather than reusing this expand-the-wrapper strategy — that path
  // is intrinsically incompatible with X's carousel transform.
  const RATIO_THRESHOLD = 3.0;
  const READING_WIDTH = 900;
  // Exposed so image-viewer.js can read the same value without drift.
  // image-viewer.js loads AFTER us per manifest content_scripts order, so
  // this is always populated by the time it reads. (Codex review gate #44:
  // prevent the 2.0/3.0 drift that caused v1.6.11 regression from recurring.)
  window.__xvmLiv = Object.assign(window.__xvmLiv || {}, { RATIO_THRESHOLD });

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
  // /photo/N is the AUTHORITATIVE target whenever the URL is in photo-modal
  // form: only that candidate, and only if it's on-screen, qualifies as the
  // active image. Critically, when URL says /photo/2 but candidate hasn't
  // slid into viewport yet (mid-transition), we MUST return null — falling
  // back to "any visible image" would pick the still-visible previous
  // slide and re-activate LIV on it (Codex caught this on bb-browser v2.0,
  // see #dev:6b624dfe).
  //
  // The viewport fallback is only used when the URL lacks /photo/N
  // entirely (e.g. dialog-style modals not driven by photo route).
  function getActiveMediaImg(dialog) {
    const mediaImgs = [...dialog.querySelectorAll('img')].filter(isTwitterImage);
    if (mediaImgs.length === 0) return null;
    const m = location.pathname.match(/\/photo\/(\d+)/);
    if (m) {
      const candidate = mediaImgs[Number(m[1]) - 1];
      // Candidate exists but not yet visible → return null and let scan
      // deactivate. The path-poll / mutation-observer / scheduled retries
      // below will re-run scan once the transform settles.
      if (candidate) return isInViewport(candidate) ? candidate : null;
      // Index out of range (DOM mid-mount). Allow viewport fallback in
      // this narrow case — better than freezing on null.
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
    // Already-active fast path: if this exact img is already LIV-active and
    // a scroller is in place, only refresh the scroller pick (carousel
    // settle / window resize might have changed the right ancestor band).
    // Skipping the deactivate→activate dance preserves the user's current
    // scrollTop so they don't lose their reading position to a no-op
    // mutation observer tick.
    if (img.classList.contains('xvm-liv-img')
        && dialog.querySelector('.xvm-liv-scroll')) {
      refreshScroller(img, dialog);
      return;
    }
    // Tall active image (new or returning): clear previous slide's markers
    // first. activate() is idempotent on the wheel/click bindings (they
    // live on `dialog.__xvmLiv*Bound` guards), and markAncestors/
    // refreshScroller re-resolve from scratch.
    deactivate(dialog);
    activate(img, dialog);
  }

  // Run check now + at three staggered delays. Used after URL changes and
  // after next/prev button clicks — both events have ~200-1000ms of carousel
  // transform animation following them during which getActiveMediaImg
  // returns null. Without the staggered retries LIV would stay deactivated
  // permanently for the new slide.
  function scheduleSettleChecks() {
    check();
    setTimeout(check, 250);
    setTimeout(check, 600);
    setTimeout(check, 1000);
  }

  // Re-process when the modal swaps images (next/prev arrows).
  function watchDialog(dialog) {
    if (dialog.__xvmLivObserved) return;
    dialog.__xvmLivObserved = true;
    new MutationObserver(() => scanDialog(dialog))
      .observe(dialog, { childList: true, subtree: true });

    // Capture-phase listener on X's prev/next button clicks. The URL-poll
    // (every 200ms) is too sparse for snappy re-activation when the user
    // navigates back to a tall image; the click event fires synchronously
    // with the user's intent, and scheduleSettleChecks covers the 0-1000ms
    // transform-settle window after that. Match aria-label across en/zh.
    dialog.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest
        ? e.target.closest('button, [role="button"]')
        : null;
      if (!btn) return;
      const label = btn.getAttribute('aria-label') || '';
      if (/上一张|下一张|Previous|Next/i.test(label)) {
        scheduleSettleChecks();
      }
    }, true);
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
    // Uses scheduleSettleChecks() which spans 0 / 250 / 600 / 1000ms — the
    // carousel transform can take that long to settle, and during the
    // window getActiveMediaImg() returns null because the target slide is
    // still off-screen.
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        scheduleSettleChecks();
      }
    }, 200);
    check();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
