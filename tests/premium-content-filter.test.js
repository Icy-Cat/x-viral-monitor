// #123 — severity-based content filter wiring and rule contracts.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const gate = readFileSync(resolve(repo, 'src/premium/license/gate.js'), 'utf8');
const isolated = readFileSync(resolve(repo, 'src/premium/license/isolated.js'), 'utf8');
const filter = readFileSync(resolve(repo, 'src/premium/content-filter/filter.js'), 'utf8');
const popupFilter = readFileSync(resolve(repo, 'src/premium/content-filter/popup-content-filter.js'), 'utf8');
const rulesJson = JSON.parse(readFileSync(resolve(repo, 'src/premium/content-filter/rules.json'), 'utf8'));
const popupHtml = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const rateFilter = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
const content = readFileSync(resolve(repo, 'content.js'), 'utf8');

function loadDebug() {
  const win = {
    location: { pathname: '/home' },
    addEventListener() {},
    postMessage() {},
    __xvmContentFilterBuiltinRules: rulesJson,
    __xvmNet: { onResponse() {} },
    __xvmPro: {
      isFeatureEnabled: () => true,
      onTierChange() {},
    },
  };
  const context = {
    window: win,
    document: {
      documentElement: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', style: {}, appendChild() {}, addEventListener() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    URL,
    console,
  };
  vm.runInNewContext(filter, context);
  return win.__xvmContentFilter;
}

describe('#123 XVM content filter v1', () => {
  it('manifest loads content-filter rules/filter after gate and before rate/content', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    const order = main.js;
    const gateIdx = order.indexOf('src/premium/license/gate.js');
    const rulesIdx = order.indexOf('src/premium/content-filter/rules.js');
    const filterIdx = order.indexOf('src/premium/content-filter/filter.js');
    const rateIdx = order.indexOf('src/premium/rate-filter/filter.js');
    const contentIdx = order.indexOf('content.js');
    expect(rulesIdx).toBeGreaterThan(gateIdx);
    expect(filterIdx).toBeGreaterThan(rulesIdx);
    expect(filterIdx).toBeLessThan(rateIdx);
    expect(filterIdx).toBeLessThan(contentIdx);
  });

  it('premium gate and isolated bridge expose content-filter feature/settings', () => {
    expect(gate).toMatch(/['"]content-filter['"]\s*:\s*['"]trial['"]/);
    expect(isolated).toMatch(/CONTENT_FILTER_KEY\s*=\s*['"]xvm_content_filter_v1['"]/);
    expect(isolated).toMatch(/XVM_CONTENT_FILTER_SETTINGS_UPDATE/);
    expect(isolated).toMatch(/pushContentFilterSettings/);
  });

  it('popup includes content filter section and popup scripts', () => {
    expect(popupHtml).toMatch(/id="content-filter-section"/);
    expect(popupHtml).toMatch(/src="src\/premium\/content-filter\/rules\.js"/);
    expect(popupHtml).toMatch(/src="src\/premium\/content-filter\/popup-content-filter\.js"/);
    expect(popupFilter).toMatch(/STORAGE_KEY\s*=\s*['"]xvm_content_filter_v1['"]/);
    expect(popupFilter).toMatch(/customRules/);
    expect(popupFilter).toMatch(/whitelistHandles/);
    expect(popupFilter).toMatch(/whitelistDomains/);
    expect(popupFilter).toMatch(/whitelistFollowing/);
    expect(popupFilter).toMatch(/blacklistHandles/);
  });

  it('rules.json declares levels and valid rule shape', () => {
    for (const level of ['light', 'standard', 'strict']) {
      expect(Array.isArray(rulesJson.levels[level])).toBe(true);
      expect(rulesJson.levels[level].length).toBeGreaterThan(0);
    }
    for (const rule of rulesJson.rules) {
      expect(['keyword', 'regex', 'domain']).toContain(rule.type);
      expect(['name', 'screen_name', 'bio', 'location', 'content', 'url']).toContain(rule.field);
      expect(['low', 'medium', 'high', 'block']).toContain(rule.severity);
      expect(rule.id).toBeTruthy();
      expect(rule.value).toBeTruthy();
    }
  });

  it('content-filter classifies telegram funnel, media spam, and whitelist correctly', () => {
    const api = loadDebug();
    api.updateSettings({
      enabled: true,
      level: 'standard',
      whitelistHandles: [],
      whitelistDomains: [],
      whitelistFollowing: false,
      blacklistHandles: [],
      customRules: [],
    });
    const raw = {
      id: '1',
      content: '福利视频和资源都在 t.me/example 群里，私信加入',
      urls: ['https://t.me/example'],
      author: { handle: 'spam', name: 'promo', bio: '成人视频', location: '' },
    };
    const result = api._debug.classify(raw);
    expect(result.hide).toBe(true);
    expect(result.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(true);

    api.updateSettings({
      enabled: true,
      level: 'strict',
      whitelistHandles: ['spam'],
      whitelistDomains: [],
      whitelistFollowing: false,
      blacklistHandles: [],
      customRules: [],
    });
    expect(api._debug.classify(raw).hide).toBe(false);

    api.updateSettings({
      enabled: true,
      level: 'strict',
      whitelistHandles: [],
      whitelistDomains: [],
      whitelistFollowing: true,
      blacklistHandles: ['spam'],
      customRules: [],
    });
    expect(api._debug.classify({ ...raw, author: { ...raw.author, following: true } }).hide).toBe(false);
    const blocked = api._debug.classify(raw);
    expect(blocked.hide).toBe(true);
    expect(blocked.matches.some((m) => m.id === 'hard-blacklist-handle')).toBe(true);
  });

  it('extracts sample-style X reply fields used by content filtering', () => {
    const api = loadDebug();
    const result = {
      legacy: {
        id_str: 'sample-1',
        full_text: '福利视频资源都在群里，私信加入 https://t.co/a',
        created_at: 'Tue May 26 00:00:00 +0000 2026',
        entities: {
          urls: [{ expanded_url: 'https://t.me/sample', display_url: 't.me/sample', url: 'https://t.co/a' }],
        },
      },
      core: {
        user_results: {
          result: {
            rest_id: 'u1',
            core: { name: 'Cboy', screen_name: 'wishtcday' },
            legacy: {
              description: '家父马斯克，频道见 t.me/sample',
              location: '',
              entities: {
                url: {
                  urls: [{ expanded_url: 'http://t.me/zhongwentwitter', display_url: 't.me/zhongwentwitter' }],
                },
              },
            },
          },
        },
      },
    };
    const raw = api._debug.extractTweet(result);
    expect(raw.author.handle).toBe('wishtcday');
    expect(raw.urls).toContain('https://t.me/sample');
    expect(raw.urls).toContain('http://t.me/zhongwentwitter');
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    const classified = api._debug.classify(raw);
    expect(classified.hide).toBe(true);
    expect(classified.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(true);
  });

  it('rate filter and leaderboard know about the content-filter hide marker', () => {
    expect(rateFilter).toMatch(/data-xvm-content-filter-hidden/);
    expect(content).toMatch(/data-xvm-content-filter-hidden/);
  });

  it('content-filter exposes a local RuleSource abstraction for future remote rules', () => {
    expect(filter).toMatch(/createLocalRuleSource/);
    expect(filter).toMatch(/type:\s*['"]local-json['"]/);
    expect(filter).toMatch(/window\.__xvmContentFilterBuiltinRules/);
  });
});
