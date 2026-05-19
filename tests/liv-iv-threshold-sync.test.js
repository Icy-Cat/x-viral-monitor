// Regression test for #44: image-viewer and long-image-viewer must agree on
// the tall-image ratio threshold, otherwise images in the gap band lose
// both LIV (won't activate) and IV (bails thinking LIV will).
//
// Implementation has LIV as single source of truth (window.__xvmLiv.RATIO_THRESHOLD)
// and IV reads from there. This test guards against future refactors that
// might silently break that dependency or hardcode a divergent literal.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const liv = readFileSync(resolve(here, '..', 'lib', 'long-image-viewer.js'), 'utf8');
const iv  = readFileSync(resolve(here, '..', 'lib', 'image-viewer.js'), 'utf8');

describe('#44 LIV/IV ratio threshold lock-step', () => {
  it('LIV defines RATIO_THRESHOLD as a numeric const', () => {
    const m = liv.match(/const\s+RATIO_THRESHOLD\s*=\s*(\d+(?:\.\d+)?)/);
    expect(m, 'long-image-viewer.js must declare `const RATIO_THRESHOLD = <number>`').not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(0);
  });

  it('LIV exposes RATIO_THRESHOLD on window.__xvmLiv', () => {
    // Must assign to window.__xvmLiv (Object.assign or direct prop) so the
    // single-source-of-truth contract holds. If this breaks, IV's fallback
    // kicks in silently and the two can drift again.
    expect(
      /window\.__xvmLiv\s*=\s*Object\.assign\([^)]*RATIO_THRESHOLD/.test(liv)
        || /window\.__xvmLiv\.RATIO_THRESHOLD\s*=/.test(liv),
      'long-image-viewer.js must publish RATIO_THRESHOLD on window.__xvmLiv'
    ).toBe(true);
  });

  it('IV reads from window.__xvmLiv (not a hardcoded literal)', () => {
    expect(
      /window\.__xvmLiv\??\.RATIO_THRESHOLD/.test(iv),
      'image-viewer.js must read LIV_RATIO_THRESHOLD from window.__xvmLiv.RATIO_THRESHOLD'
    ).toBe(true);
  });

  it('IV fallback literal matches LIV literal (defensive lock-step)', () => {
    // Even though IV reads dynamically, it has a defensive fallback for the
    // (defensive only) case where LIV failed to load. That fallback must
    // match LIV's literal — otherwise a regression in LIV's exposure code
    // would silently degrade IV's behavior.
    const livLit = liv.match(/const\s+RATIO_THRESHOLD\s*=\s*(\d+(?:\.\d+)?)/)?.[1];
    const ivFallback = iv.match(/window\.__xvmLiv\??\.RATIO_THRESHOLD\s*\?\?\s*(\d+(?:\.\d+)?)/)?.[1];
    expect(livLit, 'LIV must have a literal').toBeTruthy();
    expect(ivFallback, 'IV must have a `?? <literal>` fallback').toBeTruthy();
    expect(Number(ivFallback)).toBe(Number(livLit));
  });
});
