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
const bootstrapRulesJson = JSON.parse(readFileSync(resolve(repo, 'src/premium/content-filter/bootstrap-rules.json'), 'utf8'));
const syncRulesScript = readFileSync(resolve(repo, 'scripts/sync-rules.mjs'), 'utf8');
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

function contentFilterDomHarness({ domName = 'Spam @spam', domContent = 'hello', emojiAlt = '' } = {}) {
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
  mainCell.children = [];
  mainCell.appendChild = (node) => {
    node.parentElement = mainCell;
    const i = mainCell.children.indexOf(node);
    if (i >= 0) mainCell.children.splice(i, 1);
    mainCell.children.push(node);
    mainCell.lastElementChild = node;
  };
  mainCell.lastElementChild = null;
  const mainArticle = attrNode('article');
  const cell = attrNode('cell');
  const article = attrNode('article');
  const mainLink = { getAttribute: () => '/example_main/status/100001' };
  const link = { getAttribute: () => '/example_reply/status/1' };
  const nameNode = { textContent: domName };
  const textNode = {
    textContent: domContent,
    querySelectorAll: (selector) => (selector === 'img[alt]' && emojiAlt
      ? [{ alt: emojiAlt, getAttribute: () => emojiAlt }]
      : []),
  };
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

  it('badge CSS hides incomplete velocity badges via data-attribute selectors (not :empty)', () => {
    const styles = readFileSync(resolve(repo, 'styles.css'), 'utf8');
    // :empty does NOT work for badges — their visible text lives in
    // ::before/::after pseudo-elements which :empty ignores. Using :empty
    // would hide every badge in production (regression from earlier fix).
    expect(styles).not.toMatch(/\.xvm-badge:empty/);
    expect(styles).toMatch(/\.xvm-badge:not\(\[data-prefix\]\)/);
    expect(styles).toMatch(/\.xvm-badge:not\(\[data-velocity\]\)/);
    expect(styles).toMatch(/\.xvm-badge\[data-prefix=""\]/);
    expect(styles).toMatch(/\.xvm-badge\[data-velocity=""\]/);
    expect(content).toMatch(/if \(!prefix \|\| !velocityLabel\) continue/);
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

  it('bundled bootstrap rules stay small and high-confidence only', () => {
    expect(syncRulesScript).toContain('bootstrap-rules.json');
    expect(syncRulesScript).not.toContain("content-filter/rules.json'");
    expect(bootstrapRulesJson.rules.length).toBeLessThan(rulesJson.rules.length);
    for (const rule of bootstrapRulesJson.rules) {
      expect(['high', 'block']).toContain(rule.severity);
      expect(rule.type === 'domain' && rule.value === 't.me').toBe(false);
    }
    for (const rule of rulesJson.rules) {
      expect(rule.id).not.toBe('spam-telegram-domain-medium');
      expect(rule.type === 'domain' && rule.value === 't.me').toBe(false);
    }
    expect(bootstrapRulesJson.rules.some((rule) => rule.id === 'hard-telegram-group-funnel')).toBe(true);
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
    const telegramOnly = {
      id: 'telegram-plain',
      content: '我也在 Telegram 和 t.me 备份更新',
      urls: ['https://t.me/example'],
      author: { handle: 'builder', name: 'normal', bio: 'Telegram mirror', location: '' },
    };
    const telegramFunnel = {
      id: 'telegram-funnel',
      content: '福利视频和资源都在 t.me/example 群里，私信加入',
      urls: ['https://t.me/example'],
      author: { handle: 'spam', name: 'promo', bio: '电报福利资源频道', location: '' },
    };
    const telegramDiscussion = {
      id: 'telegram-discussion',
      content: '技术文章同步到 t.me/example 讨论群，方便读者订阅',
      urls: ['https://t.me/example'],
      author: { handle: 'creator', name: 'normal', bio: 'Telegram mirror', location: '' },
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
    expect(api._debug.classify(telegramOnly).hide).toBe(false);
    expect(api._debug.classify(telegramDiscussion).hide).toBe(false);
    expect(api._debug.classify(telegramFunnel).hide).toBe(true);
    expect(api._debug.classify(telegramFunnel).matches.some((m) => m.field === 'content' && m.severity === 'block')).toBe(true);
    expect(api._debug.classify(marketingOnly).hide).toBe(false);
    expect(api._debug.classify(highName).hide).toBe(true);
    expect(api._debug.classify(broadResource).hide).toBe(false);
    api.updateSettings({ enabled: true, level: 'strict', whitelistFollowing: false });
    expect(api._debug.classify(tmeOnly).hide).toBe(false);
    expect(api._debug.classify(telegramOnly).hide).toBe(false);
    expect(api._debug.classify(telegramDiscussion).hide).toBe(false);
    expect(api._debug.classify(telegramFunnel).hide).toBe(true);
    expect(api._debug.classify(marketingOnly).hide).toBe(true);
    expect(api._debug.classify(lowOnly).hide).toBe(false);
  });

  it('does not treat a profile t.me URL as the telegram-funnel trigger by itself', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const normalReplyWithTelegramProfileUrl = {
      id: 'profile-url-tme-ok',
      content: '@sample_user 我就在用这个，我觉得界面很好看',
      urls: ['https://t.me/sample'],
      author: {
        handle: 'sample_source',
        name: 'Sample Source',
        bio: '记录上门维修和界面设计，不做链接引导',
        location: '',
      },
    };

    const result = api._debug.classify(normalReplyWithTelegramProfileUrl);
    expect(result.hide).toBe(false);
    expect(result.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(false);
  });

  it('does not block normal replies from author bio telegram/backoffice wording', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const normalReplyWithTelegramBio = {
      id: 'bio-telegram-ok',
      content: '@sample_user 我就在用这个，我觉得界面很好看',
      urls: [],
      author: {
        handle: 'sample_source',
        name: 'Sample Source',
        bio: 'Telegram 备份，记录上门维修和界面设计',
        location: '',
      },
    };

    const result = api._debug.classify(normalReplyWithTelegramBio);
    expect(result.hide).toBe(false);
    expect(result.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(false);
  });

  it('covers sample follow-up false negatives without broad resource false positives', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const sameCity = {
      id: 'fn-1',
      content: '想找我的宝宝点这里 https://t.co/a',
      urls: ['https://t.me/sample'],
      author: {
        handle: 'spam_offline_1',
        name: '用户A🌸同城上门',
        bio: '想找我的宝宝点这里✈ t.me/sample 安全靠谱',
        location: '',
      },
    };
    const clickBig = {
      id: 'fn-2',
      content: 'hello',
      urls: [],
      author: {
        handle: 'spam_offline_2',
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
        handle: 'normal_user',
        name: '普通用户',
        bio: '高质量资料和工具整理',
        location: '',
      },
    };

    const sameCityHit = api._debug.classify(sameCity);
    expect(sameCityHit.hide).toBe(true);
    expect(sameCityHit.matches.some((m) => m.id === 'adult-name-offline-high')).toBe(true);
    expect(sameCityHit.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(false);

    const clickBigHit = api._debug.classify(clickBig);
    expect(clickBigHit.hide).toBe(true);
    expect(clickBigHit.matches.some((m) => m.id === 'adult-location-offline-high')).toBe(true);

    expect(api._debug.classify(resourceOk).hide).toBe(false);
  });

  it('covers page-name funnels and short symbol spam in standard mode', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const commission = {
      id: 'sample-1',
      content: '普通回复',
      urls: [],
      author: { handle: 'spam_funnel_a', name: '50返佣', bio: '', location: '' },
    };
    const avatarFunnel = {
      id: 'sample-2',
      content: '普通回复',
      urls: [],
      author: { handle: 'spam_funnel_b', name: '互联网赚（点头像）', bio: '', location: '' },
    };
    const symbolSpam = {
      id: 'sample-3',
      content: 'X65b💋',
      urls: [],
      author: { handle: 'sym', name: 'Normal', bio: '', location: '' },
    };
    const strippedSymbolSpam = {
      id: 'sample-4',
      content: 'X65b',
      urls: [],
      author: { handle: 'spam_short_1', name: 'Sample User', bio: '', location: '' },
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
      author: { handle: 'normal_user', name: '普通用户', bio: '高质量资料和工具整理', location: '' },
    };

    expect(api._debug.classify(commission).matches.some((m) => m.id === 'spam-name-funnel-high')).toBe(true);
    expect(api._debug.classify(avatarFunnel).matches.some((m) => m.id === 'spam-name-funnel-high')).toBe(true);
    expect(api._debug.classify(symbolSpam).matches.some((m) => m.id === 'spam-short-symbol-content-high')).toBe(true);
    expect(api._debug.classify(strippedSymbolSpam).matches.some((m) => m.id === 'spam-short-symbol-content-high')).toBe(true);
    expect(api._debug.classify(normalShort).hide).toBe(false);
    expect(api._debug.classify(resourceOk).hide).toBe(false);
  });

  it('catches exchange support / rebate spam names and satellite contact bios', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const namePositives = [
      { id: 'exchange-1', name: '商务小窗 | 白安 | bitmart92', content: '爱马仕跟小龙虾联名有点东西' },
      { id: 'exchange-2', name: '在线接待: bitmart92 🚀', content: '哈哈，这联名够绝' },
      { id: 'exchange-3', name: '高返 苏禾 bitmart92 ✨', content: '这个联名脑洞可以有' },
    ];

    for (const p of namePositives) {
      const hit = api._debug.classify({
        id: p.id,
        content: p.content,
        urls: [],
        author: { handle: `spam_exchange_${p.id}`, name: p.name, bio: '', location: '' },
      });
      expect(hit.hide).toBe(true);
      expect(hit.matches.some((m) => m.id === 'spam-name-exchange-support-high')).toBe(true);
    }

    const bioPositives = [
      '二手车行想做得稳，报价要清楚，过程要透明。 卫星1:（qqq-0001） 卫星2:（btc-demo） 卫星3:（demo888） （tg：demo_tg） 《（详细点🔗，其他也有做哦》',
      '家政保洁想做得稳，报价要清楚，过程要透明。 卫星1:（demo-a） 卫星2:（demo-b） （tg：demo_tg） 《（详细点🔗，其他也有做哦》',
      '健身私教基本功要打牢。 卫星1:（demo777） 卫星2:（demo28） 卫星3:（demo999） （tg：demo_tg） 《（详细点🔗，其他也有做哦》',
      '不贪不惧，稳住节奏。 wx1:（demo-a） wx2:（demo-b） wx3:（demo-c） （tg：demo_tg） 《（详细点🔗，其他也有做哦》',
    ];

    for (const bio of bioPositives) {
      const hit = api._debug.classify({
        id: 'exchange-bio',
        content: '普通回复',
        urls: [],
        author: { handle: 'spam_exchange_bio', name: '普通用户', bio, location: '' },
      });
      expect(hit.hide).toBe(true);
      expect(hit.matches.some((m) => m.id === 'spam-bio-wechat-telegram-funnel-high')).toBe(true);
    }

    const doorWithBio = api._debug.classify({
      id: 'exchange-door',
      content: '品牌联名整活我爱了',
      urls: [],
      author: {
        handle: 'spam_exchange_door',
        name: '芝麻85 | 门口等你',
        bio: '家政保洁想做得稳，报价要清楚。 卫星1:（demo-a） 卫星2:（demo-b） （tg：demo_tg） 《（详细点🔗，其他也有做哦》',
        location: '',
      },
    });
    expect(doorWithBio.hide).toBe(true);
    expect(doorWithBio.matches.some((m) => m.id === 'spam-bio-wechat-telegram-funnel-high')).toBe(true);
    expect(doorWithBio.matches.some((m) => m.id === 'spam-name-exchange-support-high')).toBe(false);

    const negatives = [
      { id: 'exchange-ok-1', name: 'BitMart Research', content: '整理交易所公告和市场观察' },
      { id: 'exchange-ok-2', name: '商务小窗设计笔记', content: '聊聊店铺门头和橱窗展示' },
      { id: 'exchange-ok-3', name: '普通用户', content: '我在门口等你下班，一起去吃饭' },
      { id: 'exchange-ok-4', name: '芝麻85 | 门口等你', content: '普通回复' },
    ];

    for (const n of negatives) {
      const miss = api._debug.classify({
        id: n.id,
        content: n.content,
        urls: [],
        author: { handle: `normal_${n.id}`, name: n.name, bio: '', location: '' },
      });
      expect(miss.hide).toBe(false);
    }

    const normalBios = [
      '卫星1号和卫星2号观测记录，详细点写在论文附录里。',
      '我用 tg 同步摄影小组通知，也记录卫星影像处理笔记。',
      '报价要清楚，过程要透明，客户体验自然会变好。',
    ];
    for (const bio of normalBios) {
      const miss = api._debug.classify({
        id: 'normal-bio',
        content: '普通回复',
        urls: [],
        author: { handle: 'normal_bio', name: '普通用户', bio, location: '' },
      });
      expect(miss.hide).toBe(false);
    }
  });

  it('covers emoji-grid spam, 免费曰p names, and 小号已禁言 location', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const emojiGrid = {
      id: 'grid-1',
      content: '@example_user 💓w     \n                🌦        \n                               92🤎\n                😗                                         \n📿b',
      urls: [],
      author: { handle: 'spam_grid_1', name: 'Sample User', bio: '', location: '' },
    };
    const freeFunnelName = {
      id: 'funnel-1',
      content: '随便回复',
      urls: [],
      author: { handle: 'spam_funnel_c', name: '用户X🩷免费曰p', bio: '', location: '' },
    };
    const lockedAltLocation = {
      id: 'loc-1',
      content: '随便回复',
      urls: [],
      author: { handle: 'spam_loc_1', name: '用户Y💕', bio: '', location: '小号已禁言 可以来这里找我👉' },
    };
    const normalShort = {
      id: 'ok-emoji',
      content: '@someone 哈哈 真的是这样',
      urls: [],
      author: { handle: 'ok', name: '路人', bio: '', location: '北京' },
    };

    const gridHit = api._debug.classify(emojiGrid);
    expect(gridHit.hide).toBe(true);
    expect(gridHit.matches.some((m) => m.id === 'spam-short-symbol-content-high')).toBe(true);

    const nameHit = api._debug.classify(freeFunnelName);
    expect(nameHit.hide).toBe(true);
    expect(nameHit.matches.some((m) => m.id === 'spam-name-funnel-high')).toBe(true);

    const locHit = api._debug.classify(lockedAltLocation);
    expect(locHit.hide).toBe(true);
    expect(locHit.matches.some((m) => m.id === 'adult-location-template-high')).toBe(true);

    expect(api._debug.classify(normalShort).hide).toBe(false);
  });

  it('catches 主页打✈️ / sao货 / 太涩了 content-funnel patterns', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const sao = api._debug.classify({ id: 's1', content: '@x sao货z 没人比她sao❣️ @y 4w', urls: [], author: { handle: 'a', name: 'A', bio: '', location: '' } });
    expect(sao.hide).toBe(true);
    expect(sao.matches.some((m) => m.id === 'adult-content-page-funnel-high')).toBe(true);

    const plane = api._debug.classify({ id: 's2', content: '@x 刷了半天的X就她的主页能打✈️了 @y', urls: [], author: { handle: 'a', name: 'A', bio: '', location: '' } });
    expect(plane.hide).toBe(true);
    expect(plane.matches.some((m) => m.id === 'adult-content-page-funnel-high')).toBe(true);

    const se = api._debug.classify({ id: 's3', content: '@x 她太涩了 我真顶不住 @y', urls: [], author: { handle: 'a', name: 'A', bio: '', location: '' } });
    expect(se.hide).toBe(true);

    // Negative: normal usage of 顶不住
    const normal = api._debug.classify({ id: 'ok1', content: '今天加班顶不住', urls: [], author: { handle: 'normal', name: 'N', bio: '', location: '' } });
    expect(normal.hide).toBe(false);
  });

  it('catches 30+ 体制内 / sao的很 / 玩的就是返差 funnel templates', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const positives = [
      '@x 30+的b 体制内老师 sao的很 @y 5 t',
      '@x 30+的p 体制内老师 玩的就是返差 @y 0 z',
      '@x sao的很，加 V',
    ];
    for (const c of positives) {
      const r = api._debug.classify({ id: 'p', content: c, urls: [], author: { handle: 'a', name: 'N', bio: '', location: '' } });
      expect(r.hide, `expected HIDE for ${c}`).toBe(true);
      expect(r.matches.some((m) => m.id === 'adult-content-page-funnel-high')).toBe(true);
    }
    const negatives = [
      '30+的人都在体制内工作，挺好',
      '作为体制内老师，我建议大家多看书',
      '30 岁了还在体制内',
    ];
    for (const c of negatives) {
      const r = api._debug.classify({ id: 'n', content: c, urls: [], author: { handle: 'a', name: 'N', bio: '', location: '' } });
      expect(r.hide, `expected PASS for ${c}`).toBe(false);
    }
  });

  it('catches 全网首创线下社交匹配 / 一至五线 / 免费约P offline-match bio family', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const positives = [
      '🏅全网独创线下社交匹配🔥本地免费约P（一至五线）🌍，海外城市同步上新🌪️真实可靠，无 App 安装，专注资源对接👠附近速配',
      '🏅全网首创线下社交匹配🌈覆盖一至五线本地免费约P🌍',
      '🏅全网首家线下社交匹配平台🔆覆盖一至五线城市本地免费约P🥹',
      '🏅首发线下约P社交平台🎀覆盖全国一至五线城市🌿',
    ];
    for (const b of positives) {
      const r = api._debug.classify({ id: 'p', content: '', urls: [], author: { handle: 'a', name: 'N', bio: b, location: '' } });
      expect(r.hide, `expected HIDE for bio: ${b.slice(0, 40)}`).toBe(true);
      expect(r.matches.some((m) => m.id === 'adult-bio-offline-match-high')).toBe(true);
    }
    // Negatives — generic terms that share a word but aren't spam.
    const negatives = [
      '线下社交活动志愿者',
      '在做线下社交方向的产品',
      '一三五线城市都跑过',
    ];
    for (const b of negatives) {
      const r = api._debug.classify({ id: 'n', content: '', urls: [], author: { handle: 'a', name: 'N', bio: b, location: '' } });
      expect(r.hide, `expected PASS for bio: ${b}`).toBe(false);
    }
  });

  it('catches 🔞 + 性癖 / 盗图死全家 / 全网仅此一号 bio templates', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const eve = api._debug.classify({
      id: 'eve',
      content: '随便',
      urls: [],
      author: { handle: 'spam_adult_1', name: '某用户A', bio: '🔞某用户 165 150 bbw bi tomboy virgin 这里只有性癖\n📢无门无电报 全网仅此一号 全国不可飞 盗图死全家', location: '' },
    });
    expect(eve.hide).toBe(true);
    expect(eve.matches.some((m) => m.id === 'adult-bio-profile-template-high')).toBe(true);

    // Negative: 🔞 standalone (no funnel words) must not hit.
    const lone = api._debug.classify({
      id: 'lone',
      content: '随便',
      urls: [],
      author: { handle: 'normal_a', name: 'Normal A', bio: '🔞 注意分级', location: '' },
    });
    expect(lone.hide).toBe(false);
  });

  it('does not false-positive bios that mention 中推 in non-spam context', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    const ok = api._debug.classify({
      id: 'biz',
      content: '随便',
      urls: [],
      author: {
        handle: 'normal_b',
        name: 'Normal B',
        bio: '中推用户之一，记录日常',
        location: '',
      },
    });
    expect(ok.hide).toBe(false);

    const mirror = api._debug.classify({
      id: 'mirror',
      content: '中推用户，记录中文推特日常讨论',
      urls: [],
      author: {
        handle: 'normal_c',
        name: 'Normal C',
        bio: '中文推特观察，记录日常',
        location: '',
      },
    });
    expect(mirror.hide).toBe(false);
  });

  it('does not use 中推 / 中文推特 as built-in content-filter keywords', () => {
    const sources = [
      ['rules.json', JSON.stringify(rulesJson)],
      ['bootstrap-rules.json', JSON.stringify(bootstrapRulesJson)],
      ['rules.js', readFileSync(resolve(repo, 'src/premium/content-filter/rules.js'), 'utf8')],
      ['filter.js hard-coded fallback', filter],
    ];
    for (const [name, body] of sources) {
      expect(body.includes('中推'), `${name} must not filter on 中推`).toBe(false);
      expect(body.includes('中文推特'), `${name} must not filter on 中文推特`).toBe(false);
    }
  });

  it('does not false-positive 福利鸭 / 福利姬 self-mockery bios when keyword is not paired with spam carrier', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const ducky = {
      id: 'fp-ducky',
      content: '今天好困',
      urls: [],
      author: {
        handle: 'sample_following_a',
        name: 'Sample',
        bio: '健身教练，自嘲想当福利鸭',
        location: '',
      },
    };
    const realSpam = {
      id: 'tp-spam',
      content: '福利资源都在群里',
      urls: [],
      author: { handle: 'spam_zhongtui', name: 'spam', bio: '福利姬导航', location: '' },
    };

    expect(api._debug.classify(ducky).hide).toBe(false);
    expect(api._debug.classify(realSpam).hide).toBe(true);
  });

  it('DOM-fallback decisions only fire hide on block severity (avoid whitelist false-positives)', () => {
    // Simulate a reply whose data only ever came from the DOM scraper —
    // following:false is hardcoded there. A high-severity name match
    // should NOT hide because the user might be a followed account whose
    // whitelist status is invisible to DOM. A block-severity match still
    // hides (telegram funnel etc. — those are unambiguous).
    const h = contentFilterDomHarness({ domName: '互联网赚（点头像） @spam_user', domContent: '只是个普通回复' });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: true });
    // Do NOT scanForTweets — we want DOM fallback to be the only data source.
    api._debug.applyHidesNow();
    // Name matches spam-name-funnel-high (severity: high), but DOM fallback
    // can't see following, so the gate must hold the hide.
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.style.display || '').toBe('');
  });

  it('DOM-fallback block-severity matches (telegram funnel) still hide', () => {
    const h = contentFilterDomHarness({
      domName: 'Sample',
      domContent: '电报群福利资源都在群里，私信加入',
    });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: true });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');
  });

  it('GraphQL data overwrites a DOM-fallback decision so following:true wins', () => {
    const h = contentFilterDomHarness({ domName: '互联网赚（点头像） @gyro_clone', domContent: '今天好困' });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: true });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);

    // Now GraphQL data arrives for the same id with following:true.
    api._debug.scanForTweets({
      tweet_results: {
        result: {
          legacy: { id_str: '1', full_text: 'today', created_at: '', entities: {} },
          core: {
            user_results: {
              result: {
                rest_id: 'u1',
                core: { name: '互联网赚（点头像）', screen_name: 'gyro_clone' },
                legacy: { name: '互联网赚（点头像）', screen_name: 'gyro_clone', description: '', location: '' },
                relationship_perspectives: { following: true },
              },
            },
          },
        },
      },
    });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.cell.style.display || '').toBe('');
  });

  it('whitelistFollowing short-circuits classification regardless of which rules would match', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: true });

    const followingButTriggers = {
      id: 'fp-following',
      content: '福利资源 telegram 群',
      urls: ['https://t.me/sample'],
      author: {
        handle: 'gyro_ai_clone',
        name: 'Sample Follow',
        bio: '福利姬导航 中推电报频道',
        location: '同城上门',
        following: true,
      },
    };
    const result = api._debug.classify(followingButTriggers);
    expect(result.hide).toBe(false);
    expect(result.reason).toBe('whitelist');
    expect(result.matches).toHaveLength(0);
  });

  it('catches 曰炮平台 / 真人认证 / 小号已禁言大号 bios even when content slips short-symbol check', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    const candySpam = {
      id: 'bio-funnel-1',
      content: '@example_user 🐋刚分手想被爱⛵️i',
      urls: [],
      author: {
        handle: 'spam_bio_1',
        name: '某账号',
        bio: '已入驻曰炮平台:👉https://t.co/x，真人认证隐私保护，上平台隐私安全有保障，附近的可加V，小号已禁言大号在这👉@example_alt',
        location: '',
      },
    };
    const normalBio = {
      id: 'bio-ok-1',
      content: '今天天气真好',
      urls: [],
      author: { handle: 'ok', name: '路人', bio: '热爱生活的产品经理', location: '' },
    };

    const hit = api._debug.classify(candySpam);
    expect(hit.hide).toBe(true);
    expect(hit.matches.some((m) => m.id === 'adult-bio-funnel-platform-high')).toBe(true);

    expect(api._debug.classify(normalBio).hide).toBe(false);
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
            core: { name: 'Sample', screen_name: 'sample_user' },
            legacy: {
              description: '家父马斯克，电报频道见 t.me/sample',
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
    expect(raw.author.handle).toBe('sample_user');
    expect(raw.urls).toContain('https://t.me/sample');
    expect(raw.urls).toContain('http://t.me/zhongwentwitter');
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    const classified = api._debug.classify(raw);
    expect(classified.hide).toBe(true);
    expect(classified.matches.some((m) => m.id === 'hard-telegram-group-funnel')).toBe(false);
    expect(classified.matches.some((m) => m.id === 'spam-bio-zhongtui-high')).toBe(true);
  });

  it('leaderboard still references the content-filter hide marker for its own rendering', () => {
    // rate-filter now drives hides via a root-attribute CSS toggle and
    // no longer needs to coordinate with content-filter's inline style.
    // content.js (leaderboard render) still respects the marker so a
    // content-filter-hidden tweet isn't counted into the visible list.
    expect(content).toMatch(/data-xvm-content-filter-hidden/);
  });

  it('content-filter exposes a local RuleSource abstraction for future remote rules', () => {
    expect(filter).toMatch(/createLocalRuleSource/);
    expect(filter).toMatch(/type:\s*['"]local-json['"]/);
    expect(filter).toMatch(/window\.__xvmContentFilterBuiltinRules/);
  });

  it('hot-swaps rules from a remote-rules postMessage and reclassifies cached tweets', () => {
    const api = loadDebug();
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

    // Pretend a brand-new high-severity rule is added remotely that matches
    // a benign-looking handle which would not hit the bundled ruleset.
    const probe = {
      id: 'remote-probe-1',
      content: '今天天气真好',
      urls: [],
      author: { handle: 'ok', name: '某新马甲', bio: '', location: '' },
    };
    expect(api._debug.classify(probe).hide).toBe(false);
    expect(api._debug.rulesSource()).toBe('bundled');

    api._debug.updateRulesFromRemote({
      version: 2,
      levels: {
        light: ['remote-test-name-high'],
        standard: ['remote-test-name-high'],
        strict: ['remote-test-name-high'],
      },
      rules: [
        { id: 'remote-test-name-high', type: 'regex', field: 'name', value: '某新马甲', severity: 'high' },
      ],
    }, 'remote-fresh');

    expect(api._debug.rulesSource()).toBe('remote-fresh');
    const hit = api._debug.classify(probe);
    expect(hit.hide).toBe(true);
    expect(hit.matches.some((m) => m.id === 'remote-test-name-high')).toBe(true);
  });

  it('isolated bridge wires the remote-rules fetch, cache, and postMessage path', () => {
    expect(isolated).toMatch(/CONTENT_FILTER_RULES_KEY\s*=\s*['"]xvm_content_filter_rules_remote_v1['"]/);
    expect(isolated).toMatch(/REMOTE_RULES_URL\s*=\s*['"]https:\/\/raw\.githubusercontent\.com\/Icy-Cat\/x-viral-monitor\/main\/src\/premium\/content-filter\/rules\.json['"]/);
    expect(isolated).toMatch(/XVM_CONTENT_FILTER_RULES_UPDATE/);
    expect(isolated).toMatch(/fetchRemoteContentFilterRules/);
    expect(isolated).toMatch(/pushCachedContentFilterRules/);
    expect(rulesJson.version).toBe(2);
    expect(filter).toMatch(/REMOTE_RULES_CURRENT_VERSION\s*=\s*2/);
    expect(isolated).toMatch(/REMOTE_RULES_CURRENT_VERSION\s*=\s*2/);
    expect(isolated).toMatch(/p\.version\s*!==\s*REMOTE_RULES_CURRENT_VERSION/);
    expect(popupFilter).toMatch(/REMOTE_RULES_CURRENT_VERSION\s*=\s*2/);
  });

  it('isolated rule validator rejects regex DoS, unknown types, and future schema versions', () => {
    // We can't easily run the IIFE in isolation, but we can grep the
    // hardened constants + heuristic regex out of the source to make sure
    // future refactors don't drop the defense.
    expect(isolated).toMatch(/REGEX_MAX_LEN\s*=\s*400/);
    expect(isolated).toMatch(/REGEX_NESTED_QUANTIFIER/);
    expect(isolated).toMatch(/REMOTE_RULES_SCHEMA_MAX/);
    expect(isolated).toMatch(/REMOTE_RULES_MIN_RETRY_MS/);
    expect(isolated).toMatch(/RULE_TYPES_ALLOWED/);
  });

  it('manifest grants host_permissions for the remote rules host', () => {
    expect(Array.isArray(manifest.host_permissions)).toBe(true);
    expect(manifest.host_permissions).toContain('https://raw.githubusercontent.com/*');
  });

  it('uses the generated PNG icon set for the toolbar action', () => {
    expect(manifest.action?.default_icon).toEqual({
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    });
  });

  it('rules.js bundled fallback stays in sync with bootstrap-rules.json only', () => {
    const rulesJs = readFileSync(resolve(repo, 'src/premium/content-filter/rules.js'), 'utf8');
    for (const id of bootstrapRulesJson.rules.map((r) => r.id)) {
      expect(rulesJs).toContain(id);
    }
    for (const id of [...bootstrapRulesJson.levels.standard, ...bootstrapRulesJson.levels.strict]) {
      expect(rulesJs).toContain(id);
    }
    expect(rulesJs).not.toContain('spam-telegram-domain-medium');
    expect(rulesJs).not.toContain('"type": "domain"');
  });

  it('content-filter is opt-in and restores hidden cells when disabled', () => {
    const h = contentFilterDomHarness();
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
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
    const detailApi = loadDebug({ document: detail.document, window: { location: { pathname: '/example_main/status/100001' } } });
    detailApi.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    detailApi._debug.scanForTweets({ tweet_results: { result: detail.tweet } });
    detailApi._debug.applyHidesNow();
    expect(detail.mainArticle.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(detail.mainCell.style.display || '').toBe('');
    expect(detail.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(detail.cell.style.display).toBe('none');
    expect(detailApi._debug.replyArticles()).toHaveLength(1);
    expect(detail.root.children[0]).toBe(detail.mainCell);
    expect(detail.root.children[1]).toBe(detail.cell);
    expect(detail.mainCell.lastElementChild?.id).toBe('xvm-content-filter-summary');
  });

  it('ignores reply composer dialog cells when filtering the background detail page', () => {
    const h = contentFilterDomHarness();
    const dialog = attrNode('dialog');
    const modalCell = attrNode('cell');
    const modalArticle = attrNode('article');
    const modalLink = { getAttribute: () => '/example_main/status/100001' };
    modalCell.closest = (selector) => (selector === '[role="dialog"]' ? dialog : null);
    modalCell.querySelector = (selector) => (selector === 'article[data-testid="tweet"]' ? modalArticle : null);
    modalArticle.closest = (selector) => {
      if (selector === '[role="dialog"]') return dialog;
      if (selector === '[data-testid="cellInnerDiv"]') return modalCell;
      return null;
    };
    modalArticle.querySelector = (selector) => (selector.includes('/status/') ? modalLink : null);
    h.document.querySelectorAll = (selector) => {
      if (selector === 'article[data-testid="tweet"]') return [modalArticle, h.mainArticle, h.article];
      if (selector === '[data-testid="cellInnerDiv"]') return [modalCell, h.mainCell, h.cell];
      return [];
    };

    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();

    expect(api._debug.replyArticles()).toEqual([h.article]);
    expect(api._debug.findReplyAnchor().host).toBe(h.mainCell);
    expect(h.mainArticle.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');
  });

  it('keeps filtering the background detail page while the reply composer owns the URL', () => {
    const h = contentFilterDomHarness();
    const dialog = attrNode('dialog');
    const modalArticle = attrNode('article');
    const modalLink = { getAttribute: () => '/example_main/status/100001' };
    const window = { location: { pathname: '/example_main/status/100001' } };
    h.document.querySelector = (selector) => (selector === '[role="dialog"]' ? dialog : null);
    const baseQuerySelectorAll = h.document.querySelectorAll;
    modalArticle.querySelector = (selector) => (selector.includes('/status/') ? modalLink : null);
    h.document.querySelectorAll = (selector) => (
      selector === '[role="dialog"] article[data-testid="tweet"]' ? [modalArticle] : baseQuerySelectorAll(selector)
    );
    const api = loadDebug({ document: h.document, window });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();
    expect(h.cell.style.display).toBe('none');

    h.cell.style.display = '';
    window.location.pathname = '/compose/post';
    api._debug.applyHidesNow();

    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');
  });

  it('does not reuse the last detail status for a normal compose dialog', () => {
    const h = contentFilterDomHarness();
    const dialog = attrNode('dialog');
    const window = { location: { pathname: '/example_main/status/100001' } };
    h.document.querySelector = (selector) => (selector === '[role="dialog"]' ? dialog : null);
    const baseQuerySelectorAll = h.document.querySelectorAll;
    h.document.querySelectorAll = (selector) => (
      selector === '[role="dialog"] article[data-testid="tweet"]' ? [] : baseQuerySelectorAll(selector)
    );
    const api = loadDebug({ document: h.document, window });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();

    window.location.pathname = '/compose/post';

    expect(api._debug.isTweetDetailPage()).toBe(false);
  });

  it('hosts the summary inside the main tweet cell so it shares the virtualized slot', () => {
    const detail = contentFilterDomHarness();
    const separator = attrNode('separator');
    separator.parentElement = detail.root;
    detail.root.children = [detail.mainCell, separator, detail.cell];
    detail.root.firstChild = detail.mainCell;

    const detailApi = loadDebug({ document: detail.document, window: { location: { pathname: '/example_main/status/100001' } } });
    detailApi.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    detailApi._debug.scanForTweets({ tweet_results: { result: detail.tweet } });
    detailApi._debug.applyHidesNow();

    expect(detail.root.children).toEqual([detail.mainCell, separator, detail.cell]);
    expect(detail.mainCell.lastElementChild?.id).toBe('xvm-content-filter-summary');
    expect(detail.mainCell.lastElementChild?.parentElement).toBe(detail.mainCell);
  });

  it('DOM fallback extracts and classifies high-severity name spam (but defers hiding to GraphQL)', () => {
    const h = contentFilterDomHarness({ domName: '互联网赚（点头像） @spam_user', domContent: 'hello' });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.applyHidesNow();
    // DOM-only data: classify still flags it, but the gate refuses to hide
    // until GraphQL confirms (so followed accounts don't get false-hidden).
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
    // Confirm the classifier still recognized the pattern — when GraphQL
    // confirms the user isn't followed, the next applyHidesNow hides them.
    api._debug.scanForTweets({
      tweet_results: {
        result: {
          legacy: { id_str: '1', full_text: 'hello', entities: {} },
          core: {
            user_results: {
              result: {
                rest_id: 'u1',
                core: { name: '互联网赚（点头像）', screen_name: 'spam_user' },
                legacy: { name: '互联网赚（点头像）', screen_name: 'spam_user', description: '', location: '' },
                relationship_perspectives: { following: false },
              },
            },
          },
        },
      },
    });
    api._debug.applyHidesNow();
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(true);
    expect(h.cell.style.display).toBe('none');
  });

  it('DOM fallback short-symbol spam stays visible until GraphQL confirms', () => {
    const h = contentFilterDomHarness({ domName: 'Sample User @spam_user', domContent: 'X 65 b', emojiAlt: '💋' });
    const api = loadDebug({ document: h.document, window: { location: { pathname: '/example_main/status/100003' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.applyHidesNow();
    // DOM-only short-symbol match is high severity, so it must NOT auto-hide.
    expect(h.article.hasAttribute('data-xvm-content-filter-hidden')).toBe(false);
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
    const api = loadDebug({ document, window: { location: { pathname: '/example_main/status/100001' } } });
    api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });
    api._debug.scanForTweets({ tweet_results: { result: h.tweet } });
    api._debug.applyHidesNow();
    expect(writes).toBe(1);
    expect(html).toContain('已过滤 1 条回复 - XVM');
    api._debug.applyHidesNow();
    expect(writes).toBe(1);
  });

  it('formats filtered reply diagnostics with tweet content and matched rule ids for copy', () => {
    const api = loadDebug();
    const text = api._debug.formatHiddenRecordsForCopy([
      {
        id: '10001',
        name: 'Sample User',
        handle: 'sample_user',
        content: '我就在用这个，我觉得界面很好看',
        matches: [
          { id: 'custom-ui-block', field: 'content', severity: 'block', label: '界面' },
          { id: 'spam-name-funnel-high', field: 'name', severity: 'high', label: '主页' },
        ],
      },
    ]);

    expect(text).toContain('XVM 已过滤回复诊断');
    expect(text).toContain('tweet_id: 10001');
    expect(text).toContain('author: Sample User @sample_user');
    expect(text).toContain('content: 我就在用这个，我觉得界面很好看');
    expect(text).toContain('id=custom-ui-block; field=content; severity=block; value=界面');
    expect(text).toContain('id=spam-name-funnel-high; field=name; severity=high; value=主页');
  });

  it('prevents the filtered summary from leaving accidental selected text behind', () => {
    let cleared = 0;
    const api = loadDebug({
      window: {
        getSelection: () => ({
          isCollapsed: false,
          removeAllRanges: () => { cleared += 1; },
        }),
      },
    });

    expect(filter).toContain('user-select:none');
    api._debug.clearTextSelection();
    expect(cleared).toBe(1);
  });
});
