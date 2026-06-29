import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const mobileScript = readFileSync(resolve(repo, 'userscript/x-viral-monitor.mobile.user.js'), 'utf8');
const desktopScript = readFileSync(resolve(repo, 'userscript/x-viral-monitor.user.js'), 'utf8');
const debugScript = readFileSync(resolve(repo, 'userscript/x-viral-monitor.debug.user.js'), 'utf8');
const userscriptReadme = readFileSync(resolve(repo, 'userscript/README.md'), 'utf8');

describe('iOS mobile userscript build', () => {
  it('ships as a separate mobile file without replacing the desktop userscript', () => {
    expect(mobileScript).toContain('@name         X Viral Monitor Mobile Badge');
    expect(mobileScript).toContain('@version      0.1.15');
    expect(mobileScript).toContain('@match        https://mobile.x.com/*');
    expect(desktopScript).toContain('@name         X Viral Monitor Minimal Badge');
    expect(desktopScript).toContain('@version      0.1.16');
    expect(desktopScript).not.toContain('@name         X Viral Monitor Mobile Badge');
  });

  it('keeps the debug build separate from the mobile release path', () => {
    expect(debugScript).toContain('@name         X Viral Monitor Minimal Badge DEBUG');
    expect(debugScript).toContain('@version      0.1.13-debug.6');
    expect(mobileScript).not.toContain('@name         X Viral Monitor Minimal Badge DEBUG');
    expect(mobileScript).not.toContain('@version      0.1.13-debug.5');
  });

  it('defaults to badges only on mobile and hides the floating leaderboard', () => {
    expect(mobileScript).toContain('const ENABLE_DEBUG_LEADERBOARD = false');
    expect(mobileScript).toContain('leaderboardEnabled: false');
    expect(mobileScript).toContain('if (!ENABLE_DEBUG_LEADERBOARD || !settings.leaderboardEnabled)');
    expect(mobileScript).toContain('function extractVisibleTweetData(article, id)');
    expect(mobileScript).toContain('source: \'dom-visible-fallback\'');
  });

  it('uses real tweet datetime for sub-hour velocity and only estimates when datetime is missing', () => {
    expect(mobileScript).toContain('const minHours = data.estimatedCreatedAt ? 1 : 5 / 60');
    expect(mobileScript).toContain('estimatedCreatedAt: domTime.estimated');
    expect(mobileScript).toContain('const fallbackAgeHours = 1');
  });

  it('gates diagnostics behind the xvm-debug query flag', () => {
    expect(mobileScript).toContain('const ENABLE_MOBILE_DEBUG = /(?:[?&])xvm-debug=1(?:&|$)/.test(location.search)');
    expect(mobileScript).toContain('if (ENABLE_MOBILE_DEBUG) {');
    expect(mobileScript).toContain('installDebugOverlay();');
    expect(mobileScript).toContain('installResourceObserver();');
    expect(mobileScript).toContain('if (ENABLE_MOBILE_DEBUG) injectPageHook();');
  });

  it('documents the desktop, mobile, and debug install paths', () => {
    expect(userscriptReadme).toContain('x-viral-monitor.user.js');
    expect(userscriptReadme).toContain('x-viral-monitor.mobile.user.js');
    expect(userscriptReadme).toContain('x-viral-monitor.debug.user.js');
    expect(userscriptReadme).toContain('https://raw.githubusercontent.com/Icy-Cat/x-viral-monitor/main/userscript/x-viral-monitor.mobile.user.js');
  });

  it('declares Safari/mobile script metadata with maintainer and project links', () => {
    expect(mobileScript).toContain('@author       IcyCat');
    expect(mobileScript).toContain('@homepageURL  https://github.com/Icy-Cat/x-viral-monitor');
    expect(mobileScript).toContain('@supportURL   https://github.com/Icy-Cat/x-viral-monitor/issues');
  });
});

describe('desktop userscript Tampermonkey compatibility', () => {
  it('declares desktop script metadata with maintainer, contributor, and project links', () => {
    expect(desktopScript).toContain('@author       IcyCat, Chlience');
    expect(desktopScript).toContain('@homepageURL  https://github.com/Icy-Cat/x-viral-monitor');
    expect(desktopScript).toContain('@supportURL   https://github.com/Icy-Cat/x-viral-monitor/issues');
  });

  it('uses a CSP-safe Tampermonkey hook path for Firefox page objects', () => {
    expect(desktopScript).toContain('@sandbox      JavaScript');
    expect(desktopScript).toContain('function getPageWindow()');
    expect(desktopScript).toContain('wrappedJSObject');
    expect(desktopScript).toContain('function exportToPage(fn)');
    expect(desktopScript).toContain('exportFunction(fn, host)');
    expect(desktopScript).toContain('function captureGraphqlText(url, text, source)');
    expect(desktopScript).toContain('response.clone().text()');
    expect(desktopScript).not.toContain('pageWindow.postMessage({');
  });
});
