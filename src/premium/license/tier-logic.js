// === Pure tier-resolution logic (CommonJS + globalThis dual-mode) ===
//
// Single source of truth for the tier computation. Both isolated.js (X.com
// content script context) and popup-pro.js (extension popup context) call
// into this module instead of inlining their own copies — eliminates the
// mirror-drift risk Codex flagged, and lets vitest exercise the 8 ADR-0004
// scenarios with mock storage records.
//
// Dual-mode loading:
//   - Browser (manifest content_scripts / popup <script>) — IIFE assigns
//     to globalThis.__xvmTierLogic for use by isolated.js / popup-pro.js.
//   - Node (vitest tests) — module.exports for `import` syntax.

(function (root) {
  'use strict';

  const TRIAL_DAYS         = 14;
  const TRIAL_MS           = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;       // 24h license cache
  const OFFLINE_GRACE_MS    = 7 * 24 * 60 * 60 * 1000;   // 7d offline grace

  // Client-side product scoping (shared Worker spillover defense, #45 step 4-5).
  // Both XVM Pro products. Adding a Pro+ later: extend this array.
  const XVM_PRODUCT_IDS = [
    'prod_7f7t9EHK3RJlOK37DWr7J', // XVM Pro Monthly
    'prod_69yTiXGXb04DKm46DNVbN9', // XVM Pro Annual
  ];

  function isXvmProduct(productId) {
    return typeof productId === 'string' && XVM_PRODUCT_IDS.includes(productId);
  }

  // Compute trial state from a stored {startAt} record.
  // - null/missing record → not trialing, 0 days
  // - within TRIAL_MS of startAt → trialing, ceil(remaining / day)
  // - past TRIAL_MS → not trialing, 0 days
  function trialStatus(rec, now) {
    const t = (now == null ? Date.now() : now);
    if (!rec || !Number.isFinite(rec.startAt)) return { isTrialing: false, daysLeft: 0 };
    const msLeft = TRIAL_MS - (t - rec.startAt);
    if (msLeft <= 0) return { isTrialing: false, daysLeft: 0 };
    return { isTrialing: true, daysLeft: Math.ceil(msLeft / 86400000) };
  }

  // Compute license-side status from a stored license record.
  // Returns { tier, record, source } where:
  //   tier   = 'pro' | 'free'
  //   source = 'none' | 'cached' | 'offline-grace' | 'stale' | 'expired' | 'wrong_product'
  //
  // Does NOT trigger I/O. The caller (isolated.js) decides if a stale
  // record warrants a background revalidate; we just report the verdict.
  function licenseStatusFrom(stored, now) {
    const t = (now == null ? Date.now() : now);
    if (!stored?.key || !stored?.instanceId) {
      return { tier: 'free', record: null, source: 'none' };
    }
    // Product scope check defends against:
    //   (a) record from before scoping landed
    //   (b) DevTools storage tamper
    //   (c) shared Worker accepting a sibling product (e.g. x-md-paste)
    if (!isXvmProduct(stored.productId)) {
      return { tier: 'free', record: stored, source: stored.productId ? 'wrong_product' : 'missing_product' };
    }
    // A signed entitlement proves the Worker response that created this
    // local record. Its short TTL should not become the user's Pro duration:
    // normal freshness is still governed by the 24h cache + 7d offline grace
    // below. Missing entitlement data fails closed; expired entitlement data
    // is refreshed when the license cache becomes stale.
    if (
      typeof stored.entitlementPayload !== 'string' || !stored.entitlementPayload ||
      typeof stored.entitlementSig !== 'string' || !stored.entitlementSig ||
      !Number.isFinite(stored.entitlementExpiresAt)
    ) {
      return { tier: 'free', record: stored, source: 'invalid_entitlement' };
    }
    if (stored.status && stored.status !== 'active') {
      return { tier: 'free', record: stored, source: 'expired' };
    }
    const sinceCheck = t - (stored.lastChecked || 0);
    if (sinceCheck <= RECHECK_INTERVAL_MS) {
      return { tier: 'pro', record: stored, source: 'cached' };
    }
    // Stale cache — within the 7-day offline grace window we still serve
    // pro; past it we drop to free but keep a distinct source so callers can
    // re-check before asking the user to activate again.
    if (sinceCheck > OFFLINE_GRACE_MS) {
      return { tier: 'free', record: stored, source: 'stale' };
    }
    return { tier: 'pro', record: stored, source: 'offline-grace' };
  }

  // Combine license + trial into the final tier verdict.
  // Pro wins over trial wins over free.
  function resolveTierFrom(storedLicense, storedTrial, now) {
    const lic = licenseStatusFrom(storedLicense, now);
    if (lic.tier === 'pro') {
      return { tier: 'pro', daysLeft: 0, source: lic.source, record: lic.record };
    }
    const trial = trialStatus(storedTrial, now);
    if (trial.isTrialing) {
      return { tier: 'trial', daysLeft: trial.daysLeft, source: 'trial', record: lic.record };
    }
    return { tier: 'free', daysLeft: 0, source: lic.source || 'none', record: lic.record };
  }

  const api = {
    TRIAL_DAYS, TRIAL_MS, RECHECK_INTERVAL_MS, OFFLINE_GRACE_MS,
    XVM_PRODUCT_IDS, isXvmProduct,
    trialStatus, licenseStatusFrom, resolveTierFrom,
  };

  // Browser side: expose on globalThis for isolated.js / popup-pro.js.
  if (root) root.__xvmTierLogic = api;

  // Node side: CommonJS export for vitest.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
