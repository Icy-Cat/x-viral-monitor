// Walk every tweet_results.result in the sample, extract author identity
// + content, classify via the filter, list any heuristically-spammy
// account that didn't HIDE. This catches misses where the bio is spam
// but the reply content is generic.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const samplePath = process.argv[2] || 'D:/Downloads/剪贴板文本 (12).txt';
const text = readFileSync(samplePath, 'utf8');
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

// Quick + dirty: parse the JSON whole and walk it.
let root;
try { root = JSON.parse(text); }
catch (_) {
  // The clipboard sample may be a JSON fragment; wrap as needed.
  try { root = JSON.parse('{"data":' + text + '}'); }
  catch (_) {
    console.log('Cannot parse JSON; falling back to regex scan');
    process.exit(0);
  }
}

const seen = new Set();
const accounts = [];
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.tweet_results?.result) {
    const result = node.tweet_results.result;
    const tweet = result.tweet || result;
    const legacy = tweet?.legacy;
    const user = tweet?.core?.user_results?.result;
    const userLegacy = user?.legacy;
    const handle = user?.core?.screen_name || userLegacy?.screen_name || '';
    if (handle && !seen.has(handle)) {
      seen.add(handle);
      accounts.push({
        handle,
        name: user?.core?.name || userLegacy?.name || '',
        bio: user?.profile_bio?.description || userLegacy?.description || '',
        location: user?.location?.location || userLegacy?.location || '',
        content: legacy?.full_text || '',
      });
    }
  }
  if (Array.isArray(node)) for (const v of node) walk(v);
  else for (const k of Object.keys(node)) walk(node[k]);
}
walk(root);

console.log(`Found ${accounts.length} unique authors\n`);

const SPAM_HEURISTIC = /电报|telegram|t\.me|加.{0,2}V|免费.{0,2}约|约.{0,2}P|盗图|性癖|🔞|曰炮|福利姬|主页能打|sao货|sao的很|体制内.{0,4}sao|全网首家|匹配平台|资源牵线/i;

let miss = 0;
for (const a of accounts) {
  const looksSpam = SPAM_HEURISTIC.test(a.bio) || SPAM_HEURISTIC.test(a.name) || SPAM_HEURISTIC.test(a.content) || SPAM_HEURISTIC.test(a.location);
  const r = api._debug.classify({
    id: 'p', content: a.content, urls: [],
    author: { handle: a.handle, name: a.name, bio: a.bio, location: a.location },
  });
  const tag = r.hide ? '🔴' : (looksSpam ? '⚠️ MISS' : '🟢');
  if (looksSpam && !r.hide) {
    miss++;
    console.log(tag, `@${a.handle}`);
    console.log('   name:', a.name);
    console.log('   bio :', a.bio.slice(0, 120));
    console.log('   text:', a.content.slice(0, 80));
    console.log();
  }
}
console.log(`spam-heuristic but PASS: ${miss}`);
