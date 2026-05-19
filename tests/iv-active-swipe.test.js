// Regression test for #44 v1.6.13: image-viewer must only consider the
// ACTIVE swipe slide, never the whole dialog. The previous "single-image
// modal" assumptions caused:
//   (a) hasTallImage false-positive from an offscreen ratio-9.89 sibling
//       (xiaomao photo/2 case)
//   (b) findVisual binding to the first DOM swipe (offscreen) instead of
//       the currently visible one (ChappelDae photo/* case)
//
// This grep-level test pins the contract so a future refactor that
// silently reintroduces dialog-wide scanning fails CI.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const iv = readFileSync(resolve(here, '..', 'lib', 'image-viewer.js'), 'utf8');

describe('#44 v1.6.13 image-viewer active-swipe invariant', () => {
  it('defines getActiveSwipe helper', () => {
    expect(/function\s+getActiveSwipe\s*\(/.test(iv),
      'image-viewer.js must define getActiveSwipe()'
    ).toBe(true);
  });

  it('defines isInViewport helper', () => {
    expect(/function\s+isInViewport\s*\(/.test(iv),
      'image-viewer.js must define isInViewport()'
    ).toBe(true);
  });

  it('getActiveSwipe scopes its swipe lookup to the dialog (not document)', () => {
    // The helper must scope its querySelectorAll to the dialog (or to a
    // dialog-rooted selector). A bare `document.querySelectorAll(...swipe...)`
    // inside getActiveSwipe would defeat the active-only guarantee whenever
    // X mounts multiple modals.
    const body = iv.match(/function\s+getActiveSwipe\s*\(\)\s*\{[\s\S]*?\n\s{0,4}\}\n/)?.[0] || '';
    expect(body.length, 'getActiveSwipe body must be locatable').toBeGreaterThan(0);
    expect(
      /dialog\.querySelectorAll\(\s*['"]\[data-testid="swipe-to-dismiss"\]['"]\s*\)/.test(body),
      'getActiveSwipe must scope swipe lookup via `dialog.querySelectorAll(...)`'
    ).toBe(true);
  });

  it('hasTallImage uses getActiveSwipe (not dialog-wide scan)', () => {
    const body = iv.match(/function\s+hasTallImage\s*\(\)\s*\{[\s\S]*?\n\s{0,4}\}\n/)?.[0] || '';
    expect(body.length, 'hasTallImage body must be locatable').toBeGreaterThan(0);
    expect(
      /getActiveSwipe\s*\(\s*\)/.test(body),
      'hasTallImage must call getActiveSwipe() instead of scanning the whole dialog'
    ).toBe(true);
    expect(
      /dialog\.querySelectorAll\s*\(\s*['"]img['"]\s*\)/.test(body),
      'hasTallImage must NOT iterate `dialog.querySelectorAll("img")` — only the active swipe'
    ).toBe(false);
  });

  it('findVisual uses getActiveSwipe (not document.querySelector first match)', () => {
    const body = iv.match(/function\s+findVisual\s*\(\)\s*\{[\s\S]*?\n\s{0,4}\}\n/)?.[0] || '';
    expect(body.length, 'findVisual body must be locatable').toBeGreaterThan(0);
    expect(
      /getActiveSwipe\s*\(\s*\)/.test(body),
      'findVisual must call getActiveSwipe() instead of document.querySelector(...swipe-to-dismiss)'
    ).toBe(true);
    expect(
      /document\.querySelector\s*\(\s*['"]\[data-testid="swipe-to-dismiss"\]['"]\s*\)/.test(body),
      'findVisual must NOT use document.querySelector for the swipe'
    ).toBe(false);
  });

  it('enhance binds swipeContainer to active swipe (not document-wide first)', () => {
    const body = iv.match(/function\s+enhance\s*\([^)]*\)\s*\{[\s\S]*?\n\s{0,4}\}\n/)?.[0] || '';
    expect(body.length, 'enhance body must be locatable').toBeGreaterThan(0);
    expect(
      /swipeContainer\s*=\s*getActiveSwipe\s*\(\s*\)/.test(body),
      'enhance must set swipeContainer = getActiveSwipe()'
    ).toBe(true);
  });

  it('LIV-defer gate is narrowed to active-swipe-scoped check', () => {
    // The previous dialog-wide `dialog.classList.contains('xvm-liv-dialog')`
    // gate could starve image-viewer when a different slide previously had
    // LIV applied. The narrowed gate must look inside the active swipe.
    const body = iv.match(/function\s+hasTallImage\s*\(\)\s*\{[\s\S]*?\n\s{0,4}\}\n/)?.[0] || '';
    expect(
      /swipe\.querySelector\(\s*['"]\.xvm-liv-img['"]\s*\)/.test(body),
      'hasTallImage must check `.xvm-liv-img` inside the active swipe, not on the whole dialog'
    ).toBe(true);
  });
});
