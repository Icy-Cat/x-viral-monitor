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

  it('isolated.js implements 24h cache + 7-day offline grace per ADR-0004', () => {
    // Extract the const initializer expression and evaluate the integer
    // product. Length-agnostic so future tweaks (e.g. extra factor) still
    // pass as long as the resolved milliseconds match.
    function intProduct(src, name) {
      const re = new RegExp(`${name}\\s*=\\s*([0-9 *]+);`);
      const m = src.match(re);
      if (!m) return null;
      const factors = m[1].split('*').map((s) => Number(s.trim()));
      if (factors.some((n) => !Number.isFinite(n))) return null;
      return factors.reduce((a, b) => a * b, 1);
    }
    expect(intProduct(isolated, 'RECHECK_INTERVAL_MS'),
      'RECHECK_INTERVAL_MS must equal 24 hours in ms'
    ).toBe(24 * 60 * 60 * 1000);
    expect(intProduct(isolated, 'OFFLINE_GRACE_MS'),
      'OFFLINE_GRACE_MS must equal 7 days in ms'
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('isolated.js implements 14-day trial state machine', () => {
    expect(/TRIAL_DAYS\s*=\s*14/.test(isolated),
      'isolated.js must declare 14-day trial window'
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

  it('isolated.js has ONE tier resolution function (single source of truth)', () => {
    // The function name is `resolveTier` and it should be the only place
    // that combines license + trial into a tier verdict.
    const calls = (isolated.match(/resolveTier\s*\(/g) || []).length;
    expect(/async\s+function\s+resolveTier\s*\(\s*\)/.test(isolated),
      'isolated.js must define resolveTier() as the single tier resolver'
    ).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2); // definition + at least one call
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
  });

  it('Worker uses productId whitelist (CREEM_PRODUCT_IDS) — A decision', () => {
    expect(/CREEM_PRODUCT_IDS/.test(worker),
      'worker must support CREEM_PRODUCT_IDS whitelist (decision A)'
    ).toBe(true);
    expect(/parseProductIds/.test(worker),
      'worker must have parseProductIds() helper'
    ).toBe(true);
  });

  it('Worker still injects x-api-key server-side', () => {
    expect(/x-api-key/.test(worker),
      'worker must forward x-api-key to Creem (server-side only)'
    ).toBe(true);
    expect(/env\.CREEM_API_KEY/.test(worker),
      'worker must pull API key from env, not from request'
    ).toBe(true);
  });

  it('isolated.js + popup-pro.js BOTH enforce XVM productId scoping (#45 shared-Worker follow-up)', () => {
    // Shared Worker between x-md-paste and XVM means client-side scoping
    // is REQUIRED to prevent an x-md-paste license from activating XVM.
    const popup = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
    for (const [name, body] of [['isolated.js', isolated], ['popup-pro.js', popup]]) {
      expect(/XVM_PRODUCT_IDS/.test(body),
        `${name} must declare XVM_PRODUCT_IDS whitelist`
      ).toBe(true);
      expect(/isXvmProduct/.test(body),
        `${name} must use isXvmProduct() helper`
      ).toBe(true);
      expect(body.includes('prod_7f7t9EHK3RJlOK37DWr7J'),
        `${name} whitelist must contain Monthly product ID`
      ).toBe(true);
      expect(body.includes('prod_69yTiXGXb04DKm46DNVbN9'),
        `${name} whitelist must contain Annual product ID`
      ).toBe(true);
    }
  });

  it('isolated.js + popup-pro.js XVM_PRODUCT_IDS arrays match exactly', () => {
    const popup = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
    function extractIds(src) {
      const m = src.match(/XVM_PRODUCT_IDS\s*=\s*\[([\s\S]*?)\]/);
      if (!m) return null;
      return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).sort();
    }
    const a = extractIds(isolated);
    const b = extractIds(popup);
    expect(a, 'isolated.js must declare XVM_PRODUCT_IDS array').not.toBeNull();
    expect(b, 'popup-pro.js must declare XVM_PRODUCT_IDS array').not.toBeNull();
    expect(a).toEqual(b);
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
