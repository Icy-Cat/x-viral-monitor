// #45 ADR-0004 Review Gate — behavior tests for resolveTier and friends.
// Codex Blocker #1: prove the tier-resolution invariants over the 8 scenarios
// the ADR enumerates, with mock storage records (no real Worker / chrome).
//
// tier-logic.js is dual-mode (globalThis + CommonJS). vitest can require()
// it directly, no DOM/chrome mocks needed because the helpers are PURE.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

// package.json has "type": "module" so plain `require()` of tier-logic.js
// returns an empty ESM namespace. We instead read the file text and run
// it in a fresh vm context, mirroring how a Chrome content script loads
// it via plain <script>. globalThis.__xvmTierLogic is the published api.
const here = dirname(fileURLToPath(import.meta.url));
const tierSrc = readFileSync(resolve(here, '..', 'src/premium/license/tier-logic.js'), 'utf8');
const sandbox = { globalThis: {}, console };
sandbox.globalThis.globalThis = sandbox.globalThis;
vm.createContext(sandbox);
vm.runInContext(tierSrc, sandbox);
const TL = sandbox.globalThis.__xvmTierLogic;
if (!TL) throw new Error('tier-logic.js did not publish to globalThis.__xvmTierLogic');

const { resolveTierFrom, licenseStatusFrom, trialStatus,
        TRIAL_MS, RECHECK_INTERVAL_MS, OFFLINE_GRACE_MS,
        XVM_PRODUCT_IDS } = TL;

const NOW = 2_000_000_000_000; // fixed clock for deterministic assertions
const XVM_PROD = XVM_PRODUCT_IDS[0]; // valid XVM product
const FOREIGN_PROD = 'prod_5jwj6zkX0G42WgE8EfeUhD'; // x-md-paste (foreign)

function freshTrial(daysAgo) {
  return { startAt: NOW - daysAgo * 86400000 };
}

function freshLicense(overrides = {}) {
  return {
    key: 'creem-fake-key',
    instanceId: 'inst-1',
    productId: XVM_PROD,
    status: 'active',
    lastChecked: NOW, // fresh by default
    entitlementPayload: 'signed-payload',
    entitlementSig: 'signed-sig',
    entitlementExpiresAt: NOW + 10 * 60 * 1000,
    activatedAt: NOW - 86400000,
    ...overrides,
  };
}

describe('#45 ADR-0004 scenario 1 — free (no license, no trial)', () => {
  it('returns free, daysLeft 0, source none', () => {
    const r = resolveTierFrom(null, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.daysLeft).toBe(0);
    expect(r.source).toBe('none');
  });
});

describe('#45 ADR-0004 scenario 2 — active trial', () => {
  it('returns trial with correct daysLeft', () => {
    const trial = freshTrial(3); // started 3 days ago → 11 days left
    const r = resolveTierFrom(null, trial, NOW);
    expect(r.tier).toBe('trial');
    expect(r.daysLeft).toBe(11);
    expect(r.source).toBe('trial');
  });

  it('boundary: 1 day left (13 days in)', () => {
    const trial = { startAt: NOW - (13 * 86400000 + 1000) }; // just over 13d
    const r = resolveTierFrom(null, trial, NOW);
    expect(r.tier).toBe('trial');
    expect(r.daysLeft).toBe(1);
  });
});

describe('#45 ADR-0004 scenario 3 — expired trial', () => {
  it('returns free after 14 days', () => {
    const trial = freshTrial(15);
    const r = resolveTierFrom(null, trial, NOW);
    expect(r.tier).toBe('free');
    expect(r.daysLeft).toBe(0);
    expect(r.source).toBe('none'); // no license, source none
  });

  it('exactly at TRIAL_MS boundary → expired', () => {
    const trial = { startAt: NOW - TRIAL_MS };
    const r = resolveTierFrom(null, trial, NOW);
    expect(r.tier).toBe('free');
  });
});

describe('#45 ADR-0004 scenario 4 — valid pro (cached, within 24h)', () => {
  it('returns pro with source cached', () => {
    const lic = freshLicense({ lastChecked: NOW - 1000 }); // 1s ago
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('cached');
    expect(r.daysLeft).toBe(0);
  });

  it('pro beats trial — even with active trial, pro takes precedence', () => {
    const lic = freshLicense();
    const trial = freshTrial(1);
    const r = resolveTierFrom(lic, trial, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('cached');
  });
});

describe('#45 ADR-0004 scenario 5 — stale cache, within 7-day offline grace', () => {
  it('returns pro with source offline-grace', () => {
    // lastChecked is 2 days ago (> 24h, < 7d)
    const lic = freshLicense({ lastChecked: NOW - 2 * 86400000 });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('offline-grace');
  });

  it('exactly at RECHECK boundary — still cached', () => {
    const lic = freshLicense({ lastChecked: NOW - RECHECK_INTERVAL_MS });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('cached');
  });
});

describe('#45 ADR-0004 scenario 6 — offline grace expired (> 7 days)', () => {
  it('returns free (stale, revalidation required)', () => {
    const lic = freshLicense({ lastChecked: NOW - 8 * 86400000 });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.source).toBe('stale');
  });

  it('exactly at OFFLINE_GRACE boundary — still grace', () => {
    const lic = freshLicense({ lastChecked: NOW - OFFLINE_GRACE_MS });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('offline-grace');
  });
});

describe('#45 ADR-0004 scenario 7 — wrong product (shared-Worker spillover)', () => {
  it('rejects foreign productId immediately, downgrades to free', () => {
    const lic = freshLicense({ productId: FOREIGN_PROD });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.source).toBe('wrong_product');
  });

  it('falls back to trial if trial is still active', () => {
    const lic = freshLicense({ productId: FOREIGN_PROD });
    const trial = freshTrial(2);
    const r = resolveTierFrom(lic, trial, NOW);
    expect(r.tier).toBe('trial');
    expect(r.daysLeft).toBe(12);
  });

  it('wrong_product source threads through to free (non-blocker #3 fix)', () => {
    const lic = freshLicense({ productId: FOREIGN_PROD });
    const r = resolveTierFrom(lic, null, NOW);
    // popup diagnostics: source must be 'wrong_product', not 'none'.
    expect(r.source).toBe('wrong_product');
  });

  it('missing productId fails closed', () => {
    const lic = freshLicense({ productId: null });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.source).toBe('missing_product');
  });
});

describe('#114 signed entitlement cache guard', () => {
  it('missing entitlement downgrades even for matching product', () => {
    expect(resolveTierFrom(freshLicense({ entitlementPayload: '', entitlementExpiresAt: NOW + 1000 }), null, NOW).source).toBe('invalid_entitlement');
    expect(resolveTierFrom(freshLicense({ entitlementSig: '', entitlementExpiresAt: NOW + 1000 }), null, NOW).source).toBe('invalid_entitlement');
    expect(resolveTierFrom(freshLicense({ entitlementExpiresAt: null }), null, NOW).tier).toBe('free');
  });

  it('expired short-lived entitlement does not override the 24h license cache', () => {
    const lic = freshLicense({
      lastChecked: NOW - 11 * 60 * 1000,
      entitlementExpiresAt: NOW - 60 * 1000,
    });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('pro');
    expect(r.source).toBe('cached');
  });
});

describe('#45 ADR-0004 scenario 8 — inactive license status', () => {
  it('returns free with source expired', () => {
    const lic = freshLicense({ status: 'inactive' });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.source).toBe('expired');
  });

  it('status=disabled also downgrades', () => {
    const lic = freshLicense({ status: 'disabled' });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.tier).toBe('free');
    expect(r.source).toBe('expired');
  });

  it('expired source threads through to free (non-blocker #3 fix)', () => {
    const lic = freshLicense({ status: 'inactive' });
    const r = resolveTierFrom(lic, null, NOW);
    expect(r.source).toBe('expired');
  });
});

describe('#45 trialStatus pure helper', () => {
  it('null record → not trialing', () => {
    expect(trialStatus(null, NOW)).toEqual({ isTrialing: false, daysLeft: 0 });
  });
  it('missing startAt → not trialing', () => {
    expect(trialStatus({}, NOW)).toEqual({ isTrialing: false, daysLeft: 0 });
  });
  it('fresh trial → 14 days left', () => {
    expect(trialStatus({ startAt: NOW }, NOW)).toEqual({ isTrialing: true, daysLeft: 14 });
  });
  it('past trial → 0 days', () => {
    expect(trialStatus({ startAt: NOW - 20 * 86400000 }, NOW))
      .toEqual({ isTrialing: false, daysLeft: 0 });
  });
});

describe('#45 licenseStatusFrom invariants', () => {
  it('does not throw on undefined / null storage', () => {
    expect(() => licenseStatusFrom(null, NOW)).not.toThrow();
    expect(() => licenseStatusFrom(undefined, NOW)).not.toThrow();
  });
  it('missing key OR missing instanceId both → free/none', () => {
    expect(licenseStatusFrom({ key: 'x' }, NOW).tier).toBe('free');
    expect(licenseStatusFrom({ instanceId: 'x' }, NOW).tier).toBe('free');
  });
});
