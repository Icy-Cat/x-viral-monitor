// #45 step 3 follow-up — rate-filter popup settings UI.
// User dev1 test caught: PoC popup settings UI was not migrated to xvm.
// This test pins the wiring so it can't silently drop again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const html      = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const popupRf   = readFileSync(resolve(repo, 'src/premium/rate-filter/popup-rate-filter.js'), 'utf8');
const filter    = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
const isolated  = readFileSync(resolve(repo, 'src/premium/license/isolated.js'), 'utf8');
const bridge    = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const content   = readFileSync(resolve(repo, 'content.js'), 'utf8');
const manifest  = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

function loadRateFilterDebug(pathname = '/home') {
  const win = {
    location: { pathname },
    addEventListener() {},
    postMessage() {},
    __xvmPro: {
      isFeatureEnabled: () => false,
      onTierChange() {},
    },
  };
  const context = {
    window: win,
    document: {
      documentElement: {},
      querySelectorAll: () => [],
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
  };
  vm.runInNewContext(filter, context);
  return win.__xvmRateFilter._debug;
}

describe('#45 rate-filter popup settings (dev1 gap fix)', () => {
  it('popup.html includes #rate-filter-section and loads popup-rate-filter.js', () => {
    expect(/id="rate-filter-section"/.test(html),
      'popup.html must contain <section id="rate-filter-section">'
    ).toBe(true);
    expect(/<script\s+src="src\/premium\/rate-filter\/popup-rate-filter\.js"/.test(html),
      'popup.html must load popup-rate-filter.js'
    ).toBe(true);
  });

  it('popup-rate-filter.js owns xvm_rate_filter_v1 storage key', () => {
    expect(/STORAGE_KEY\s*=\s*['"]xvm_rate_filter_v1['"]/.test(popupRf),
      'popup-rate-filter.js must declare STORAGE_KEY = "xvm_rate_filter_v1"'
    ).toBe(true);
  });

  it('popup-rate-filter.js defaults match locked decisions (global switch + scope settings)', () => {
    // The floating leaderboard owns the global `enabled` switch. Popup and
    // floating settings both edit scope flags, which stay independently
    // opt-in so a fresh install never hides anything.
    expect(/enabled:\s*false\b/.test(popupRf)).toBe(true);
    expect(/__scopeMigratedV2:\s*true/.test(popupRf)).toBe(true);
    expect(/scopeHome:\s*false\b/.test(popupRf)).toBe(true);
    expect(/scopeList:\s*false\b/.test(popupRf)).toBe(true);
    expect(/scopeProfile:\s*false\b/.test(popupRf)).toBe(true);
    expect(/scopeStatus:\s*false\b/.test(popupRf)).toBe(true);
    // Threshold defaults unchanged.
    expect(/shortRateThreshold:\s*1000\b/.test(popupRf)).toBe(true);
    expect(/shortAbsoluteThreshold:\s*10000\b/.test(popupRf)).toBe(true);
    expect(/longRateThreshold:\s*1000\b/.test(popupRf)).toBe(true);
    expect(/longAbsoluteThreshold:\s*10000\b/.test(popupRf)).toBe(true);
  });

  it('filter.js SETTINGS defaults match popup-rate-filter.js DEFAULTS (mirror)', () => {
    const filter = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
    expect(/shortRateThreshold:\s*1000\b/.test(filter)).toBe(true);
    expect(/shortAbsoluteThreshold:\s*10000\b/.test(filter)).toBe(true);
    expect(/longRateThreshold:\s*1000\b/.test(filter)).toBe(true);
    expect(/longAbsoluteThreshold:\s*10000\b/.test(filter)).toBe(true);
    // filter.js DEFAULTS must mirror popup-rate-filter.js DEFAULTS so the
    // gap between activate() and the first XVM_RATE_SETTINGS_UPDATE can
    // never filter under stale all-true defaults.
    expect(/enabled:\s*false\b/.test(filter)).toBe(true);
    expect(/scopeHome:\s*false\b/.test(filter)).toBe(true);
    expect(/scopeList:\s*false\b/.test(filter)).toBe(true);
    expect(/scopeProfile:\s*false\b/.test(filter)).toBe(true);
    expect(/scopeStatus:\s*false\b/.test(filter)).toBe(true);
  });

  it('popup-rate-filter.js is tier-aware (locks form when free)', () => {
    expect(/setLocked\s*\(/.test(popupRf),
      'must define setLocked()'
    ).toBe(true);
    expect(/tier\s*===\s*['"]free['"]/.test(popupRf),
      'must check tier === "free" to set locked'
    ).toBe(true);
    expect(/__xvmTierLogic/.test(popupRf),
      'must use tier-logic.js for tier resolution (not its own)'
    ).toBe(true);
  });

  it('isolated.js forwards rate-filter settings to MAIN world', () => {
    expect(/RATE_FILTER_KEY\s*=\s*['"]xvm_rate_filter_v1['"]/.test(isolated),
      'isolated.js must declare RATE_FILTER_KEY'
    ).toBe(true);
    expect(/XVM_RATE_SETTINGS_UPDATE/.test(isolated),
      'isolated.js must emit XVM_RATE_SETTINGS_UPDATE postMessage'
    ).toBe(true);
    expect(/pushRateSettings/.test(isolated),
      'isolated.js must have pushRateSettings() helper'
    ).toBe(true);
  });

  it('filter.js listens for XVM_RATE_SETTINGS_UPDATE and calls updateSettings', () => {
    expect(/XVM_RATE_SETTINGS_UPDATE/.test(filter),
      'filter.js must listen for XVM_RATE_SETTINGS_UPDATE'
    ).toBe(true);
    expect(/updateSettings\s*\(\s*event\.data\.settings/.test(filter),
      'filter.js must call updateSettings(event.data.settings) on the message'
    ).toBe(true);
  });

  it('leaderboard hot-only switch requests current settings after late mount', () => {
    expect(/XVM_RATE_FILTER_REQUEST/.test(content),
      'content.js must request current rate-filter settings when the leaderboard mounts'
    ).toBe(true);
    expect(/XVM_RATE_FILTER_REQUEST/.test(bridge),
      'bridge.js must answer the leaderboard settings request from chrome.storage.local'
    ).toBe(true);
    expect(/xvm_rate_filter_v1/.test(bridge),
      'bridge.js request handler must read the xvm_rate_filter_v1 storage key'
    ).toBe(true);
  });

  it('leaderboard hot-only switch keeps data-tier in sync for late-created settings panel', () => {
    expect(/hot\.dataset\.tier\s*=\s*tier/.test(content),
      'setLeaderboardHotSwitchState() must write the resolved tier back to data-tier; otherwise a trial user who opens the settings panel after tier sync still clicks a data-tier="free" switch'
    ).toBe(true);
  });

  it('leaderboard hot-only click handlers use resolved trial/pro tier, not only stale DOM data-tier', () => {
    expect(/const\s+tier\s*=\s*leaderboardTier\s*\|\|\s*hot\.dataset\.tier\s*\|\|\s*['"]free['"]/.test(content),
      'hot-only click handlers must fall back to leaderboardTier so trial/pro users are not blocked by stale data-tier="free" markup'
    ).toBe(true);
  });

  it('rate-filter scope URL classifier covers home, list, profile, and tweet detail', () => {
    const debug = loadRateFilterDebug();
    expect(debug.scopeFromPath('/home')).toBe('home');
    expect(debug.scopeFromPath('/i/lists/123456789')).toBe('list');
    expect(debug.scopeFromPath('/alice/lists/research')).toBe('list');
    expect(debug.scopeFromPath('/alice')).toBe('profile');
    expect(debug.scopeFromPath('/alice/status/2056354028137939232')).toBe('status');
  });

  it('rate-filter observes GraphQL endpoints for configured URL scopes', () => {
    for (const endpoint of [
      'HomeTimeline',
      'HomeLatestTimeline',
      'ListLatestTweetsTimeline',
      'UserTweets',
      'UserTweetsAndReplies',
      'TweetDetail',
    ]) {
      expect(filter, `filter.js must observe ${endpoint}`).toContain(endpoint);
    }
  });

  it('manifest loads popup-rate-filter.js NEVER (popup-only)', () => {
    // popup-rate-filter.js is a popup-context script; it must NOT appear
    // in manifest content_scripts (would run on x.com unnecessarily and
    // attempt to access DOM elements that don't exist there).
    for (const cs of manifest.content_scripts || []) {
      const js = cs.js || [];
      expect(js.includes('src/premium/rate-filter/popup-rate-filter.js'),
        'popup-rate-filter.js must NOT be in content_scripts (popup-only)'
      ).toBe(false);
    }
  });

  it('i18n keys for rate filter present in en + zh_CN + ja locales', () => {
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const ja = JSON.parse(readFileSync(resolve(repo, '_locales/ja/messages.json'), 'utf8'));
    const required = [
      'rfTitle', 'rfLockedHint', 'rfEnabled',
      'rfScopeLegend', 'rfScopeHome', 'rfScopeList', 'rfScopeProfile', 'rfScopeStatus',
      'rfShortLegend', 'rfLongLegend',
      'rfRatePerMin', 'rfAbsoluteViews',
      'rfRuleHint', 'rfReset', 'rfSave', 'rfSavedOk', 'rfResetOk',
    ];
    for (const k of required) {
      expect(en[k]?.message, `en must declare ${k}`).toBeTruthy();
      expect(zh[k]?.message, `zh_CN must declare ${k}`).toBeTruthy();
      expect(ja[k]?.message, `ja must declare ${k}`).toBeTruthy();
    }
  });
});
