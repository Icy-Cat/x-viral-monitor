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

  // Long-image-viewer claims tall screenshots. We check directly (not just the
  // .xvm-liv-dialog class) so we bail out even before that script has had a
  // chance to mark the dialog — otherwise our document-level wheel listener
  // would stopPropagation() and starve the long-image scroll handler.
  function hasTallImage() {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return false;
    if (dialog.classList.contains('xvm-liv-dialog')) return true;
    const imgs = dialog.querySelectorAll('img');
    for (const img of imgs) {
      if (!/pbs\.twimg\.com\/media/.test(img.src || '')) continue;
      if (img.naturalWidth && img.naturalHeight / img.naturalWidth > 2.0) return true;
    }
    return false;
  }

  // Don't rely on aria-label (it's localized: "Image", "图像", etc.)
  function findVisual() {
    const swipe = document.querySelector('[data-testid="swipe-to-dismiss"]');
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
    swipeContainer = document.querySelector('[data-testid="swipe-to-dismiss"]');
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
