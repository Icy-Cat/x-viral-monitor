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
const contentJs = readFileSync(resolve(repo, 'content.js'),         'utf8');
const stylesCss = readFileSync(resolve(repo, 'styles.css'),         'utf8');
const userScript = readFileSync(resolve(repo, 'userscript/x-viral-monitor.user.js'), 'utf8');
const backgroundJs = readFileSync(resolve(repo, 'background.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(repo, 'package-lock.json'), 'utf8'));
const buildDistJs = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');

describe('#45 popup tabs structure (mock A)', () => {
  it('body declares data-tab default "filter" + data-tier "free" + data-theme "light"', () => {
    expect(/<body[^>]*data-tab="filter"/.test(html)).toBe(true);
    expect(/<body[^>]*data-tier="free"/.test(html)).toBe(true);
    expect(/<body[^>]*data-theme="light"/.test(html)).toBe(true);
  });

  it('declares 5 tab buttons (role=tab) with data-tab values', () => {
    for (const name of ['pro', 'filter', 'leaderboard', 'ai', 'about']) {
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

  it('declares 5 tab panels (data-tab-panel) matching the 5 tabs', () => {
    for (const name of ['pro', 'filter', 'leaderboard', 'ai', 'about']) {
      expect(new RegExp(`data-tab-panel="${name}"`).test(html),
        `popup.html must contain a panel with data-tab-panel="${name}"`
      ).toBe(true);
    }
  });

  it('header includes the SVG app icon, tier chip, language button, and theme toggle button', () => {
    expect(/<img class="app-logo" src="icons\/icon_origin\.svg" alt="X Viral Monitor">/.test(html)).toBe(true);
    expect(/id="tier-chip"/.test(html)).toBe(true);
    expect(/id="language-toggle"/.test(html)).toBe(true);
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

  it('About tab hosts Other features + theme toggle entry', () => {
    const about = html.match(/data-tab-panel="about"[\s\S]*?(?=<\/div>\s*<div id="xvm-toast")/)?.[0] || '';
    expect(/id="feat-copy-md"/.test(about)).toBe(true);
    expect(/id="feat-starchart"/.test(about)).toBe(true);
    expect(/id="feat-bookmark-folders"/.test(about)).toBe(true);
    expect(/id="feat-bookmark-count"/.test(about)).toBe(true);
    expect(/id="grok-enter-reply"/.test(about)).toBe(true);
    expect(/id="grok-prompt"/.test(about)).toBe(false);
    expect(/id="grok-article-prompt"/.test(about)).toBe(false);
    expect(/id="theme-toggle-about"/.test(about)).toBe(true);
    expect(/id="show-update-notes"/.test(about)).toBe(true);
    expect(/data-i18n="aboutShowUpdateNotes"/.test(about)).toBe(true);
  });

  it('places Enter-to-reply under Other features, not inside the Grok template editor', () => {
    const other = html.match(/<div class="panel-card">\s*<h3 data-i18n="advOtherFeaturesTitle"[\s\S]*?(?=<\/div>\s*<p class="footer-line">)/)?.[0] || '';
    const ai = html.match(/data-tab-panel="ai"[\s\S]*?(?=<\/section>\s*<!-- ============ Tab: About)/)?.[0] || '';
    expect(other).toContain('id="grok-enter-reply"');
    expect(ai).not.toContain('id="grok-enter-reply"');
  });

  it('reuses the AI generate composer scope for Enter-to-reply', () => {
    expect(/function\s+findReplyArticleForEnterShortcut/.test(contentJs)).toBe(true);
    expect(/function\s+findReplyArticleForAiComposer/.test(contentJs)).toBe(true);
    const helperStart = contentJs.indexOf('function findReplyArticleForEnterShortcut');
    const helperEnd = contentJs.indexOf('const RECENT_REPLY_CONTEXT_TTL_MS', helperStart);
    const helper = helperStart >= 0 && helperEnd > helperStart ? contentJs.slice(helperStart, helperEnd) : '';
    expect(helper).toContain("composerRoot?.closest?.('[role=\"dialog\"]')");
    expect(helper).toContain('return article || null');
    expect(helper).toContain('getStatusIdFromLocation()');
    expect(helper).toContain('findArticleForCurrentStatus()');
    expect(helper).not.toContain('grokLastReplyArticle');
    const shortcut = contentJs.match(/function\s+installEnterToReplyShortcut\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
    expect(shortcut).toContain('findReplyArticleForAiComposer(composerRoot)');
    expect(shortcut).not.toContain('findReplyArticle(composerRoot)');
    expect(shortcut).not.toContain('grokLastReplyArticle');
  });

  it('does not inject the AI generate button into normal new-post composers', () => {
    expect(/function\s+findReplyArticleForAiComposer/.test(contentJs)).toBe(true);
    expect(/RECENT_REPLY_CONTEXT_TTL_MS/.test(contentJs)).toBe(true);
    const contextStart = contentJs.indexOf('function findReplyArticleForAiComposer');
    const contextEnd = contentJs.indexOf('function findReplyEditable', contextStart);
    const contextFn = contextStart >= 0 && contextEnd > contextStart ? contentJs.slice(contextStart, contextEnd) : '';
    expect(contextFn).toContain("composerRoot?.closest?.('[role=\"dialog\"]')");
    expect(contextFn).toContain('getStatusIdFromLocation()');
    expect(contextFn).toContain('findArticleForCurrentStatus()');
    const injectorStart = contentJs.indexOf('function injectGrokReplyButtons');
    const injectorEnd = contentJs.indexOf('// Tracks the conversation', injectorStart);
    const injector = injectorStart >= 0 && injectorEnd > injectorStart ? contentJs.slice(injectorStart, injectorEnd) : '';
    expect(injector).toContain('findReplyArticleForAiComposer(composerRoot)');
    expect(injector).not.toContain('findReplyArticle(composerRoot)');
    expect(injector).toContain("querySelectorAll?.('.xvm-grok-generate-btn').forEach((btn) => btn.remove())");
  });

  it('places the AI generate button before the native reply submit button', () => {
    const hostStart = contentJs.indexOf('function findGrokButtonHost');
    const hostEnd = contentJs.indexOf('function findReplySubmitButton', hostStart);
    const hostFn = hostStart >= 0 && hostEnd > hostStart ? contentJs.slice(hostStart, hostEnd) : '';
    expect(hostFn).toContain('const submitHost = submitBtn.parentElement');
    expect(hostFn).toContain('return { host: submitHost, submitBtn, insertBefore: submitBtn }');
    expect(contentJs).toContain('function prepareGrokActionsHost');
    expect(contentJs).toContain("host.style.setProperty('flex-direction', 'row', 'important')");
    expect(contentJs).toContain("host.style.setProperty('align-items', 'center', 'important')");
    expect(contentJs).toContain('prepareGrokActionsHost(host)');
    expect(stylesCss).toContain('.xvm-grok-actions-host');
    expect(stylesCss).toContain('flex-direction: row !important');
    expect(stylesCss).toContain('align-items: center !important');
    expect(stylesCss).toContain('height: 40px');
    expect(stylesCss).toContain('border-radius: 9999px');
  });

  it('uses the legacy Grok candidate panel placement for AI comments', () => {
    const panelStart = contentJs.indexOf('function showGrokOptions');
    const panelEnd = contentJs.indexOf('function setGrokButtonLabel', panelStart);
    const panelFn = panelStart >= 0 && panelEnd > panelStart ? contentJs.slice(panelStart, panelEnd) : '';
    expect(panelFn).toContain('const panelHGuess = Math.max(panel.offsetHeight || 0, minH)');
    expect(panelFn).toContain("placement = spaceRight >= spaceLeft && spaceRight >= minW + 12");
    expect(panelFn).toContain('btnRect.top + btnRect.height / 2 - panelH / 2');
    expect(panelFn).toContain('panel.classList.add(`xvm-grok-options--${placement}`)');
    expect(panelFn).not.toContain('dockPanelToViewportBottom');
    expect(panelFn).not.toContain('panel.style.maxHeight');
    expect(panelFn).not.toContain('panel.style.height');
    expect(stylesCss).toContain('.xvm-grok-options-list');
    expect(stylesCss).toContain('overflow: auto');
    expect(stylesCss).not.toContain('max-height: 220px');
  });

  it('uses the legacy Grok template menu placement', () => {
    const menuStart = contentJs.indexOf('function showGrokTemplateMenu');
    const menuEnd = contentJs.indexOf('// Renders or updates the candidate panel', menuStart);
    const menuFn = menuStart >= 0 && menuEnd > menuStart ? contentJs.slice(menuStart, menuEnd) : '';
    expect(menuFn).toContain('window.innerHeight - menu.offsetHeight - 12');
    expect(menuFn).not.toContain('menu.style.height');
    expect(menuFn).not.toContain('menu.style.maxHeight');
    expect(stylesCss).toContain('.xvm-grok-template-menu-list');
  });

  it('AI tab owns the current Grok reply template controls for future provider settings', () => {
    const ai = html.match(/data-tab-panel="ai"[\s\S]*?(?=<\/section>\s*<!-- ============ Tab: About)/)?.[0] || '';
    expect(/id="ai-provider"/.test(ai)).toBe(true);
    expect(/data-ai-provider-option="x-grok"/.test(ai)).toBe(true);
    expect(/data-ai-provider-option="openai-compatible"/.test(ai)).toBe(true);
    expect(/data-ai-provider-option="ollama"/.test(ai)).toBe(true);
    expect(/role="radiogroup"/.test(ai)).toBe(true);
    expect(/id="ai-platform"/.test(ai)).toBe(true);
    expect(/id="ai-base-url"/.test(ai)).toBe(true);
    expect(/id="ai-model"/.test(ai)).toBe(true);
    expect(/id="ai-reply-count"/.test(ai)).toBe(true);
    expect(/id="ai-api-key"/.test(ai)).toBe(true);
    expect(/id="ai-test-connection"/.test(ai)).toBe(true);
    expect(/id="ai-provider-save"/.test(ai)).toBe(true);
    expect(/id="grok-template-select"/.test(ai)).toBe(true);
    expect(/id="grok-prompt"/.test(ai)).toBe(true);
    expect(/id="grok-article-template-select"/.test(ai)).toBe(true);
    expect(/id="grok-article-prompt"/.test(ai)).toBe(true);
  });

  it('About footer links to the project and maintainer X profile', () => {
    const about = html.match(/data-tab-panel="about"[\s\S]*?(?=<\/div>\s*<div id="xvm-toast")/)?.[0] || '';
    expect(/https:\/\/github\.com\/Icy-Cat\/x-viral-monitor/.test(about)).toBe(true);
    expect(/https:\/\/x\.com\/intent\/follow\?screen_name=lngkximo/.test(about)).toBe(true);
  });

  it('keeps all legacy IDs popup.js / popup-rate-filter.js / popup-pro.js depend on', () => {
    for (const id of ['settings-form', 'trending', 'viral', 'badge-style', 'reset',
                      'feat-leaderboard', 'feat-copy-md', 'feat-starchart',
                      'feat-bookmark-folders', 'feat-bookmark-count', 'lb-count', 'lb-col-list',
                      'lb-reset-pos', 'lb-reset-msg',
                      'grok-template-select', 'grok-prompt', 'grok-prompt-save',
                      'grok-article-template-select', 'grok-article-prompt',
                      'language-select', 'language-toggle',
                      'rate-filter-section', 'xvm-pro-section']) {
      expect(new RegExp(`id="${id}"`).test(html), `popup.html must keep id="${id}"`).toBe(true);
    }
  });

  it('uses custom shadcn-style Select controls instead of native dropdowns', () => {
    expect(/<select\b|<option\b/.test(html)).toBe(false);
    expect(/document\.createElement\(\s*['"]option['"]\s*\)/.test(popupJs)).toBe(false);
    expect(/<select\b|<option\b/.test(userScript)).toBe(false);
    expect((html.match(/class="xvm-select"/g) || []).length).toBe(5);
  });

  it('loads scripts in order: build-channel → tier-logic → popup-pro → popup filters → popup.js → popup-dashboard', () => {
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual([
      'src/build-channel.js',
      'src/premium/license/tier-logic.js',
      'src/premium/license/entitlement.js',
      'src/premium/license/popup-pro.js',
      'src/premium/rate-filter/popup-rate-filter.js',
      'src/premium/content-filter/rules.js',
      'src/premium/content-filter/popup-content-filter.js',
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

  it('keeps popup scrollbar gutter effective across tabs with different heights', () => {
    expect(/html,\s*body\s*\{[^}]*scrollbar-gutter:\s*stable/.test(html)).toBe(true);
    expect(/html\s*\{[^}]*overflow-y:\s*scroll/.test(html),
      'scrollbar-gutter only reserves space on scroll containers; html must not stay overflow: visible'
    ).toBe(true);
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

  it('About can manually trigger the release notes popup on the current X tab', () => {
    expect(/show-update-notes/.test(dashJs)).toBe(true);
    expect(/function\s+showReleaseNotesOnCurrentTab/.test(dashJs)).toBe(true);
    expect(/chrome\.tabs\.query\(\{\s*active:\s*true,\s*currentWindow:\s*true\s*\}/.test(dashJs)).toBe(true);
    expect(/chrome\.tabs\.sendMessage\(tabId,\s*\{[\s\S]*type:\s*['"]XVM_RELEASE_NOTES_SHOW_MANUAL['"]/.test(dashJs)).toBe(true);
    expect(bridgeJs).toMatch(/XVM_RELEASE_NOTES_SHOW_MANUAL/);
    expect(bridgeJs).toMatch(/window\.postMessage\(\{\s*type:\s*['"]XVM_RELEASE_NOTES_SHOW['"]/);
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
    expect(/TABS\s*=\s*\[\s*['"]pro['"]\s*,\s*['"]filter['"]\s*,\s*['"]leaderboard['"]\s*,\s*['"]ai['"]\s*,\s*['"]about['"]\s*\]/.test(dashJs)).toBe(true);
  });
  it('wires aria-selected updates on tab click', () => {
    expect(/aria-selected/.test(dashJs)).toBe(true);
  });
  it('scopes the main tab router to top-level data-tab buttons only', () => {
    expect(/querySelectorAll\(\s*['"]\[role="tab"\]\[data-tab\]['"]\s*\)/.test(dashJs)).toBe(true);
    expect(/querySelectorAll\(\s*['"]\[role="tab"\]['"]\s*\)/.test(dashJs)).toBe(false);
  });
  it('persists and restores the last selected main popup tab', () => {
    expect(/ACTIVE_TAB_KEY\s*=\s*['"]xvm_popup_active_tab['"]/.test(dashJs)).toBe(true);
    expect(/localStorage\.getItem\(ACTIVE_TAB_KEY\)/.test(dashJs)).toBe(true);
    expect(/localStorage\.setItem\(ACTIVE_TAB_KEY,\s*name\)/.test(dashJs)).toBe(true);
    expect(/chrome\.storage\.local\.get\(\s*\{\s*\[ACTIVE_TAB_KEY\]\s*:\s*['"]filter['"]\s*\}/.test(dashJs)).toBe(true);
    expect(/chrome\.storage\.local\.set\(\s*\{\s*\[ACTIVE_TAB_KEY\]\s*:\s*name\s*\}/.test(dashJs)).toBe(true);
    expect(/<body[^>]*data-tab-ready=/.test(html)).toBe(false);
    expect(/body:not\(\[data-tab-ready="1"\]\)\s+\.popup\s*\{\s*visibility:\s*hidden/.test(html)).toBe(true);
    expect(/document\.body\.dataset\.tabReady\s*=\s*['"]1['"]/.test(dashJs)).toBe(true);
    expect(/const\s+next\s*=\s*isValidTab\(saved\)\s*\?\s*saved\s*:\s*['"]filter['"]/.test(dashJs)).toBe(true);
    expect(/setTab\(next,\s*\{\s*persist:\s*false\s*\}\s*\)/.test(dashJs)).toBe(true);
  });
  it('listens for xvm-pro-nav (activate link click)', () => {
    expect(/xvm-pro-nav/.test(dashJs)).toBe(true);
    expect(/['"]activate['"]/.test(dashJs)).toBe(true);
  });
  it('tier-chip updates via MutationObserver on body data-tier', () => {
    expect(/MutationObserver/.test(dashJs)).toBe(true);
    expect(/data-tier/.test(dashJs)).toBe(true);
    expect(/data-build-channel/.test(dashJs)).toBe(true);
    expect(/label\s*=\s*['"]DEV['"]/.test(dashJs)).toBe(true);
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
  it('writes build channel and renders community dev without store license controls', () => {
    expect(/document\.body\.dataset\.buildChannel\s*=\s*globalThis\.__xvmBuildChannel/.test(proJs)).toBe(true);
    expect(/communityDevBadge/.test(proJs)).toBe(true);
    expect(/communityDevSub/.test(proJs)).toBe(true);
    expect(/tier\s*!==\s*['"]pro['"]\s*&&\s*!isCommunityDev/.test(proJs)).toBe(true);
    expect(/else\s+if\s*\(\s*!isCommunityDev\s*\)/.test(proJs)).toBe(true);
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
  it('en + zh_CN + ja locales declare all new keys', () => {
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const ja = JSON.parse(readFileSync(resolve(repo, '_locales/ja/messages.json'), 'utf8'));
    const required = [
      'tabPro', 'tabFilter', 'tabLeaderboard', 'tabAi', 'tabAbout',
      'rfSubShort', 'rfSubLong',
      'comingListTitle',
      'chipTierFree', 'chipTierTrial', 'chipTierPro',
      'chipTrialDays', 'chipTrialOne',
      'themeLabel', 'themeSwitchToDark', 'themeSwitchToLight',
      'advAppearanceTitle',
      'languageLabel', 'languageHint', 'languageAuto',
      'languageZh', 'languageEn', 'languageJa',
      'aboutUpdatesTitle', 'aboutUpdatesDesc', 'aboutShowUpdateNotes',
      'aboutShowUpdateNotesSent', 'aboutShowUpdateNotesNoTab',
      'grokShortTemplateLabel', 'grokArticleTemplateLabel', 'grokArticleTemplateHint',
      'grokDefaultTemplateName', 'grokCustomTemplateName',
      'grokArticleFallbackName', 'grokArticleCustomTemplateName',
      'aiProviderTitle', 'aiProviderLabel', 'aiPlatformLabel', 'aiBaseUrlLabel',
      'aiModelLabel', 'aiReplyCountLabel', 'aiApiKeyLabel', 'aiProviderHint',
      'aiProviderHintGrok', 'aiProviderHintOllama', 'aiProviderHintCloud',
      'aiProviderXGrok', 'aiProviderOllama', 'aiProviderOpenAICompatible',
      'aiProviderXGrokDesc', 'aiProviderOllamaDesc', 'aiProviderOpenAICompatibleDesc',
      'aiServiceConfigTitle', 'aiGenerationSettingsTitle', 'aiCheckLoginStatus',
      'aiTestConnection', 'aiTestRunning', 'aiTestOk', 'aiTestFailed',
      'flashAiProviderSaved', 'btnSaved',
    ];
    for (const k of required) {
      expect(en[k]?.message, `en must declare ${k}`).toBeTruthy();
      expect(zh[k]?.message, `zh_CN must declare ${k}`).toBeTruthy();
      expect(ja[k]?.message, `ja must declare ${k}`).toBeTruthy();
    }
  });

  it('keeps custom Grok prompt edits when switching languages', () => {
    expect(/function\s+applyLanguageChange/.test(popupJs)).toBe(true);
    expect(/languageToggle\?\.addEventListener\(['"]click['"]/.test(popupJs)).toBe(true);
    expect(/function\s+isUnmodifiedBundledGrokTemplateSet/.test(popupJs)).toBe(true);
    expect(/isUnmodifiedBundledGrokTemplateSet\(grokTemplatesState,\s*['"]promptTemplates['"]\)/.test(popupJs)).toBe(true);
    expect(/isUnmodifiedBundledGrokTemplateSet\(grokArticleTemplatesState,\s*['"]articlePromptTemplates['"]\)/.test(popupJs)).toBe(true);
    expect(/usesOnlyBundledGrokTemplates/.test(popupJs)).toBe(false);
  });

  it('does not leave hard-coded Chinese fallback names in popup Grok templates', () => {
    expect(/active\.name[\s\S]*\|\|\s*['"]模板['"]/.test(popupJs)).toBe(false);
    expect(/name:\s*`模板\s+\$\{grokTemplatesState\.length\s*\+\s*1\}`/.test(popupJs)).toBe(false);
    expect(/tr\(['"]grokCustomTemplateName['"]/.test(popupJs)).toBe(true);
  });

  it('keeps the original Chinese Grok default prompt templates', () => {
    expect(popupJs).toContain("id: 'short-cn', name: '中文短评'");
    expect(popupJs).toContain("id: 'tieba-laoge', name: '贴吧老哥'");
    expect(popupJs).toContain('为我生成针对该推文的10条评论,每条评论只包含可直接发布的评论正文，用代码块包裹。');
    expect(popupJs).toContain('用贴吧老哥的语气为该推文生成10条评论。整体阴阳怪气，但不带脏字、不人身攻击；保持口语感，不要装文艺、不要写得像新闻评论；每条评论控制在 30 字以内，简短精悍。');
    expect(popupJs).toContain("id: 'article-deep', name: '深度回应'");
    expect(bridgeJs).toContain("id: 'short-cn', name: '中文短评'");
    expect(bridgeJs).toContain("id: 'tieba-laoge', name: '贴吧老哥'");
    expect(bridgeJs).toContain('用贴吧老哥的语气为该推文生成10条评论。整体阴阳怪气，但不带脏字、不人身攻击；保持口语感，不要装文艺、不要写得像新闻评论；每条评论控制在 30 字以内，简短精悍。');
    expect(bridgeJs).toContain('为我生成针对该推文的10条评论, 每条评论只包含可直接发布的评论正文，用代码块包裹。');
  });
});

describe('#59 popup polish controls', () => {
  it('removes the verbose theme storage hint from the visible About panel', () => {
    expect(/data-i18n="themeHint"/.test(html)).toBe(false);
    expect(/chrome\.storage\.sync/.test(html)).toBe(false);
  });

  it('renders binary feature controls as shadcn pill switches', () => {
    for (const id of [
      'feat-leaderboard',
      'feat-copy-md',
      'feat-starchart',
      'feat-bookmark-folders',
      'feat-bookmark-count',
      'grok-temp-chat',
    ]) {
      const pattern = new RegExp(`class="switch"[\\s\\S]*?<input id="${id}" type="checkbox"[\\s\\S]*?<span class="slider"></span>`);
      expect(pattern.test(html), `${id} must be wrapped in the common pill switch`).toBe(true);
    }
  });

  it('keeps leaderboard column visibility as real checkboxes for multi-select', () => {
    expect(/<input type="checkbox" \$\{col\.visible \? 'checked' : ''\}>/.test(popupJs)).toBe(true);
  });
});

describe('#69/#72 user self-test polish', () => {
  it('lets the List URL input fill the filter card without forcing horizontal overflow', () => {
    expect(/\.lf-section\s*\{[\s\S]*?min-width:\s*0/.test(html)).toBe(true);
    expect(/\.lf-section\s+#lf-list-input\s*\{[\s\S]*?width:\s*100%/.test(html)).toBe(true);
    expect(/\.lf-section\s+#lf-list-input\s*\{[\s\S]*?max-width:\s*100%/.test(html)).toBe(true);
    expect(/\.lf-section\s+#lf-list-input\s*\{[\s\S]*?min-width:\s*0/.test(html)).toBe(true);
    expect(/\.lf-section\s+#lf-list-input\s*\{[\s\S]*?box-sizing:\s*border-box/.test(html)).toBe(true);
    expect(/\.lf-section\s+#lf-list-input\s*\{[\s\S]*?text-overflow:\s*ellipsis/.test(html)).toBe(true);
  });

  it('gives the Short/Long rate-filter sub-tabs a visible selected + keyboard focus state', () => {
    expect(/\.rf-subcard\s+\.sub-tab-btn\[aria-selected="true"\]\s*\{[\s\S]*?background:\s*var\(--accent\)\s*!important/.test(html)).toBe(true);
    expect(/\.rf-subcard\s+\.sub-tab-btn\[aria-selected="true"\]\s*\{[\s\S]*?color:\s*#0b1120\s*!important/.test(html)).toBe(true);
    expect(/\.rf-subcard\s+\.sub-tab-btn:hover\s*\{[\s\S]*?background:\s*var\(--surface\)\s*!important/.test(html)).toBe(true);
    expect(/\.rf-subcard\s+\.sub-tab-btn:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+var\(--accent\)/.test(html)).toBe(true);
  });

  it('renders the leaderboard Hot only switch with shared state sync hooks', () => {
    expect(contentJs).toMatch(/className\s*=\s*['"]xvm-lb-controls['"]/);
    expect(contentJs).toMatch(/xvm-lb-pro-badge/);
    expect(contentJs).toMatch(/xvm-lb-settings/);
    expect(contentJs).toMatch(/xvm-lb-close/);
    expect(contentJs).toMatch(/lucide-settings/);
    expect(contentJs).toMatch(/M9\.671 4\.136a2\.34/);
    expect(contentJs).toMatch(/xvm-lb-settings-panel/);
    expect(contentJs).toMatch(/xvm-lb-settings-hot-row/);
    expect(contentJs).toMatch(/xvm-lb-hot-scopes-section/);
    expect(contentJs).toMatch(/xvm-lb-hot-scope-grid/);
    expect(contentJs).toMatch(/LEADERBOARD_HOT_SCOPE_ITEMS/);
    expect(contentJs).toMatch(/contentLbHotScopeHome/);
    expect(contentJs).toMatch(/contentLbHotScopeList/);
    expect(contentJs).toMatch(/contentLbHotScopeProfile/);
    expect(contentJs).toMatch(/contentLbHotScopeStatus/);
    expect(contentJs).toMatch(/contentLbHotScopeCurrent/);
    expect(contentJs).toMatch(/data-role="scope-current"/);
    expect(contentJs).toMatch(/function\s+updateLeaderboardHotScopeControls/);
    expect(contentJs).toMatch(/function\s+onHotScopeToggleChange/);
    expect(contentJs).toMatch(/xvm-lb-settings-cols/);
    expect(contentJs).toMatch(/function\s+toggleLeaderboardSettingsPanel/);
    expect(contentJs).toMatch(/function\s+positionLeaderboardSettingsPanel/);
    expect(contentJs).toMatch(/function\s+saveLeaderboardSettingsPatch/);
    expect(contentJs).toMatch(/aria-disabled/);
    expect(contentJs).toMatch(/contentLbHotOnly/);
    expect(contentJs).toMatch(/contentLeaderboardSettings/);
    expect(contentJs).toMatch(/contentLeaderboardClose/);
    expect(contentJs).toMatch(/XVM_RATE_FILTER_REQUEST/);
    expect(contentJs).toMatch(/XVM_RATE_SETTINGS_UPDATE/);
    expect(contentJs).toMatch(/function\s+getLeaderboardHotToggle/);
    expect(contentJs).toMatch(/XVM_LEADERBOARD_SETTINGS_SAVE/);
    expect(contentJs).toMatch(/XVM_LEADERBOARD_DISABLE/);
    expect(contentJs).not.toMatch(/XVM_OPEN_POPUP_SETTINGS/);
    expect(contentJs).not.toMatch(/controls\.append\(hot\)/);
    expect(contentJs).not.toMatch(/XVM_LIST_MEMBER_FILTER_SET_ENABLED/);
    expect(contentJs).not.toMatch(/isReadyListMemberFilter/);
    expect(contentJs).not.toMatch(/contentLbListDisabledSub/);
    // rate-filter marker is a soft hint; only gates the leaderboard
    // when the root flag is currently set.
    expect(contentJs).toMatch(/document\.documentElement\.hasAttribute\(['"]data-xvm-rate-filter-on['"]\)/);
    expect(contentJs).toMatch(/['"]data-xvm-content-filter-hidden['"]/);
    expect(contentJs).toMatch(/function\s+isLeaderboardArticleHidden/);
    expect(contentJs).toMatch(/isLeaderboardArticleHidden\(article\)\)\s*continue/);
    expect(contentJs).toMatch(/setTimeout\(renderLeaderboard,\s*80\)/);
    expect(contentJs).toMatch(/if\s*\(!top\.length\)\s*\{[\s\S]*?list\.innerHTML\s*=\s*['"]['"][\s\S]*?el\.style\.display\s*=\s*['"]none['"]/);
    expect(contentJs).toMatch(/closest\?\.\(['"]\.xvm-lb-controls, \.xvm-lb-hot, label, button, input, a['"]\)/);
    expect(bridgeJs).not.toMatch(/XVM_LIST_MEMBER_FILTER_SET_ENABLED/);
    expect(bridgeJs).not.toMatch(/xvm-lb-list-member/);
    expect(bridgeJs).not.toMatch(/xvm_list_member_filter_v1/);
    expect(bridgeJs).not.toMatch(/XVM_OPEN_POPUP_SETTINGS/);
    expect(bridgeJs).not.toMatch(/chrome\.runtime\.getURL\(`popup\.html#\$\{tab\}`\)/);
    expect(bridgeJs).toMatch(/type\s*===\s*['"]XVM_LEADERBOARD_DISABLE['"]/);
    expect(bridgeJs).toMatch(/chrome\.storage\.sync\.set\(\{\s*featureVelocityLeaderboard:\s*false\s*\}/);
    expect(bridgeJs).toMatch(/type\s*===\s*['"]XVM_LEADERBOARD_SETTINGS_SAVE['"]/);
    expect(bridgeJs).toMatch(/XVM_RATE_FILTER_SET_ENABLED/);
    expect(bridgeJs).toMatch(/XVM_RATE_FILTER_SET_SCOPE/);
    expect(bridgeJs).toMatch(/XVM_RATE_SETTINGS_UPDATE/);
    expect(bridgeJs).toMatch(/patch\.leaderboardCount\s*=\s*normalizeLeaderboardCount/);
    expect(bridgeJs).toMatch(/patch\.leaderboardColumns\s*=\s*normalizeLeaderboardColumns/);
    expect(/\.xvm-lb-hot\[data-tier="free"\]\s+\.xvm-lb-pro-badge\s*\{[\s\S]*?display:\s*inline-flex/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-hot\[aria-disabled="true"\]\s*\{[\s\S]*?cursor:\s*not-allowed/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-settings-hot-row\s+\.xvm-lb-hot\s*\{[\s\S]*?margin-left:\s*auto/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-action\s*\{[\s\S]*?width:\s*22px/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-action\s+svg\s*\{[\s\S]*?width:\s*16px/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-settings-panel\s*\{[\s\S]*?position:\s*fixed/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-hot-scope-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-hot-scope\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-settings-panel\[data-theme="dark"\]/.test(stylesCss)).toBe(true);
  });

  it('prevents stale leaderboard RAF renders after the feature is disabled', () => {
    expect(contentJs).toMatch(/function\s+hideLeaderboard\(\)\s*\{[\s\S]*?cancelAnimationFrame\(leaderboardRaf\)/);
    expect(contentJs).toMatch(/leaderboardRaf\s*=\s*requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!leaderboardEnabled\)\s*\{[\s\S]*?hideLeaderboard\(\)/);
  });

  it('dark leaderboard overrides nested text colors, not only the row color', () => {
    expect(/\.xvm-lb\[data-theme="dark"\]\s+\.xvm-lb-handle\s*\{[\s\S]*?color:\s*#e2e8f0/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb\[data-theme="dark"\]\s+\.xvm-lb-preview\s*\{[\s\S]*?color:\s*#cbd5e1/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb\[data-theme="dark"\]\s+\.xvm-lb-views\s*\{[\s\S]*?color:\s*#94a3b8/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb\[data-theme="dark"\]\s+\.xvm-lb-red\s+\.xvm-lb-vel\s*\{[\s\S]*?color:\s*#ff6b4a/.test(stylesCss)).toBe(true);
  });

  it('keeps the floating leaderboard list at the configured height when few tweets remain', () => {
    expect(/\.xvm-lb-list\s*\{[\s\S]*?height:\s*300px/.test(stylesCss)).toBe(true);
    expect(/\.xvm-lb-list\s*\{[\s\S]*?min-height:\s*120px/.test(stylesCss)).toBe(true);
    expect(contentJs).toMatch(/list\.style\.height\s*=\s*px/);
    expect(contentJs).toMatch(/list\.style\.minHeight\s*=\s*px/);
    expect(contentJs).toMatch(/list\.style\.maxHeight\s*=\s*px/);
  });

  it('supports opening popup.html#leaderboard directly from the floating settings button', () => {
    expect(dashJs).toMatch(/function\s+readHashTab\(\)/);
    expect(dashJs).toMatch(/const\s+hashTab\s*=\s*readHashTab\(\)/);
    expect(dashJs).toMatch(/window\.addEventListener\(['"]hashchange['"]/);
  });

  it('shows a green longer toast when enabling Hot only filtering', () => {
    expect(contentJs).toMatch(/contentLbHotEnabledToast/);
    expect(contentJs).toMatch(/showToast\([\s\S]*contentLbHotEnabledToast[\s\S]*type:\s*['"]success['"][\s\S]*duration:\s*3600/);
    expect(contentJs).toMatch(/duration\s*=\s*1400/);
  });

  it('shows an in-panel Hot only active notice while the current scope is filtered', () => {
    expect(contentJs).toContain('class="xvm-lb-hot-notice" hidden');
    expect(contentJs).toMatch(/function\s+updateLeaderboardHotNotice\(on\s*=\s*false\)/);
    expect(contentJs).toMatch(/contentLbHotActiveNotice/);
    expect(contentJs).toMatch(/updateLeaderboardHotNotice\(currentScopeEnabled\(\)\)/);
    expect(stylesCss).toContain('.xvm-lb-hot-notice');
    expect(stylesCss).toContain('.xvm-lb.xvm-lb-edge-hidden .xvm-lb-hot-notice');
  });
});

describe('update notice modal', () => {
  it('stores the seen extension version and only asks content.js to show unseen release notes', () => {
    expect(bridgeJs).toMatch(/RELEASE_NOTES_SEEN_KEY\s*=\s*['"]xvm_release_notes_seen_version['"]/);
    expect(bridgeJs).toMatch(/RELEASE_NOTES_AUTO_VERSIONS\s*=\s*new Set\(\[['"]1\.18\.0['"]\]\)/);
    expect(bridgeJs).toMatch(/RELEASE_NOTES_AUTO_VERSIONS\.has\(version\)/);
    expect(bridgeJs).toMatch(/chrome\.runtime\?\.\s*getManifest\?\.\(\)\?\.\s*version/);
    expect(bridgeJs).toMatch(/XVM_RELEASE_NOTES_SHOW/);
    expect(bridgeJs).toMatch(/XVM_RELEASE_NOTES_DISMISS/);
    expect(bridgeJs).toMatch(/\[RELEASE_NOTES_SEEN_KEY\]:\s*event\.data\.version/);
  });

  it('renders a dismissible release notes dialog in the page', () => {
    expect(contentJs).toMatch(/RELEASE_NOTE_ITEMS/);
    expect(contentJs).toMatch(/function\s+showReleaseNotesModal\(version\)/);
    expect(contentJs).toMatch(/className\s*=\s*['"]xvm-update-backdrop['"]/);
    expect(contentJs).toMatch(/role['"],\s*['"]dialog/);
    expect(contentJs).toMatch(/XVM_RELEASE_NOTES_DISMISS/);
  });

  it('explains where each release-note feature can be enabled or used', () => {
    expect(contentJs).toContain('设置 → AI 生成评论');
    expect(contentJs).toContain('新增评论时按 Enter 直接发送评论的功能');
    expect(contentJs).toContain('生效范围可以在 Popup 或悬浮面板设置里勾选');
    expect(contentJs).toContain('设置 → 其他功能里可以开启书签文件夹菜单和显示书签数');
    expect(contentJs).toContain('微信 / Telegram 引流广告特征');
  });

  it('ships modal styles with clear backdrop, card, list, and primary button selectors', () => {
    for (const cls of [
      'xvm-update-backdrop',
      'xvm-update-dialog',
      'xvm-update-item',
      'xvm-update-primary',
    ]) {
      expect(stylesCss).toContain(`.${cls}`);
    }
    expect(contentJs).toMatch(/backdrop\.setAttribute\(['"]data-theme['"],\s*_resolvedTheme\(_themePref\)\)/);
    expect(stylesCss).toContain('.xvm-update-backdrop[data-theme="dark"] .xvm-update-dialog');
    expect(stylesCss).not.toMatch(/html\[data-color-mode="dark"\]\s+\.xvm-update/);
    expect(stylesCss).not.toMatch(/body\[data-theme="dark"\]\s+\.xvm-update/);
  });
});

describe('#45 i18n lock-step (content.js i18n() ↔ bridge CONTENT_MESSAGE_KEYS ↔ _locales)', () => {
  it('every i18n(\'…\') key in content.js is listed in bridge.js CONTENT_MESSAGE_KEYS', () => {
    // Catches the v1.7.0 ship-blocker class of bug where adding a new
    // i18n key in content.js works in popup but renders the raw key
    // string in content_script because bridge.js's CONTENT_MESSAGE_KEYS
    // didn't include it — chrome.i18n.getMessage() never ran for that
    // key in the localizedStrings push.
    const content = readFileSync(resolve(repo, 'content.js'), 'utf8');
    const bridge  = readFileSync(resolve(repo, 'bridge.js'),  'utf8');
    const keysListed = (bridge.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
      .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [];
    const set = new Set(keysListed);
    // i18n('…') call sites in content.js
    const calls = [...content.matchAll(/\bi18n\(\s*['"]([A-Za-z0-9_]+)['"]/g)].map((m) => m[1]);
    const missing = [...new Set(calls)].filter((k) => !set.has(k));
    expect(missing,
      `content.js calls i18n(...) on keys missing from bridge.js CONTENT_MESSAGE_KEYS: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('every CONTENT_MESSAGE_KEYS key is declared in en + zh_CN locales', () => {
    const bridge = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const keysListed = (bridge.match(/CONTENT_MESSAGE_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '')
      .match(/['"]([A-Za-z0-9_]+)['"]/g)?.map((s) => s.slice(1, -1)) || [];
    const missingEn = keysListed.filter((k) => !en[k]?.message);
    const missingZh = keysListed.filter((k) => !zh[k]?.message);
    expect(missingEn, `_locales/en missing keys: ${missingEn.join(', ')}`).toEqual([]);
    expect(missingZh, `_locales/zh_CN missing keys: ${missingZh.join(', ')}`).toEqual([]);
  });

  it('every popup.html data-i18n attribute key is declared in en + zh_CN + ja', () => {
    const html = readFileSync(resolve(repo, 'popup.html'), 'utf8');
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const ja = JSON.parse(readFileSync(resolve(repo, '_locales/ja/messages.json'), 'utf8'));
    const used = [...new Set([...html.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)].map((m) => m[1]))];
    const missingEn = used.filter((k) => !en[k]?.message);
    const missingZh = used.filter((k) => !zh[k]?.message);
    const missingJa = used.filter((k) => !ja[k]?.message);
    expect(missingEn, `popup.html references data-i18n keys missing from _locales/en: ${missingEn.join(', ')}`).toEqual([]);
    expect(missingZh, `popup.html references data-i18n keys missing from _locales/zh_CN: ${missingZh.join(', ')}`).toEqual([]);
    expect(missingJa, `popup.html references data-i18n keys missing from _locales/ja: ${missingJa.join(', ')}`).toEqual([]);
  });

  it('keeps package and extension versions in sync for v1.18.2', () => {
    expect(manifest.version).toBe('1.18.2');
    expect(pkg.version).toBe('1.18.2');
    expect(packageLock.version).toBe('1.18.2');
    expect(packageLock.packages?.['']?.version).toBe('1.18.2');
  });

  it('renders the popup footer version from the extension manifest', () => {
    expect(html).toMatch(/id="popup-version"><\/span>/);
    expect(dashJs).toMatch(/function\s+currentExtensionVersion\(\)/);
    expect(dashJs).toMatch(/chrome\.runtime\.getManifest\(\)\.version/);
    expect(dashJs).toMatch(/function\s+renderPopupVersion\(\)/);
    expect(dashJs).toMatch(/getElementById\(['"]popup-version['"]\)/);
  });
});

describe('#15 AI comment provider contract', () => {
  it('ships a background service worker for provider calls without broad host permissions', () => {
    expect(manifest.background?.service_worker).toBe('background.js');
    expect(buildDistJs).toContain("'background.js'");
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    for (const pattern of [
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://api.openai.com/*',
      'https://api.deepseek.com/*',
      'https://openrouter.ai/*',
      'https://api.moonshot.ai/*',
      'https://dashscope.aliyuncs.com/*',
      'https://api.siliconflow.cn/*',
    ]) {
      expect(manifest.host_permissions).toContain(pattern);
    }
  });

  it('keeps AI API keys out of sync storage and the MAIN-world content script', () => {
    expect(/chrome\.storage\.local\.set\(\s*\{\s*xvmAiApiKey/.test(popupJs)).toBe(true);
    expect(/chrome\.storage\.sync\.set\(syncPatch/.test(popupJs)).toBe(true);
    expect(contentJs).not.toContain('xvmAiApiKey');
    expect(bridgeJs).not.toContain('xvmAiApiKey');
  });

  it('routes non-Grok AI generation through bridge → background with request IDs', () => {
    expect(contentJs).toContain("type: 'XVM_AI_GENERATE'");
    expect(contentJs).toContain('XVM_AI_GENERATE_RESULT');
    expect(contentJs).toContain('XVM_AI_GENERATE_PROGRESS');
    expect(contentJs).toContain("aiProvider === 'x-grok'");
    expect(contentJs).toContain('requestExternalAiGeneration');
    expect(contentJs).toContain('onProgress');
    expect(bridgeJs).toContain('XVM_AI_GENERATE_PROGRESS');
    expect(bridgeJs).toContain('XVM_AI_GENERATE_RESULT');
    expect(bridgeJs).toContain('payload: event.data.payload || {}');
    expect(backgroundJs).toContain('XVM_AI_GENERATE_PROGRESS');
    expect(backgroundJs).toContain('generateWithOpenAICompatible(config, message.payload || {}, emitProgress)');
    expect(bridgeJs).not.toContain('bridgeAiRequests');
    expect(bridgeJs).not.toContain("请通过页面上的 AI 生成按钮发起请求");
    expect(bridgeJs).not.toContain('bridgeGenerateExternalAi');
    expect(bridgeJs).not.toContain('AI_GENERATE_ACTIVATION_TTL_MS');
    expect(bridgeJs).not.toContain('consumeAiGenerateActivation');
    expect(backgroundJs).toContain("message.type === 'XVM_AI_GENERATE'");
  });

  it('supports X Grok, Ollama, and OpenAI-compatible presets in popup and background', () => {
    for (const value of ['x-grok', 'ollama', 'openai-compatible']) {
      expect(popupJs).toContain(value);
      expect(backgroundJs).toContain(value);
    }
    for (const platform of ['openai', 'deepseek', 'openrouter', 'kimi', 'qwen', 'siliconflow', 'lmstudio', 'ollamaOpenAI']) {
      expect(popupJs).toContain(platform);
      expect(backgroundJs).toContain(platform);
    }
    expect(backgroundJs).toContain('generateWithOllama');
    expect(backgroundJs).toContain('generateWithOpenAICompatible');
    expect(backgroundJs).toContain('assertAllowedOpenAIBaseUrl');
    expect(backgroundJs).toContain('assertAllowedOllamaBaseUrl');
  });

  it('resets OpenAI-compatible fields when switching back from Ollama', () => {
    expect(popupJs).toContain("if (aiProviderSelect.value === 'ollama')");
    expect(popupJs).toContain("if (aiBaseUrlInput) aiBaseUrlInput.value = 'http://localhost:11434'");
    expect(popupJs).toContain("if (aiModelInput) aiModelInput.value = 'llama3.1'");
    expect(popupJs).toContain("} else if (aiProviderSelect.value === 'openai-compatible') {\n    applyAiPlatformPreset(aiPlatformSelect?.value, true);");
  });

  it('shows temporary success feedback on the AI provider save button', () => {
    expect(popupJs).toContain('const buttonRestoreTimers = new WeakMap()');
    expect(popupJs).toContain('function showButtonSaved(button)');
    expect(popupJs).toContain("button.textContent = tr('btnSaved') || tr('flashSaved') || 'Saved'");
    expect(popupJs).toContain('showButtonSaved(aiProviderSaveBtn)');
  });

  it('does not render a separate third-party AI candidate panel in bridge', () => {
    expect(bridgeJs).not.toContain('function bridgeShowGrokOptions');
    expect(bridgeJs).not.toContain('function bridgeInsertTextIntoReply');
    expect(bridgeJs).not.toContain('xvm-grok-options-list');
    expect(contentJs).toContain('function showGrokOptions');
    expect(contentJs).toContain('showGrokOptions(running, editable, { streaming: true, anchor: btn })');
  });
});

describe('#45 carry-over invariants', () => {
  it('leaderboard default ON (bridge + popup mirror)', () => {
    expect(/featureVelocityLeaderboard:\s*true/.test(bridgeJs)).toBe(true);
    expect(/featureVelocityLeaderboard:\s*true/.test(popupJs)).toBe(true);
  });
});
