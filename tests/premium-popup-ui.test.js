// #45 step 3 — popup UI contract tests.
// Pins the popup-pro wiring + the "still no Creem secret in code" invariant.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const html = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const js   = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');

describe('#45 step 3 — popup pro UI', () => {
  it('popup.html includes the pro section + script', () => {
    expect(/id="xvm-pro-section"/.test(html),
      'popup.html must include <section id="xvm-pro-section">'
    ).toBe(true);
    expect(/<script\s+src="src\/premium\/license\/popup-pro\.js"/.test(html),
      'popup.html must load src/premium/license/popup-pro.js'
    ).toBe(true);
  });

  it('popup-pro.js contains NO Creem API key literal', () => {
    expect(/creem_(?:live|test)_[A-Za-z0-9]/.test(js),
      'popup-pro.js must not embed a Creem API key'
    ).toBe(false);
  });

  it('popup-pro.js never calls api.creem.io directly', () => {
    expect(/api\.creem\.io/.test(js),
      'popup-pro.js must call the Worker proxy, not Creem directly'
    ).toBe(false);
  });

  it('popup-pro.js LICENSE_PROXY_URL is placeholder OR a https://*.workers.dev URL', () => {
    const m = js.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/);
    expect(m, 'popup-pro.js must declare LICENSE_PROXY_URL').not.toBeNull();
    const url = m[1];
    const isPlaceholder = url === '__XVM_LICENSE_WORKER__';
    const isWorkerUrl = /^https:\/\/[a-z0-9.-]+\.workers\.dev\/?$/.test(url);
    expect(isPlaceholder || isWorkerUrl,
      `popup-pro.js LICENSE_PROXY_URL must be placeholder or workers.dev URL — got ${url}`
    ).toBe(true);
  });

  it('popup-pro.js LICENSE_PROXY_URL matches isolated.js (mirror invariant)', () => {
    const isolated = readFileSync(resolve(repo, 'src/premium/license/isolated.js'), 'utf8');
    const a = isolated.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    const b = js.match(/LICENSE_PROXY_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).toBe(b);
  });

  it('popup.html loads entitlement verifier before popup-pro.js', () => {
    expect(html.indexOf('src/premium/license/entitlement.js')).toBeGreaterThan(-1);
    expect(html.indexOf('src/premium/license/entitlement.js')).toBeLessThan(html.indexOf('src/premium/license/popup-pro.js'));
  });

  it('popup-pro.js delegates tier resolution to tier-logic.js (no inline duplication)', () => {
    // After the Codex Blocker #1 refactor, RECHECK_INTERVAL_MS /
    // OFFLINE_GRACE_MS / TRIAL_DAYS are owned by tier-logic.js only.
    // popup-pro.js must (a) pull from globalThis.__xvmTierLogic and
    // (b) not redeclare those constants.
    expect(/globalThis\.__xvmTierLogic/.test(js),
      'popup-pro.js must pull tier helpers from globalThis.__xvmTierLogic'
    ).toBe(true);
    expect(/resolveTierFrom/.test(js),
      'popup-pro.js must call resolveTierFrom (tier-logic.js)'
    ).toBe(true);
    // Negative: no inline duplicates.
    expect(/function\s+trialStatus\s*\(/.test(js),
      'popup-pro.js must NOT define its own trialStatus()'
    ).toBe(false);
    expect(/function\s+resolveTier(?:From)?\s*\(/.test(js)
      && !/async\s+function\s+resolveTier\s*\([^)]*\)/.test(js),
      'popup-pro.js may only have the async resolveTier wrapper, not a pure resolveTierFrom redefinition'
    ).toBe(false);
  });

  it('popup-pro.js revalidates stale or expired entitlement records through the Worker', () => {
    expect(/callProxy\(['"]validate['"]/.test(js),
      'popup-pro.js should call Worker /validate instead of waiting for an x.com content script'
    ).toBe(true);
    expect(/shouldRevalidate/.test(js)).toBe(true);
    expect(/REVALIDATE_RETRY_MS/.test(js)).toBe(true);
  });

  it('popup-pro.js wires both Creem payment URLs', () => {
    expect(/prod_7f7t9EHK3RJlOK37DWr7J/.test(js),
      'popup-pro.js must reference Monthly product (prod_7f7...)'
    ).toBe(true);
    expect(/prod_69yTiXGXb04DKm46DNVbN9/.test(js),
      'popup-pro.js must reference Annual product (prod_69y...)'
    ).toBe(true);
  });

  it('popup-pro.js masks license keys', () => {
    expect(/maskKey/.test(js),
      'popup-pro.js must mask license keys for display'
    ).toBe(true);
  });

  it('popup-pro.js surfaces trial daysLeft in the hero subtitle', () => {
    // Mock D pivot: the dedicated "≤3 days nudge" box was replaced by
    // the hero subtitle which always shows "X days left in trial".
    // The urgency is communicated by the giant TRIAL label + the
    // subtitle, not a separate yellow nudge. We pin that trial
    // rendering still threads days through:
    expect(/heroTrialDaysLeft|heroTrialDayOne/.test(js),
      'popup-pro.js must localize the trial subtitle via heroTrialDaysLeft / heroTrialDayOne'
    ).toBe(true);
  });

  it('popup-pro.js uses chrome.i18n.getMessage (i18n wired)', () => {
    expect(/chrome\?\.i18n\?\.getMessage/.test(js),
      'popup-pro.js must call chrome.i18n.getMessage for localized strings'
    ).toBe(true);
  });

  it('zh_CN + en locales declare the pro i18n keys', () => {
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const required = [
      'proBannerFree', 'proBannerPro', 'proBannerTrial', 'proBannerTrialOne',
      'proNudgeTrialEnd', 'proNudgeTrialEndOne',
      'proCtaMonthly', 'proCtaAnnual',
      'proActivateLabel', 'proActivateBtn', 'proActivating', 'proActivatedOk',
      'proActErrFormat', 'proActErrWorkerUnset', 'proActErrGeneric',
      'proLicenseField', 'proActivatedField', 'proExpiresField',
      'proManageBtn', 'proDeactivateBtn', 'proDeactivating', 'proDeactivatedOk',
      'proDeactivateErr',
    ];
    for (const key of required) {
      expect(en[key]?.message, `en/messages.json must declare ${key}`).toBeTruthy();
      expect(zh[key]?.message, `zh_CN/messages.json must declare ${key}`).toBeTruthy();
    }
  });

  it('price copy escapes literal dollar signs for chrome.i18n', () => {
    const locales = ['en', 'zh_CN', 'ja'];
    const priceKeys = [
      'proCtaMonthly', 'proCtaAnnual',
      'heroCtaUpgradeAnnual', 'heroCtaUpgradeMonthly',
      'contentLbHotMonthly', 'contentLbHotAnnual',
    ];
    for (const locale of locales) {
      const messages = JSON.parse(readFileSync(resolve(repo, `_locales/${locale}/messages.json`), 'utf8'));
      for (const key of priceKeys) {
        expect(messages[key]?.message, `${locale}/${key} must include escaped literal $`).toMatch(/\$\$(?:2\.9|29)/);
      }
    }
  });
});
