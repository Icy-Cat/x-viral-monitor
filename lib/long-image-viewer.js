// === Long Image Viewer for X ===
// Tall images (h/w > 2.0) in the photo modal are displayed at a fixed reading
// width with vertical scroll instead of zoom/pan. The companion image-viewer.js
// detects our `.xvm-liv-dialog` class and stands down, so the two never fight
// for the same image.
(() => {
  const RATIO_THRESHOLD = 2.0;
  const READING_WIDTH = 900;
  const PROCESSED = '__xvmLivDone';

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

  // Walk up to 16 ancestors and tag them so CSS can defeat X's nested
  // max-width / aspect-ratio / transform constraints.
  function markAncestors(img, dialog) {
    let el = img.parentElement;
    let depth = 0;
    while (el && el !== dialog && depth < 16) {
      el.classList.add('xvm-liv-ancestor');
      el = el.parentElement;
      depth++;
    }
  }

  // Pick the scroll container: the first ancestor whose height is in the
  // viewport-height band [0.55vh, 1.6vh]. That band catches X's modal image
  // panel without grabbing the whole dialog or a tiny inner wrapper.
  function refreshScroller(img, dialog) {
    const pick = () => {
      const vh = window.innerHeight;
      let el = img.parentElement;
      let depth = 0;
      let scroller = null;
      while (el && el !== dialog && depth < 16) {
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

  function processImg(img, dialog) {
    if (img[PROCESSED]) return;
    img[PROCESSED] = true;
    const ready = () => {
      if (isTall(img)) activate(img, dialog);
    };
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener('load', ready, { once: true });
  }

  function scanDialog(dialog) {
    const imgs = dialog.querySelectorAll('img');
    let foundTall = false;
    for (const img of imgs) {
      if (!isTwitterImage(img)) continue;
      if (img.complete && img.naturalWidth && isTall(img)) foundTall = true;
      processImg(img, dialog);
    }
    // If the current image isn't tall, make sure dialog-level marks are off so
    // image-viewer.js can do its zoom/pan thing on the next/prev wide image.
    if (!foundTall && dialog.classList.contains('xvm-liv-dialog')) {
      const stillTall = [...dialog.querySelectorAll('img.xvm-liv-img')]
        .some((i) => i.isConnected && isTall(i));
      if (!stillTall) deactivate(dialog);
    }
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
    check();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
