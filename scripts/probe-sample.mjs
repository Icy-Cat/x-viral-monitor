// One-off: run sample 12 (or any sample) through content-filter classify,
// list every reply that "looks spam" by heuristic but didn't HIDE.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const samplePath = process.argv[2] || 'D:/Downloads/剪贴板文本 (12).txt';
const raw = readFileSync(samplePath, 'utf8');

const rules = JSON.parse(readFileSync('src/premium/content-filter/rules.json', 'utf8'));
const filterJs = readFileSync('src/premium/content-filter/filter.js', 'utf8');
const win = {
  location: { pathname: '/abc/status/1' },
  addEventListener() {},
  postMessage() {},
  __xvmContentFilterBuiltinRules: rules,
  __xvmNet: { onResponse() {} },
  __xvmPro: { isFeatureEnabled: () => true, onTierChange() {} },
};
const ctx = {
  window: win,
  document: {
    documentElement: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ id: '', style: {}, dataset: {}, appendChild() {}, addEventListener() {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout,
  URL,
  console,
};
vm.runInNewContext(filterJs, ctx);
const api = win.__xvmContentFilter;
api.updateSettings({ enabled: true, level: 'standard', whitelistFollowing: false });

const re = /"full_text":\s*"((?:\\.|[^"\\])*)"/g;
const replies = [];
for (const m of raw.matchAll(re)) {
  replies.push(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
}

const SPAM_HEURISTIC = /✈️|sao货|🗜|🧙|😫|👷|她太涩|sao的很|玩.{0,4}[反返]差|没人比.{0,4}sao|30\+.{0,8}体制内|主页能打/i;

let missed = 0;
console.log(`Total replies: ${replies.length}\n`);
for (const c of replies) {
  const r = api._debug.classify({ id: 'x', content: c, urls: [], author: { handle: 'a', name: 'N', bio: '', location: '' } });
  const looksSpam = SPAM_HEURISTIC.test(c);
  const tag = r.hide ? '🔴' : (looksSpam ? '⚠️ MISS' : '🟢');
  if (looksSpam && !r.hide) missed++;
  console.log(tag, (r.matches.map((m) => m.id).join(',') || '-').padEnd(34), c.slice(0, 70));
}
console.log(`\nspam-heuristic but PASS: ${missed}`);
