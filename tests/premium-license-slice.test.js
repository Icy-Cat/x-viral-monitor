// #45 step 2 license slice — contract tests against ADR-0004 checklist.
//
// These are grep-level tests asserting structural invariants. End-to-end
// behavior testing (Worker mock → activate → tier flip) lands in step 7
// (e2e tests) once we have the deployed Worker URL.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const isolated = readFileSync(resolve(repo, 'src/premium/license/isolated.js'), 'utf8');
const gate     = readFileSync(resolve(repo, 'src/premium/license/gate.js'), 'utf8');
const filter   = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
const worker   = readFileSync(resolve(repo, 'worker/license-proxy.js'), 'utf8');
const background = readFileSync(resolve(repo, 'background.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

describe('#45 step 2 — ADR-0004 storage / secret / productId checklist', () => {
  it('extension code contains NO Creem API key literal', () => {
    // Most critical ADR-0004 invariant. If creem_live_ or creem_test_ ever
    // appears in shipped extension code, the secret leaked. Worker is the
    // only place that string is allowed.
    for (const [name, body] of [['isolated.js', isolated], ['gate.js', gate], ['filter.js', filter]]) {
      expect(/creem_(?:live|test)_[A-Za-z0-9]/.test(body),
        `${name} must NOT contain a Creem API key`
      ).toBe(false);
    }
  });

  it('isolated.js calls the Worker (not Creem) directly', () => {
    expect(/api\.creem\.io/.test(isolated),
      'isolated.js MUST NOT call api.creem.io directly — go through the Worker'
    ).toBe(false);
    expect(/LICENSE_PROXY_URL/.test(isolated),
      'isolated.js must reference LICENSE_PROXY_URL'
    ).toBe(true);
  });

  it('Worker URL is a real https://*.workers.dev URL (post-substitution)', () => {
    // Pre-substitution this asserted the __XVM_LICENSE_WORKER__ placeholder.
    // After the user deploys the Worker and we substitute, the LICENSE_PROXY_URL
    // const must be a real Cloudflare Worker URL. Either form is acceptable
    // (placeholder for unsubstituted dev branches, real URL for shippable),
    // but pinning the SHAPE here prevents accidentally pushing 'localhost' or
    // a non-https URL to release.
    const m = isolated.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/);
    expect(m, 'isolated.js must declare LICENSE_PROXY_URL').not.toBeNull();
    const url = m[1];
    const isPlaceholder = url === '__XVM_LICENSE_WORKER__';
    const isWorkerUrl = /^https:\/\/[a-z0-9.-]+\.workers\.dev\/?$/.test(url);
    expect(isPlaceholder || isWorkerUrl,
      `LICENSE_PROXY_URL must be either the placeholder or a https://*.workers.dev URL — got ${url}`
    ).toBe(true);
  });

  it('manifest grants host permission for the license Worker', () => {
    const url = isolated.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    if (url === '__XVM_LICENSE_WORKER__') return;
    const origin = new URL(url).origin;
    expect(manifest.host_permissions).toContain(`${origin}/*`);
  });

  it('isolated content script routes license network calls through background', () => {
    const isolatedUrl = isolated.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const backgroundUrl = background.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    expect(backgroundUrl).toBe(isolatedUrl);
    expect(isolated).toMatch(/chrome\.runtime\.sendMessage\s*\(\s*\{\s*type:\s*['"]XVM_LICENSE_PROXY['"]/);
    expect(background).toMatch(/message\.type\s*===\s*['"]XVM_LICENSE_PROXY['"]/);
    expect(background).toMatch(/LICENSE_PROXY_ACTIONS\s*=\s*new Set\(\s*\[\s*['"]activate['"],\s*['"]validate['"],\s*['"]deactivate['"]\s*\]\s*\)/);
  });

  it('tier-logic.js implements 24h cache + 7-day offline grace per ADR-0004', () => {
    const tier = readFileSync(resolve(repo, 'src/premium/license/tier-logic.js'), 'utf8');
    function intProduct(src, name) {
      const re = new RegExp(`${name}\\s*=\\s*([0-9 *]+);`);
      const m = src.match(re);
      if (!m) return null;
      const factors = m[1].split('*').map((s) => Number(s.trim()));
      if (factors.some((n) => !Number.isFinite(n))) return null;
      return factors.reduce((a, b) => a * b, 1);
    }
    expect(intProduct(tier, 'RECHECK_INTERVAL_MS'),
      'RECHECK_INTERVAL_MS must equal 24 hours in ms'
    ).toBe(24 * 60 * 60 * 1000);
    expect(intProduct(tier, 'OFFLINE_GRACE_MS'),
      'OFFLINE_GRACE_MS must equal 7 days in ms'
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('tier-logic.js declares 14-day trial; isolated.js seeds the timestamp', () => {
    const tier = readFileSync(resolve(repo, 'src/premium/license/tier-logic.js'), 'utf8');
    expect(/TRIAL_DAYS\s*=\s*14/.test(tier),
      'tier-logic.js must declare 14-day trial window'
    ).toBe(true);
    expect(/ensureTrialStarted/.test(isolated),
      'isolated.js must have ensureTrialStarted() seeding trialStartAt on first run'
    ).toBe(true);
  });

  it('isolated.js bootstraps trial start on first load', () => {
    // The IIFE body must invoke ensureTrialStarted (so a fresh install
    // immediately enters trial without needing user click).
    expect(/await\s+ensureTrialStarted\s*\(\s*\)/.test(isolated),
      'isolated.js must await ensureTrialStarted() at bootstrap'
    ).toBe(true);
  });

  it('isolated.js exposes async resolveTier() that delegates to tier-logic.resolveTierFrom', () => {
    expect(/async\s+function\s+resolveTier\s*\(\s*\)/.test(isolated),
      'isolated.js must define async resolveTier() wrapper'
    ).toBe(true);
    expect(/resolveTierFrom\s*\(/.test(isolated),
      'isolated.js resolveTier() must delegate to tier-logic.js resolveTierFrom'
    ).toBe(true);
  });

  it('isolated.js throttles failed background license revalidation', () => {
    expect(/REVALIDATE_RETRY_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(isolated),
      'isolated.js must keep the same 5-minute retry floor as popup-pro.js'
    ).toBe(true);
    expect(/function\s+shouldRevalidate\s*\(/.test(isolated),
      'isolated.js must centralize revalidate gating'
    ).toBe(true);
    expect(/stored\.lastTriedAt/.test(isolated),
      'isolated.js must honor lastTriedAt after network failures'
    ).toBe(true);
    expect(/offline-grace['"],\s*['"]stale/.test(isolated),
      'isolated.js must revalidate records after the 7-day offline grace expires instead of forcing repeat activation'
    ).toBe(true);
    expect(/if\s*\(shouldRevalidate\(status,\s*stored\)\)/.test(isolated),
      'getLicenseStatus() must not revalidate on every status read'
    ).toBe(true);
    expect(/if\s*\(shouldRevalidate\(r,\s*stored\)\)/.test(isolated),
      'resolveTier() must not revalidate on every tier request'
    ).toBe(true);
  });

  it('background revalidation keeps the stored activation on entitlement verification failures', () => {
    expect(/if\s*\(!entitlement\.ok\)\s*\{\s*await\s+safeStorageSet\s*\(\s*\{\s*\[STORAGE_KEY\]\s*:\s*\{\s*\.\.\.stored,\s*lastTriedAt:\s*Date\.now\(\)\s*\}\s*\}\s*\)/.test(isolated),
      'isolated.js must preserve xvm_license_v1 when a revalidate response cannot be trusted; deleting it forces repeat activation'
    ).toBe(true);
    expect(/if\s*\(!entitlement\.ok\)\s*\{\s*await\s+safeStorageRemove\s*\(\s*STORAGE_KEY\s*\)/.test(isolated),
      'isolated.js must not remove the stored activation just because Worker entitlement verification failed'
    ).toBe(false);
    const popup = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
    expect(/built\.error\s*===\s*['"]wrong_product['"]\s*\)/.test(popup),
      'popup-pro.js may discard only definitively wrong-product records during revalidate'
    ).toBe(true);
    expect(/bad_entitlement_signature|wrong_license_key/.test(
      popup.match(/if\s*\(!built\.ok\)\s*\{[\s\S]*?return built;\s*\}/)?.[0] || ''
    )).toBe(false);
  });

  it('isolated.js exposes the documented message contract', () => {
    const must = [
      'XVM_TIER_REQUEST',
      'XVM_TIER_UPDATE',
      'XVM_LICENSE_ACTIVATE',
      'XVM_LICENSE_ACTIVATE_RESULT',
      'XVM_LICENSE_DEACTIVATE',
      'XVM_LICENSE_DEACTIVATE_RESULT',
      'XVM_LICENSE_STATUS_REQUEST',
      'XVM_LICENSE_STATUS',
    ];
    for (const msg of must) {
      expect(isolated, `isolated.js must handle/emit ${msg}`).toMatch(new RegExp(`\\b${msg}\\b`));
    }
  });

  it('manifest loads isolated.js in ISOLATED world (no `world: MAIN`)', () => {
    const cs = manifest.content_scripts;
    const iso = cs.find((s) => s.js?.includes('src/premium/license/isolated.js'));
    expect(iso, 'isolated.js must appear in a content_scripts entry').toBeTruthy();
    expect(iso.world, 'isolated.js content_scripts entry must NOT set world:MAIN').not.toBe('MAIN');
    expect(iso.js, 'entitlement.js must load before isolated.js').toContain('src/premium/license/entitlement.js');
  });

  it('client verifies Worker-signed entitlement before storing Pro state', () => {
    const entitlement = readFileSync(resolve(repo, 'src/premium/license/entitlement.js'), 'utf8');
    const popup = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
    expect(entitlement).toMatch(/crypto\.subtle\.verify/);
    expect(entitlement).toMatch(/ENTITLEMENT_VERIFY_PUBLIC_JWK/);
    expect(entitlement).not.toMatch(/PRIVATE|HMAC_SECRET|SIGNING_PRIVATE/);
    expect(isolated).toMatch(/verifyEntitlementEnvelope/);
    expect(popup).toMatch(/verifyEntitlementEnvelope/);
  });

  it('Worker uses productId whitelist (CREEM_PRODUCT_IDS) — A decision', () => {
    expect(/CREEM_PRODUCT_IDS/.test(worker),
      'worker must support CREEM_PRODUCT_IDS whitelist (decision A)'
    ).toBe(true);
    expect(/getAllowedProductIds/.test(worker),
      'worker must have getAllowedProductIds() helper'
    ).toBe(true);
  });

  it('Worker signs short-lived entitlement envelopes with server-side private key', () => {
    expect(worker).toMatch(/ENTITLEMENT_SIGNING_PRIVATE_JWK/);
    expect(worker).toMatch(/entitlement_payload/);
    expect(worker).toMatch(/entitlement_sig/);
    expect(worker).toMatch(/ENTITLEMENT_TTL_SECONDS/);
  });

  it('Worker still injects x-api-key server-side', () => {
    expect(/x-api-key/.test(worker),
      'worker must forward x-api-key to Creem (server-side only)'
    ).toBe(true);
    expect(/env\.CREEM_API_KEY/.test(worker),
      'worker must pull API key from env, not from request'
    ).toBe(true);
  });

  it('XVM_PRODUCT_IDS lives in tier-logic.js (single source) — both XVM products present', () => {
    // Codex Blocker #1 refactor: scoping whitelist moved from
    // isolated.js + popup-pro.js mirror to a single tier-logic.js
    // declaration. Pure-module tests in premium-resolveTier.test.js
    // exercise scope behavior; this just pins the file location.
    const tier = readFileSync(resolve(repo, 'src/premium/license/tier-logic.js'), 'utf8');
    expect(/XVM_PRODUCT_IDS\s*=\s*\[/.test(tier),
      'tier-logic.js must declare XVM_PRODUCT_IDS whitelist'
    ).toBe(true);
    expect(tier.includes('prod_7f7t9EHK3RJlOK37DWr7J'),
      'tier-logic.js whitelist must contain Monthly product ID'
    ).toBe(true);
    expect(tier.includes('prod_69yTiXGXb04DKm46DNVbN9'),
      'tier-logic.js whitelist must contain Annual product ID'
    ).toBe(true);
    expect(/function\s+isXvmProduct\s*\(/.test(tier),
      'tier-logic.js must define isXvmProduct() helper'
    ).toBe(true);
  });

  it('isolated.js + popup-pro.js delegate to tier-logic.js (no inline duplicates)', () => {
    const popup = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
    for (const [name, body] of [['isolated.js', isolated], ['popup-pro.js', popup]]) {
      expect(/globalThis\.__xvmTierLogic/.test(body),
        `${name} must pull from globalThis.__xvmTierLogic`
      ).toBe(true);
      // Negative: must NOT inline its own XVM_PRODUCT_IDS array.
      expect(/XVM_PRODUCT_IDS\s*=\s*\[/.test(body),
        `${name} must NOT redeclare XVM_PRODUCT_IDS — single source is tier-logic.js`
      ).toBe(false);
      // Negative: must NOT inline its own pure tier helpers.
      expect(/function\s+licenseStatusFrom\s*\(/.test(body),
        `${name} must NOT define licenseStatusFrom — comes from tier-logic.js`
      ).toBe(false);
      expect(/function\s+resolveTierFrom\s*\(/.test(body),
        `${name} must NOT define resolveTierFrom — comes from tier-logic.js`
      ).toBe(false);
    }
  });

  it('tier-logic.js is dual-mode (globalThis + CommonJS)', () => {
    const tier = readFileSync(resolve(repo, 'src/premium/license/tier-logic.js'), 'utf8');
    expect(/root\.__xvmTierLogic\s*=\s*api/.test(tier),
      'tier-logic.js must expose api on globalThis.__xvmTierLogic'
    ).toBe(true);
    expect(/module\.exports\s*=\s*api/.test(tier),
      'tier-logic.js must also CommonJS-export api for vitest'
    ).toBe(true);
  });

  it('gate.js still single entry — filter.js does not call client/isolated APIs directly', () => {
    // Filter should NOT postMessage XVM_LICENSE_* (that's UI responsibility).
    expect(/XVM_LICENSE_ACTIVATE|XVM_LICENSE_DEACTIVATE/.test(filter),
      'filter.js MUST NOT initiate license activation/deactivation flows'
    ).toBe(false);
    // Filter should still go through gate.
    expect(/__xvmPro\?\.isFeatureEnabled\(['"]rate-filter['"]\)/.test(filter),
      'filter.js must still query gate (no behavior regression from step 1)'
    ).toBe(true);
  });
});
