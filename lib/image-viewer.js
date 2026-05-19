// === Enhanced Image Viewer for X ===
// Adds zoom (wheel), pan (drag), and double-click toggle to X's native lightbox.
// X renders photos via a background-image div; the <img> is 0x0 (accessibility only).
(() => {
  const MIN_SCALE = 1;
  const MAX_SCALE = 8;
  const ZOOM_FACTOR = 0.12;

  let active = false;
  let visualDiv = null;
  let clipContainer = null;
  let swipeContainer = null; // cached [data-testid="swipe-to-dismiss"]
  let overflowEls = [];
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let dragX0 = 0;
  let dragY0 = 0;
  let dragTX0 = 0;
  let dragTY0 = 0;
  let origTransform = '';
  let indicatorEl = null;
  let indicatorTimer = null;
  let overflowUnlocked = false;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Single source of truth for the tall-image ratio is long-image-viewer.js
  // (window.__xvmLiv.RATIO_THRESHOLD). Fallback 3.0 only kicks in if LIV
  // failed to load — defensive only. See #44 v1.6.12 release for rationale.
  const LIV_RATIO_THRESHOLD = window.__xvmLiv?.RATIO_THRESHOLD ?? 3.0;

  // === Multi-image carousel awareness (#44 v1.6.13) ===
  // X mounts every photo in a multi-image tweet as a sibling
  // [data-testid="swipe-to-dismiss"] inside the dialog, only one of which
  // is currently on-screen. Previous logic that called
  //   document.querySelector('[data-testid="swipe-to-dismiss"]')
  // / dialog.querySelectorAll('img')
  // collapsed all of them and produced two bugs:
  //   (a) hasTallImage() false-positive: an offscreen ratio-9.89 sibling
  //       made image-viewer bail even when the visible image was ratio 0.75
  //   (b) findVisual() false-positive: the first DOM swipe (which may be
  //       offscreen) was always selected as the zoom target, so events
  //       never landed on it.
  // Fix: every lookup goes through getActiveSwipe(), which mirrors LIV's
  // active-only logic — /photo/N authoritative if present and in viewport,
  // viewport fallback only when URL lacks /photo/N.
  function isInViewport(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0
      && r.right > 0 && r.left < window.innerWidth
      && r.bottom > 0 && r.top < window.innerHeight;
  }

  function getActiveSwipe() {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return null;
    const swipes = [...dialog.querySelectorAll('[data-testid="swipe-to-dismiss"]')];
    if (!swipes.length) return null;
    const m = location.pathname.match(/\/photo\/(\d+)/);
    if (m) {
      const candidate = swipes[Number(m[1]) - 1];
      // Candidate exists but is mid-carousel-transition off-screen: return
      // null and let the next observer/check tick re-attempt. Falling back
      // to the first visible sibling would re-bind to the OLD slide.
      if (candidate) return isInViewport(candidate) ? candidate : null;
      // /photo/N is out of range (DOM mid-mount). Allow viewport fallback.
    }
    return swipes.find(isInViewport) || null;
  }

  // Long-image-viewer claims tall screenshots. We check the ACTIVE swipe
  // only — not the whole dialog — so an offscreen tall sibling does not
  // make us bail when the visible image is a normal-ratio photo (#44).
  function hasTallImage() {
    const swipe = getActiveSwipe();
    if (!swipe) return false;
    // If the active swipe is already LIV-marked, defer immediately. This
    // is narrower than the previous dialog-wide check — stale LIV state on
    // an offscreen slide will no longer falsely starve us.
    if (swipe.querySelector('.xvm-liv-img')) return true;
    const imgs = swipe.querySelectorAll('img');
    for (const img of imgs) {
      if (!/pbs\.twimg\.com\/media/.test(img.src || '')) continue;
      if (img.naturalWidth && img.naturalHeight / img.naturalWidth > LIV_RATIO_THRESHOLD) return true;
    }
    return false;
  }

  // Don't rely on aria-label (it's localized: "Image", "图像", etc.)
  // Find the background-image div inside the CURRENTLY VISIBLE swipe.
  function findVisual() {
    const swipe = getActiveSwipe();
    if (!swipe) return null;
    const divs = swipe.querySelectorAll('div');
    for (const d of divs) {
      if ((d.style.backgroundImage || '').includes('pbs.twimg.com')) return d;
    }
    return null;
  }

  function enhance(vis) {
    if (hasTallImage()) return;

    visualDiv = vis;
    clipContainer = vis.parentElement;
    // Bind to the active swipe (the one containing `vis`), not the first one.
    // In a multi-image tweet the off-screen siblings also match the testid.
    swipeContainer = getActiveSwipe();
    active = true;
    scale = 1; tx = 0; ty = 0; dragging = false;
    overflowUnlocked = false;
    origTransform = vis.style.transform || '';

    vis.style.transformOrigin = 'center center';

    overflowEls = [];
    let el = clipContainer;
    while (el && el !== swipeContainer && el !== document.body) {
      overflowEls.push({ el, orig: el.style.overflow });
      el = el.parentElement;
    }

    applyTransform(false);
    addIndicator();
  }

  function cleanup() {
    lockOverflow();
    if (visualDiv) {
      visualDiv.style.transform = origTransform;
      visualDiv.style.transformOrigin = '';
      visualDiv.style.cursor = '';
    }
    removeIndicator();
    active = false;
    visualDiv = null;
    clipContainer = null;
    swipeContainer = null;
    overflowEls = [];
    scale = 1; tx = 0; ty = 0;
    overflowUnlocked = false;
  }

  // --- Overflow toggle ---
  function unlockOverflow() {
    if (overflowUnlocked) return;
    overflowUnlocked = true;
    for (const item of overflowEls) {
      item.el.style.setProperty('overflow', 'visible', 'important');
    }
  }
  function lockOverflow() {
    if (!overflowUnlocked) return;
    overflowUnlocked = false;
    for (const item of overflowEls) {
      if (item.orig) item.el.style.overflow = item.orig;
      else item.el.style.removeProperty('overflow');
    }
  }

  // --- Transform ---
  function applyTransform(smooth) {
    if (!visualDiv) return;
    visualDiv.style.transition = smooth
      ? 'transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
    if (scale <= 1) {
      visualDiv.style.transform = origTransform || '';
      lockOverflow();
    } else {
      visualDiv.style.transform =
        `scale(${scale}) translate(${tx / scale}px, ${ty / scale}px)`;
      unlockOverflow();
    }
  }

  // getBoundingClientRect returns post-transform sizes, which is correct here:
  // the visual rect reflects what the user sees, and tx/ty are divided by scale
  // in the transform string, so the pan limits stay consistent.
  function clampPan() {
    if (!visualDiv || !swipeContainer) return;
    const vp = swipeContainer.getBoundingClientRect();
    const vr = visualDiv.getBoundingClientRect();
    const ox = Math.max(0, (vr.width - vp.width) / 2);
    const oy = Math.max(0, (vr.height - vp.height) / 2);
    tx = clamp(tx, -ox, ox);
    ty = clamp(ty, -oy, oy);
  }

  // --- Indicator ---
  function addIndicator() {
    if (indicatorEl) return;
    indicatorEl = document.createElement('div');
    indicatorEl.className = 'xvm-iv-indicator';
    (swipeContainer || document.body).appendChild(indicatorEl);
    showIndicator();
  }
  function removeIndicator() {
    if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = null;
  }
  function showIndicator() {
    if (!indicatorEl) return;
    indicatorEl.textContent = `${Math.round(scale * 100)}%`;
    indicatorEl.classList.add('xvm-iv-indicator--show');
    if (indicatorTimer) clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => {
      if (indicatorEl) indicatorEl.classList.remove('xvm-iv-indicator--show');
    }, 1200);
  }

  // --- Events ---
  function onWheel(e) {
    if (hasTallImage()) { if (active) cleanup(); return; }
    if (!active || !visualDiv) return;
    if (!swipeContainer || !swipeContainer.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    // cx/cy: cursor position relative to the visual center (post-transform).
    // Using the visual rect is correct for zoom-to-cursor: the user targets
    // what they see, and the translate values compensate via division by scale.
    const vr = visualDiv.getBoundingClientRect();
    const cx = e.clientX - (vr.left + vr.width / 2);
    const cy = e.clientY - (vr.top + vr.height / 2);
    const old = scale;
    const f = e.deltaY < 0 ? (1 + ZOOM_FACTOR) : (1 / (1 + ZOOM_FACTOR));
    scale = clamp(scale * f, MIN_SCALE, MAX_SCALE);
    if (Math.abs(scale - 1) < 0.03) scale = 1;

    if (scale <= 1) { scale = 1; tx = 0; ty = 0; }
    else {
      const r = scale / old;
      tx = cx - r * (cx - tx);
      ty = cy - r * (cy - ty);
      clampPan();
    }
    applyTransform(true);
    showIndicator();
    updateCursor();
  }

  function onMouseDown(e) {
    if (hasTallImage()) { if (active) cleanup(); return; }
    if (!active || !visualDiv) return;
    if (!swipeContainer || !swipeContainer.contains(e.target)) return;
    if (scale <= 1 || e.button !== 0) return;
    if (e.target.closest('button, a, [role="button"]')) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    dragX0 = e.clientX; dragY0 = e.clientY;
    dragTX0 = tx; dragTY0 = ty;
    updateCursor();
  }
  function onMouseMove(e) {
    if (!dragging) return;
    e.preventDefault();
    tx = dragTX0 + (e.clientX - dragX0);
    ty = dragTY0 + (e.clientY - dragY0);
    clampPan();
    applyTransform(false);
  }
  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    updateCursor();
  }

  function onDblClick(e) {
    if (hasTallImage()) { if (active) cleanup(); return; }
    if (!active || !visualDiv) return;
    if (!swipeContainer || !swipeContainer.contains(e.target)) return;
    if (e.target.closest('button, a, [role="button"]')) return;
    e.preventDefault(); e.stopPropagation();

    if (scale > 1) { scale = 1; tx = 0; ty = 0; }
    else {
      // scale is always 1 entering this branch, so vr is the un-transformed rect
      scale = 2.5;
      const vr = visualDiv.getBoundingClientRect();
      tx = (vr.left + vr.width / 2) - e.clientX;
      ty = (vr.top + vr.height / 2) - e.clientY;
      clampPan();
    }
    applyTransform(true); showIndicator(); updateCursor();
  }

  function onKeyDown(e) {
    if (hasTallImage()) { if (active) cleanup(); return; }
    if (!active) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'
      || e.target.isContentEditable) return;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      scale = clamp(scale * (1 + ZOOM_FACTOR), MIN_SCALE, MAX_SCALE);
      clampPan(); applyTransform(true); showIndicator(); updateCursor();
    } else if (e.key === '-') {
      e.preventDefault();
      scale = clamp(scale / (1 + ZOOM_FACTOR), MIN_SCALE, MAX_SCALE);
      if (scale <= 1) { scale = 1; tx = 0; ty = 0; }
      else clampPan();
      applyTransform(true); showIndicator(); updateCursor();
    } else if (e.key === '0') {
      e.preventDefault();
      scale = 1; tx = 0; ty = 0;
      applyTransform(true); showIndicator(); updateCursor();
    }
  }

  function updateCursor() {
    if (!visualDiv) return;
    visualDiv.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : '';
  }

  // --- Observer ---
  let timer = null;
  function check() {
    if (hasTallImage()) { if (active) cleanup(); return; }
    const vis = findVisual();
    if (vis && !active) enhance(vis);
    else if (!vis && active) cleanup();
    else if (vis && active && vis !== visualDiv) { cleanup(); enhance(vis); }
  }

  function init() {
    new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 120);
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    check();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
