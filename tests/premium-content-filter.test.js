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

function loadDebug(overrides = {}) {
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
    ...(overrides.window || {}),
  };
  const context = {
    window: win,
    document: overrides.document || {
      documentElement: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', style: {}, dataset: {}, appendChild() {}, addEventListener() {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    MutationObserver: overrides.MutationObserver || class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: overrides.requestAnimationFrame,
    setTimeout: overrides.setTimeout || setTimeout,
    URL,
    console,
  };
  vm.runInNewContext(filter, context);
  return win.__xvmContentFilter;
}

function attrNode(kind) {
  const attrs = new Map();
  return {
    kind,
    style: {},
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    hasAttribute(name) { return attrs.has(name); },
    getAttribute(name) { return attrs.get(name) || ''; },
    matches(selector) {
      if (selector === 'article') return kind === 'article';
      if (selector === '[data-testid="cellInnerDiv"]') return kind === 'cell';
      if (selector === 'article[data-testid="tweet"]') return kind === 'article';
      return false;
    },
    closest() { return null; },
  };
}

function contentFilterDomHarness({ domName = 'Spam @spam', domContent = 'hello' } = {}) {
  const root = {
    children: [],
    firstChild: null,
    insertBefore(node, before) {
      node.parentElement = root;
      const idx = before ? root.children.indexOf(before) : -1;
      if (idx >= 0) root.children.splice(idx, 0, node);
      else root.children.push(node);
      root.firstChild = root.children[0] || null;
    },
  };
  const mainCell = attrNode('cell');
  const mainArticle = attrNode('article');
  const cell = attrNode('cell');
  const article = attrNode('article');
  const mainLink = { getAttribute: () => '/rwayne/status/2059141230542671887' };
  const link = { getAttribute: () => '/spam/status/1' };
  const nameNode = { textContent: domName };
  const textNode = { textContent: domContent };
  mainCell.parentElement = root;
  cell.parentElement = root;
  root.children = [mainCell, cell];
  root.firstChild = mainCell;
  mainArticle.closest = (selector) => (selector === '[data-testid="cellInnerDiv"]' ? mainCell : null);
  mainArticle.querySelector = (selector) => (selector.includes('/status/') ? mainLink : null);
  mainCell.querySelector = (selector) => (selector === 'article[data-testid="tweet"]' ? mainArticle : null);
  article.closest = (selector) => (selector === '[data-testid="cellInnerDiv"]' ? cell : null);
  article.querySelector = (selector) => {
    if (selector.includes('/status/')) return link;
    if (selector === '[data-testid="User-Name"]') return nameNode;
    if (selector === '[data-testid="tweetText"]') return textNode;
    return null;
  };
  article.querySelectorAll = (selector) => (selector === 'a[href]' ? [{ href: 'https://t.me/sample', getAttribute: () => 'https://t.me/sample' }, link] : []);
  cell.querySelector = (selector) => (selector === 'article[data-testid="tweet"]' ? article : null);
  const document = {
    documentElement: { appendChild() {} },
    getElementById: (id) => root.children.find((node) => node.id === id) || null,
    createElement: () => ({ id: '', textContent: '', style: {}, dataset: {}, hidden: false, appendChild() {}, addEventListener() {} }),
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'article[data-testid="tweet"]') return [mainArticle, article];
      if (selector === '[data-testid="cellInnerDiv"]') return [mainCell, cell];
      if (selector.includes('cellInnerDiv') && selector.includes('data-xvm-content-filter-hidden')) {
        const out = [];
        if (article.hasAttribute('data-xvm-content-filter-hidden')) out.push(article);
        if (cell.hasAttribute('data-xvm-content-filter-hidden')) out.push(cell);
        return out;
      }
      return [];
    },
  };
  const tweet = {
    legacy: {
      id_str: '1',
      full_text: '福利视频资源都在群里，私信加入 https://t.co/a',
      created_at: 'Tue May 26 00:00:00 +0000 2026',
      entities: { urls: [{ expanded_url: 'https://t.me/sample' }] },
    },
    core: {
      user_results: {
        result: {
          rest_id: 'u1',
          legacy: {
            name: 'Spam',
            screen_name: 'spam',
            description: '电报频道',
            location: '',
          },
        },
      },
    },
  };
  return { article, cell, mainArticle, mainCell, root, document, tweet };
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
    expect(gate).toMatch(/['"]content-filter['"]\s*:\s*['"]free['"]/);
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
    expect(popupFilter).toMatch(/renderAllRules/);
    expect(popupFilter).toMatch(/cf-all-rules/);
    expect(popupFilter).toMatch(/data-del-rule/);
    expect(popupHtml).toMatch(/cf-rule-list/);
    expect(popupFilter).not.toMatch(/setLocked\(section,\s*tier\s*===\s*['"]free['"]\)/);
    expect(popupFilter).not.toMatch(/cf-locked-hint/);
  });

  it('rules.json declares levels and valid rule shape', () => {
    for (const level of ['light', 'standard', 'strict']) {
      expect(Array.isArray(rulesJson.levels[level])).toBe(true);
      expect(rulesJson.levels[level].length).toBeGreaterThan(0);
    }
    for (const rule of rulesJson.rules) {
      expect(['keyword', 'regex', 'domain', 'short-symbol']).toContain(rule.type);
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

  it('content-filter uses the approved severity thresholds', () => {
    const api = loadDebug();
    const tmeOnly = {
      id: 'medium-1',
      content: 'normal update',
      urls: ['https://t.me/example'],
      author: { handle: 'chan', name: 'normal', bio: '', location: '' },
    };
    const marketingOnly = {
      id: 'medium-2',
      content: '合作微信，推广案例和网盘拉新',
      urls: [],
      author: { handle: 'growth', name: 'normal', bio: '', location: '' },
    };
    const lowOnly = {
      id: 'low-1',
      content: '黑丝写真',
      urls: [],
      author: { handle: 'soft', name: 'normal', bio: '', location: '' },
    };
    const highName = {
      id: 'high-1',
      content: 'hello',
      urls: [],
      author: { handle: 'spam2', name: '点击主页', bio: '', location: '附近可约线下' },
    };
    const broadResource = {
      id: 'resource-1',
      content: 'hello',
      urls: [],
      author: { handle: 'ok', name: '资料分享', bio: '高质量资料和工具整理', location: '' },
    };
    api.updateSettings({ enabled: true, level: 'light', whitelistFollowing: false });
    expect(api._debug.classify(highName).hide).toBe(false);
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    expect(api._debug.classify(tmeOnly).hide).toBe(false);
    expect(api._debug.classify(marketingOnly).hide).toBe(false);
    expect(api._debug.classify(highName).hide).toBe(true);
    expect(api._debug.classify(broadResource).hide).toBe(false);
    api.updateSettings({ enabled: true, level: 'strict', whitelistFollowing: false });
    expect(api._debug.classify(tmeOnly).hide).toBe(true);
    expect(api._debug.classify(marketingOnly).hide).toBe(true);
    expect(api._debug.classify(lowOnly).hide).toBe(false);
  });

  it('covers sample follow-up false negatives without broad resource false positives', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const sameCity = {
      id: 'fn-1',
      content: '想找我的宝宝点这里 https://t.co/a',
      urls: ['https://t.me/sample'],
      author: {
        handle: 'Antonia435793',
        name: '依露~🌸同城上门',
        bio: '想找我的宝宝点这里✈ t.me/sample 安全靠谱',
        location: '',
      },
    };
    const clickBig = {
      id: 'fn-2',
      content: 'hello',
      urls: [],
      author: {
        handle: 'lrasdfe36391',
        name: 'normal',
        bio: '',
        location: '联系直接点击大号',
      },
    };
    const resourceOk = {
      id: 'fp-1',
      content: '分享一份资料',
      urls: [],
      author: {
        handle: 'iBigQiang',
        name: '大强',
        bio: '高质量资料和工具整理',
        location: '',
      },
    };

    const sameCityHit = api._debug.classify(sameCity);
    expect(sameCityHit.hide).toBe(true);
    expect(sameCityHit.matches.some((m) => m.id === 'adult-name-offline-high')).toBe(true);
    expect(sameCityHit.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(true);

    const clickBigHit = api._debug.classify(clickBig);
    expect(clickBigHit.hide).toBe(true);
    expect(clickBigHit.matches.some((m) => m.id === 'adult-location-offline-high')).toBe(true);

    expect(api._debug.classify(resourceOk).hide).toBe(false);
  });

  it('covers rwayne page name funnels and short symbol spam in standard mode', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const commission = {
      id: 'rwayne-1',
      content: '普通回复',
      urls: [],
      author: { handle: 'igrusia', name: '50返佣', bio: '', location: '' },
    };
    const avatarFunnel = {
      id: 'rwayne-2',
      content: '普通回复',
      urls: [],
      author: { handle: 'RKinnear7273', name: '互联网赚（点头像）', bio: '', location: '' },
    };
    const symbolSpam = {
      id: 'rwayne-3',
      content: '༺࿌༈💋💦༈࿌༻',
      urls: [],
      author: { handle: 'sym', name: 'Normal', bio: '', location: '' },
    };
    const normalShort = {
      id: 'ok-short',
      content: '确实不错',
      urls: [],
      author: { handle: 'ok', name: 'Normal', bio: '', location: '' },
    };
    const resourceOk = {
      id: 'fp-1',
      content: '分享一份资料',
      urls: [],
      author: { handle: 'iBigQiang', name: '大强', bio: '高质量资料和工具整理', location: '' },
    };

    expect(api._debug.classify(commission).matches.some((m) => m.id === 'spam-name-funnel-high')).toBe(true);
    expect(api._debug.classify(avatarFunnel).matches.some((m) => m.id === 'spam-name-funnel-high')).toBe(true);
    expect(api._debug.classify(symbolSpam).matches.some((m) => m.id === 'spam-short-symbol-content-high')).toBe(true);
    expect(api._debug.classify(normalShort).hide).toBe(false);
    expect(api._debug.classify(resourceOk).hide).toBe(false);
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
    expect(classified.matches.some((m) => m.id === 'spam-bio-zhongtui-high')).toBe(true);
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

  it('content-filter is opt-in and restores hidden cells when disabled', () => {
    const h = contentFilterDomHarness();
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/rwayne/status/2059141230542671887' } } });
    api.updateSettings({ enabled: false, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.style.display || '').toBe('');

    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');

    api.updateSettings({ enabled: false, level: 'standard', whitelistFollowing: false });
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.style.display || '').toBe('');
  });

  it('only filters reply cells on tweet detail pages', () => {
    const h = contentFilterDomHarness();
    const homeApi = loadDebug({ document: h.document, window: { location: { pathname: '/home' } } });
    homeApi.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    homeApi._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    homeApi._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.style.display || '').toBe('');

    const detail = contentFilterDomHarness();
    const detailApi = loadDebug({ document: detail.document, window: { location: { pathname: '/rwayne/status/2059141230542671887' } } });
    detailApi.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    detailApi._debug.scanForTweets({ tweet_results: { result: detail.tweet } });
    detailApi._debug.applyHidesNow();
    expect(detail.mainArticle.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(detail.mainCell.style.display || '').toBe('');
    expect(detail.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(detail.cell.style.display).toBe('none');
    expect(detailApi._debug.replyArticles()).toHaveLength(1);
    expect(detail.root.children[0]).toBe(detail.mainCell);
    expect(detail.root.children[1].id).toBe('xvm-content-filter-summary');
    expect(detail.root.children[2]).toBe(detail.cell);
  });

  it('uses DOM fallback for reply names when GraphQL fields are missing', () => {
    const h = contentFilterDomHarness({ domName: '互联网赚（点头像） @RKinnear7273', domContent: 'hello' });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/rwayne/status/2059141230542671887' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');
  });

  it('ignores summary DOM mutations and debounces external observer work', () => {
    let observerCallback = null;
    let rafCalls = 0;
    class TestMutationObserver {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    }
    const summary = attrNode('summary');
    summary.id = 'xvm-content-filter-summary';
    summary.closest = (selector) => (selector === '#xvm-content-filter-summary, #xvm-content-filter-style' ? summary : null);
    const style = attrNode('style');
    style.id = 'xvm-content-filter-style';
    const external = attrNode('external');
    const api = loadDebug({
      MutationObserver: TestMutationObserver,
      requestAnimationFrame: () => { rafCalls += 1; },
    });
    expect(api._debug.isOwnMutation({ target: summary, addedNodes: [], removedNodes: [] })).toBe(true);
    expect(api._debug.isOwnMutation({ target: external, addedNodes: [style], removedNodes: [] })).toBe(true);
    expect(api._debug.isOwnMutation({ target: external, addedNodes: [], removedNodes: [] })).toBe(false);

    observerCallback([{ target: summary, addedNodes: [], removedNodes: [] }]);
    expect(rafCalls).toBe(0);
    observerCallback([{ target: external, addedNodes: [], removedNodes: [] }]);
    observerCallback([{ target: external, addedNodes: [], removedNodes: [] }]);
    expect(rafCalls).toBe(1);
  });

  it('does not rewrite the summary when hidden records are unchanged', () => {
    const h = contentFilterDomHarness();
    let html = '';
    let writes = 0;
    const summary = {
      id: 'xvm-content-filter-summary',
      className: 'xvm-cf-summary',
      dataset: {},
      hidden: false,
      addEventListener() {},
      closest: (selector) => (selector === '#xvm-content-filter-summary, #xvm-content-filter-style' ? summary : null),
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        writes += 1;
      },
    };
    const document = {
      ...h.document,
      getElementById(id) {
        if (id === 'xvm-content-filter-summary') return summary;
        return null;
      },
    };
    const api = loadDebug({ document, window: { location: { pathname: '/rwayne/status/2059141230542671887' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();
    expect(writes).toBe(1);
    expect(html).toContain('已过滤 1 条回复 - XVM');
    api._debug.applyHidesNow();
    expect(writes).toBe(1);
  });
});
