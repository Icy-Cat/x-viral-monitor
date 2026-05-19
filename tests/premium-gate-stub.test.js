// Step 1 smoke tests for the premium-tier gate + rate-filter integration.
// These are grep-level / wiring tests — full behavior tests will land
// alongside the step 2 license slice (Codex-led ADR-0004).
//
// What we pin in step 1:
//   - gate.js exposes the required API surface (getCurrentTier /
//     isFeatureEnabled / onTierChange / _setTier)
//   - rate-filter calls getCurrentTier / isFeatureEnabled (never makes
//     its own tier decision)
//   - manifest loads gate.js BEFORE filter.js BEFORE content.js
//   - feature map declares 'rate-filter' as the gated feature

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const gate = readFileSync(resolve(repo, 'src/premium/license/gate.js'), 'utf8');
const filter = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

describe('#45 M1 step 1 — premium gate scaffold', () => {
  it('gate.js exposes window.__xvmPro with required API', () => {
    expect(/window\.__xvmPro\s*=/.test(gate),
      'gate.js must publish window.__xvmPro').toBe(true);
    for (const fn of ['getCurrentTier', 'isFeatureEnabled', 'onTierChange', '_setTier']) {
      expect(gate, `gate.js must export ${fn}`).toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });

  it('gate.js declares rate-filter in FEATURE_TIER', () => {
    expect(/FEATURE_TIER\s*=\s*\{[^}]*['"]rate-filter['"]/.test(gate),
      'gate.js FEATURE_TIER must include rate-filter').toBe(true);
  });

  it('rate-filter never hardcodes its own tier check', () => {
    expect(filter,
      'rate-filter MUST go through __xvmPro.isFeatureEnabled — single gate entry')
      .toMatch(/__xvmPro\?\.isFeatureEnabled\(['"]rate-filter['"]\)/);
    // Negative: no direct chrome.storage license/tier reads inside filter
    expect(/chrome\.storage[^.]*\.(get|set)\([^)]*['"](tier|license|trial)/.test(filter),
      'rate-filter must NOT read tier/license/trial state directly'
    ).toBe(false);
  });

  it('rate-filter subscribes to tier changes (runtime revoke)', () => {
    expect(/__xvmPro\?\.onTierChange/.test(filter),
      'rate-filter must subscribe to tier changes so revoke-on-expiry works'
    ).toBe(true);
  });

  // #45 dev2 race condition fix (Codex root-cause):
  //   activate() ran while gate was still 'free' (fail-closed default
  //   before isolated.js async-pushed tier), so subscribe() was skipped
  //   and the net hook had no listener → decisions map stayed empty →
  //   nothing was hidden after tier flipped to trial. The fix is to
  //   make subscribe() idempotent and invoke it from onTierChange.
  describe('#45 dev2 race condition — subscribe() idempotency + onTierChange wiring', () => {
    it('declares a module-scope subscribed flag', () => {
      expect(/let\s+subscribed\s*=\s*false\s*;/.test(filter),
        'filter.js must declare `let subscribed = false;` for idempotency'
      ).toBe(true);
    });

    it('subscribe() guards on the subscribed flag (early return)', () => {
      const body = filter.match(/function\s+subscribe\s*\(\)\s*\{[\s\S]*?\n  \}/);
      expect(body, 'subscribe() body must be locatable').not.toBeNull();
      expect(/if\s*\(\s*subscribed\s*\)\s*return\s*;/.test(body[0]),
        'subscribe() must early-return if already subscribed'
      ).toBe(true);
      expect(/subscribed\s*=\s*true\s*;/.test(body[0]),
        'subscribe() must set subscribed = true once it commits to registering'
      ).toBe(true);
    });

    it('onTierChange callback calls subscribe() when gate opens', () => {
      // Match the onTierChange callback body and assert subscribe() is
      // called on the gate-open branch.
      const cb = filter.match(/onTierChange\(\(tier\)\s*=>\s*\{[\s\S]*?\}\)/);
      expect(cb, 'onTierChange callback must be locatable').not.toBeNull();
      const body = cb[0];
      expect(/subscribe\s*\(\s*\)\s*;/.test(body),
        'onTierChange must call subscribe() so the net hook gets registered when tier flips up'
      ).toBe(true);
    });

    it('onTierChange callback also connects the MutationObserver (dev3 root cause #2)', () => {
      // Codex bb-browser dev3 verification surfaced that mo.observe was
      // also skipped at fail-closed boot. Same fix mechanism: invoke
      // from onTierChange. Idempotent for same target+options.
      const cb = filter.match(/onTierChange\(\(tier\)\s*=>\s*\{[\s\S]*?\}\)/);
      expect(cb, 'onTierChange callback must be locatable').not.toBeNull();
      expect(/mo\.observe\s*\(/.test(cb[0]),
        'onTierChange must call mo.observe() so virtual-scroll re-mounts re-trigger applyHidesNow'
      ).toBe(true);
    });

    it('reset() clears the subscribed flag (for hot-reload + tests)', () => {
      const reset = filter.match(/reset\(\)\s*\{[\s\S]*?\n    \},/);
      expect(reset, 'reset() body must be locatable').not.toBeNull();
      expect(/subscribed\s*=\s*false\s*;/.test(reset[0]),
        'reset() must reset subscribed to false so a fresh subscribe is possible'
      ).toBe(true);
    });
  });

  it('manifest content_scripts loads gate before filter before content', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    expect(main, 'manifest must have a MAIN-world content_scripts entry').toBeTruthy();
    const order = main.js;
    const gIdx = order.indexOf('src/premium/license/gate.js');
    const fIdx = order.indexOf('src/premium/rate-filter/filter.js');
    const cIdx = order.indexOf('content.js');
    const xIdx = order.indexOf('lib/x-net-hook.js');
    expect(gIdx, 'gate.js must be in MAIN world').toBeGreaterThanOrEqual(0);
    expect(fIdx, 'filter.js must be in MAIN world').toBeGreaterThanOrEqual(0);
    expect(xIdx, 'x-net-hook.js must be in MAIN world').toBeGreaterThanOrEqual(0);
    expect(gIdx, 'gate.js must load BEFORE filter.js').toBeLessThan(fIdx);
    expect(xIdx, 'x-net-hook.js must load BEFORE filter.js').toBeLessThan(fIdx);
    expect(fIdx, 'filter.js must load BEFORE content.js').toBeLessThan(cIdx);
  });

  it('gate fails CLOSED (defaults to free) until isolated.js pushes tier', () => {
    // ADR-0004 invariant: a brief gate-init race must serve free, never
    // an unverified paid tier. Step 1 stub returned 'trial' to exercise
    // the feature end-to-end; step 2 must default to 'free' because the
    // real tier now arrives async from the isolated-world bridge.
    expect(/let\s+_currentTier\s*=\s*['"]free['"]/.test(gate),
      'step 2 gate must default to free (fail-closed)'
    ).toBe(true);
  });

  it('gate listens for XVM_TIER_UPDATE postMessage', () => {
    expect(/XVM_TIER_UPDATE/.test(gate), 'gate must listen for tier updates').toBe(true);
    expect(/window\.addEventListener\(\s*['"]message['"]/.test(gate),
      'gate must add a window message listener').toBe(true);
  });

  it('gate kicks an XVM_TIER_REQUEST on init', () => {
    expect(/window\.postMessage\([^)]*XVM_TIER_REQUEST/.test(gate),
      'gate must ask isolated.js for the current tier on mount'
    ).toBe(true);
  });
});
