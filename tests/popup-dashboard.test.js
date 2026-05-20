// #45 popup redesign — Tabs (mock A, locked 2026-05-19, 3rd UI pivot).
// Pins the 4-tab layout + Filter sub-tabs + dual theme + nested controls.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const html      = readFileSync(resolve(repo, 'popup.html'),         'utf8');
const dashJs    = readFileSync(resolve(repo, 'popup-dashboard.js'), 'utf8');
const proJs     = readFileSync(resolve(repo, 'src/premium/license/popup-pro.js'), 'utf8');
const rfJs      = readFileSync(resolve(repo, 'src/premium/rate-filter/popup-rate-filter.js'), 'utf8');
const bridgeJs  = readFileSync(resolve(repo, 'bridge.js'),          'utf8');
const popupJs   = readFileSync(resolve(repo, 'popup.js'),           'utf8');

describe('#45 popup tabs structure (mock A)', () => {
  it('body declares data-tab default "filter" + data-tier "free" + data-theme "light"', () => {
    expect(/<body[^>]*data-tab="filter"/.test(html)).toBe(true);
    expect(/<body[^>]*data-tier="free"/.test(html)).toBe(true);
    expect(/<body[^>]*data-theme="light"/.test(html)).toBe(true);
  });

  it('declares 4 tab buttons (role=tab) with data-tab values', () => {
    for (const name of ['pro', 'filter', 'leaderboard', 'about']) {
      expect(new RegExp(`<button[^>]*role="tab"[^>]*data-tab="${name}"`).test(html),
        `popup.html must contain <button role="tab" data-tab="${name}">`
      ).toBe(true);
    }
  });

  it('Filter tab is the default active (aria-selected="true")', () => {
    const filterBtn = html.match(/<button[^>]*data-tab="filter"[^>]*>/)?.[0] || '';
    expect(/aria-selected="true"/.test(filterBtn),
      'Filter tab must be the default-selected (Pro feature surface)'
    ).toBe(true);
  });

  it('declares 4 tab panels (data-tab-panel) matching the 4 tabs', () => {
    for (const name of ['pro', 'filter', 'leaderboard', 'about']) {
      expect(new RegExp(`data-tab-panel="${name}"`).test(html),
        `popup.html must contain a panel with data-tab-panel="${name}"`
      ).toBe(true);
    }
  });

  it('header includes tier chip + theme toggle button', () => {
    expect(/id="tier-chip"/.test(html)).toBe(true);
    expect(/id="theme-toggle"/.test(html)).toBe(true);
    expect(/<symbol id="icon-sun"/.test(html)).toBe(true);
    expect(/<symbol id="icon-moon"/.test(html)).toBe(true);
  });

  it('Pro tab includes inline activate form + Coming-soon M2 list', () => {
    const pro = html.match(/data-tab-panel="pro"[\s\S]*?(?=role="tabpanel"|<\/section>\s*$)/)?.[0] || '';
    expect(/id="activate-inline"/.test(pro)).toBe(true);
    expect(/class="coming-list"/.test(pro)).toBe(true);
    // 3 stubs: color-card, webhook, bark
    expect((pro.match(/icon-palette|icon-webhook|icon-bell/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('Filter tab hosts #rate-filter-section', () => {
    const filter = html.match(/data-tab-panel="filter"[\s\S]*?(?=<\/section>)/)?.[0] || '';
    expect(/id="rate-filter-section"/.test(filter)).toBe(true);
  });

  it('Leaderboard tab hosts badge thresholds + leaderboard feature row', () => {
    const lb = html.match(/data-tab-panel="leaderboard"[\s\S]*?(?=<section role="tabpanel")/)?.[0] || '';
    expect(/id="trending"/.test(lb)).toBe(true);
    expect(/id="viral"/.test(lb)).toBe(true);
    expect(/id="badge-style"/.test(lb)).toBe(true);
    expect(/id="feat-leaderboard"/.test(lb)).toBe(true);
    expect(/id="lb-reset-pos"/.test(lb)).toBe(true);
  });

  it('About tab hosts Other features + Grok prompt cards + theme toggle entry', () => {
    const about = html.match(/data-tab-panel="about"[\s\S]*?(?=<\/div>\s*<div id="xvm-toast")/)?.[0] || '';
    expect(/id="feat-copy-md"/.test(about)).toBe(true);
    expect(/id="feat-starchart"/.test(about)).toBe(true);
    expect(/id="feat-bookmark-count"/.test(about)).toBe(true);
    expect(/id="grok-prompt"/.test(about)).toBe(true);
    expect(/id="grok-article-prompt"/.test(about)).toBe(true);
    expect(/id="theme-toggle-about"/.test(about)).toBe(true);
  });

  it('keeps all legacy IDs popup.js / popup-rate-filter.js / popup-pro.js depend on', () => {
    for (const id of ['settings-form', 'trending', 'viral', 'badge-style', 'reset',
                      'feat-leaderboard', 'feat-copy-md', 'feat-starchart',
                      'feat-bookmark-count', 'lb-count', 'lb-col-list',
                      'lb-reset-pos', 'lb-reset-msg',
                      'grok-template-select', 'grok-prompt', 'grok-prompt-save',
                      'grok-article-template-select', 'grok-article-prompt',
                      'rate-filter-section', 'xvm-pro-section']) {
      expect(new RegExp(`id="${id}"`).test(html), `popup.html must keep id="${id}"`).toBe(true);
    }
  });

  it('loads scripts in order: tier-logic → popup-pro → popup-rate-filter → popup.js → popup-dashboard', () => {
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual([
      'src/premium/license/tier-logic.js',
      'src/premium/license/popup-pro.js',
      'src/premium/rate-filter/popup-rate-filter.js',
      'popup.js',
      'popup-dashboard.js',
    ]);
  });

  it('every popup.html <script src="…"> root-level file is in scripts/build-dist.mjs ITEMS', () => {
    // Codex finding: dist/ build script silently dropped popup-dashboard.js,
    // so the file 404'd at extension load → every click handler dead.
    // Pin every root-level script reference against the ITEMS list so this
    // class of bug can't recur.
    const buildScript = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');
    const itemsBlock = buildScript.match(/ITEMS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
    const items = [...itemsBlock.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);

    const rootScripts = [...html.matchAll(/<script\s+src="([^"\/]+\.js)"/g)].map((m) => m[1]);
    for (const s of rootScripts) {
      expect(items.includes(s),
        `scripts/build-dist.mjs ITEMS must include "${s}" (referenced by popup.html)`
      ).toBe(true);
    }
  });
});

describe('#45 dual theme (light warm default + dark slate)', () => {
  it(':root declares warm light tokens (sand bg, copper accent)', () => {
    // popup.html should define the LIGHT theme on :root.
    expect(/:root\s*\{[\s\S]*?--bg:\s*#f4efe5/.test(html), 'light bg #f4efe5').toBe(true);
    expect(/:root\s*\{[\s\S]*?--accent:\s*#bf5a2a/.test(html), 'light accent #bf5a2a (warm orange-brown)').toBe(true);
  });

  it('body[data-theme="dark"] overrides tokens to slate-950 + cyan-500', () => {
    expect(/body\[data-theme="dark"\]\s*\{[\s\S]*?--bg:\s*#020617/.test(html)).toBe(true);
    expect(/body\[data-theme="dark"\]\s*\{[\s\S]*?--accent:\s*#06b6d4/.test(html)).toBe(true);
  });

  it('popup-dashboard.js wires #theme-toggle + #theme-toggle-about + chrome.storage.sync', () => {
    expect(/theme-toggle/.test(dashJs)).toBe(true);
    expect(/theme-toggle-about/.test(dashJs)).toBe(true);
    expect(/THEME_KEY\s*=\s*['"]theme['"]/.test(dashJs)).toBe(true);
    // 3-state theme (light / dark / system); default 'system' so a fresh
    // install matches the user's OS (#1 of v1.7.0 follow-up polish).
    expect(/chrome\.storage\.sync\.get\s*\(\s*\{\s*\[THEME_KEY\]:\s*['"]system['"]/.test(dashJs),
      'must default to "system" when reading theme (new 3-state default)'
    ).toBe(true);
    expect(/THEME_ORDER\s*=\s*\[\s*['"]light['"]\s*,\s*['"]dark['"]\s*,\s*['"]system['"]\s*\]/.test(dashJs),
      'THEME_ORDER must whitelist [light, dark, system] in that rotation order'
    ).toBe(true);
  });

  it('theme toggle persists via chrome.storage.sync.set', () => {
    expect(/chrome\.storage\.sync\.set\s*\(\s*\{\s*\[THEME_KEY\]/.test(dashJs)).toBe(true);
  });
});

describe('#45 Filter sub-tabs (Short / Long)', () => {
  it('popup-rate-filter.js renders sub-tab buttons for short + long', () => {
    expect(/data-sub-tab="short"/.test(rfJs)).toBe(true);
    expect(/data-sub-tab="long"/.test(rfJs)).toBe(true);
  });
  it('popup-rate-filter.js renders matching sub-panels', () => {
    expect(/data-sub-panel="short"/.test(rfJs)).toBe(true);
    expect(/data-sub-panel="long"/.test(rfJs)).toBe(true);
  });
  it('Short sub-panel default-active', () => {
    expect(/data-sub-tab="short"[^>]*aria-selected="true"/.test(rfJs)
      || /data-sub-panel="short"[^>]*data-active="1"/.test(rfJs)
    ).toBe(true);
  });
  it('Short/Long thresholds inputs preserved (mirror invariant intact)', () => {
    for (const id of ['rf-shortRateThreshold', 'rf-shortAbsoluteThreshold',
                      'rf-longRateThreshold',  'rf-longAbsoluteThreshold']) {
      expect(new RegExp(`id="${id}"`).test(rfJs)).toBe(true);
    }
  });
});

describe('#45 popup-dashboard.js tab router', () => {
  it('exposes setTab function + TABS whitelist', () => {
    expect(/function\s+setTab\s*\(/.test(dashJs)).toBe(true);
    expect(/TABS\s*=\s*\[\s*['"]pro['"]\s*,\s*['"]filter['"]\s*,\s*['"]leaderboard['"]\s*,\s*['"]about['"]\s*\]/.test(dashJs)).toBe(true);
  });
  it('wires aria-selected updates on tab click', () => {
    expect(/aria-selected/.test(dashJs)).toBe(true);
  });
  it('listens for xvm-pro-nav (activate link click)', () => {
    expect(/xvm-pro-nav/.test(dashJs)).toBe(true);
    expect(/['"]activate['"]/.test(dashJs)).toBe(true);
  });
  it('tier-chip updates via MutationObserver on body data-tier', () => {
    expect(/MutationObserver/.test(dashJs)).toBe(true);
    expect(/data-tier/.test(dashJs)).toBe(true);
  });
});

describe('#45 popup-pro.js Pro-tab rendering', () => {
  it('uses .tier-big / .tier-sub / .pro-cta-row / .pro-meta classes (mock A)', () => {
    expect(/className\s*=\s*['"]tier-big['"]/.test(proJs)).toBe(true);
    expect(/className\s*=\s*['"]tier-sub['"]/.test(proJs)).toBe(true);
    expect(/className\s*=\s*['"]pro-cta-row['"]/.test(proJs)).toBe(true);
    expect(/className\s*=\s*['"]pro-meta['"]/.test(proJs)).toBe(true);
  });
  it('writes document.body.dataset.tier so global CSS tier-color rules apply', () => {
    expect(/document\.body\.dataset\.tier\s*=\s*tier/.test(proJs)).toBe(true);
  });
  it('exposes window.__xvmProDays for tier-chip days-left display', () => {
    expect(/window\.__xvmProDays/.test(proJs)).toBe(true);
    expect(/xvm-pro-days/.test(proJs)).toBe(true);
  });
  it('emits xvm-pro-nav { view: activate } from the Activate Existing link', () => {
    expect(/xvm-pro-nav[\s\S]*detail:\s*\{\s*view:\s*['"]activate['"]\s*\}/.test(proJs)
      || /detail:\s*\{\s*view:\s*['"]activate['"]\s*\}[\s\S]*xvm-pro-nav/.test(proJs)
    ).toBe(true);
  });
});

describe('#45 i18n keys (mock A + dual theme)', () => {
  it('en + zh_CN locales declare all new keys', () => {
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const required = [
      'tabPro', 'tabFilter', 'tabLeaderboard', 'tabAbout',
      'rfSubShort', 'rfSubLong',
      'comingListTitle',
      'chipTierFree', 'chipTierTrial', 'chipTierPro',
      'chipTrialDays', 'chipTrialOne',
      'themeLabel', 'themeHint', 'themeSwitchToDark', 'themeSwitchToLight',
      'advAppearanceTitle',
    ];
    for (const k of required) {
      expect(en[k]?.message, `en must declare ${k}`).toBeTruthy();
      expect(zh[k]?.message, `zh_CN must declare ${k}`).toBeTruthy();
    }
  });
});

describe('#45 carry-over invariants', () => {
  it('leaderboard default ON (bridge + popup mirror)', () => {
    expect(/featureVelocityLeaderboard:\s*true/.test(bridgeJs)).toBe(true);
    expect(/featureVelocityLeaderboard:\s*true/.test(popupJs)).toBe(true);
  });
});
