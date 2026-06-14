---
name: xvm-tune-content-filter
description: Iteratively tune the X Viral Monitor content-filter rules against a fresh tweet-sample dump (typically `D:\Downloads\剪贴板文本 (N).txt`). Use this whenever the user pastes a clipboard sample file path and says any of "补充规则 / 优化规则 / 还有遗漏 / 没命中 / 未命中 / 漏了 / 误屏蔽 / 过滤错了 / 这个推文没被过滤 / 这个 bio 漏了 / 黄推广告 / 审查规则". Also use when the user quotes a single offending tweet text and asks to make it caught, or when they say a previously-shipped rule overshoots and hides legitimate replies. This skill drives the full loop: probe → diff → add/tighten regex → vitest + negatives → build → sanitize → commit → push so the remote rules pickup is queued.
---

# X Viral Monitor — content-filter rule tuning

Goal: take a fresh sample of X tweets the user dropped in (usually a clipboard JSON fragment), find spam the current rules miss or normal replies the rules hide by mistake, ship a tight regex update, and push so all users get the new ruleset within the 6h remote-TTL.

Stop and ask the user before shipping if you can't decide whether something is spam — context (which thread the sample came from, which side errs cheaper for the user) is judgement-only.

## The loop

1. **Probe the sample** with the bundled script. It prints per-reply HIDE/PASS/MISS and per-author HIDE/MISS so you immediately see what slipped through.
   ```bash
   node .claude/skills/xvm-tune-content-filter/scripts/probe.mjs "<sample-path>"
   ```
   The script extracts every `"full_text"` reply and every `(screen_name, name, description, location)` tuple from the dump (raw JSON regex extraction — works on partial JSON fragments from clipboard pastes), then runs each through the current `src/premium/content-filter/filter.js` + `rules.json` via `vm.runInNewContext`.

   Output legend:
   - 🔴 = HIDE, with the rule id(s) that fired
   - 🟢 = PASS (and the heuristic doesn't flag it — likely benign)
   - ⚠️ MISS = PASS but heuristic flags spammy keywords → **this is the work list**

2. **Pick targets** from the MISS list. Often a single new spam template family appears multiple times; one well-shaped regex addition catches all of them. Don't treat each MISS as a separate fix.

3. **Write or extend regex** in `src/premium/content-filter/rules.json`. Choose between extending an existing rule's union vs. adding a new `id`:
   - Extend an existing rule when the new template is the same severity + field as one already there (e.g., new content-spam phrase → grow `adult-content-page-funnel-high`).
   - Add a new rule when the field differs (bio vs content), or when the semantics are distinct enough you want to debug them separately later.

   When adding a new rule, also append the new id to the `levels.standard` AND `levels.strict` arrays (level membership is what activates a rule — the rule definition alone is dormant).

4. **Verify against positive + negative** test phrases via a probe one-liner before any other change:
   ```bash
   node -e "
   const fs=require('fs'); const vm=require('vm');
   const rules=JSON.parse(fs.readFileSync('src/premium/content-filter/rules.json','utf8'));
   const filterJs=fs.readFileSync('src/premium/content-filter/filter.js','utf8');
   const win={location:{pathname:'/x/status/1'},addEventListener(){},postMessage(){},__xvmContentFilterBuiltinRules:rules,__xvmNet:{onResponse(){}},__xvmPro:{isFeatureEnabled:()=>true,onTierChange(){}}};
   const ctx={window:win,document:{documentElement:{appendChild(){}},getElementById:()=>null,createElement:()=>({id:'',style:{},dataset:{},appendChild(){},addEventListener(){}}),querySelector:()=>null,querySelectorAll:()=>[]},MutationObserver:class{observe(){}disconnect(){}},setTimeout,URL,console};
   vm.runInNewContext(filterJs,ctx);
   const api=win.__xvmContentFilter;
   api.updateSettings({enabled:true,level:'standard',whitelistFollowing:false});
   for (const [exp,c] of [
     ['HIDE','<positive-phrase>'],
     ['PASS','<negative-phrase>'],
   ]) {
     const r=api._debug.classify({id:'x',content:c,urls:[],author:{handle:'a',name:'N',bio:'',location:''}});
     const a=r.hide?'HIDE':'PASS';
     console.log((a===exp?'✓':'✗'),exp,a,c);
   }
   "
   ```
   Adjust regex until all positives HIDE and all negatives PASS.

5. **Sync the bundled fallback** so cold-start users (no remote cache yet) also get the new rules:
   ```bash
   node scripts/sync-rules.mjs
   ```
   This auto-regenerates `src/premium/content-filter/rules.js` from rules.json. `npm run build:dist` runs this hook automatically too, so step 7 covers it.

6. **Add vitest cases** to `tests/premium-content-filter.test.js` — one block per new rule with **3+ positives + 2+ negatives**, asserting `r.matches.some((m) => m.id === '<rule-id>')` for positives and `r.hide === false` for negatives. **Sanitize every fixture** before committing — see [Redaction rules](#redaction-rules) below.

7. **Build + test**:
   ```bash
   npm run build:dist && npm test
   ```
   Must be all-green before commit. If the new regex breaks an existing test, that's a signal the regex is too broad — tighten with co-occurrence, don't relax the test.

8. **Re-run the probe** to confirm 0 misses on the original sample:
   ```bash
   node .claude/skills/xvm-tune-content-filter/scripts/probe.mjs "<sample-path>"
   ```

9. **Commit + push** with a sanitized message — see [Commit hygiene](#commit-hygiene).

10. **Confirm the user can roll out the change**. New rules.json reaches users via three paths, in increasing latency:
    - Popup → 立即检查更新 button: ~immediate (forces an `XVM_CONTENT_FILTER_RULES_REFRESH` round-trip)
    - Tab reload or open new tab: next isolated.js boot fires `fetchRemoteContentFilterRules` if 5min retry floor has elapsed
    - Background: 6h TTL refresh

    If the change also modified `isolated.js`, `filter.js`, `bridge.js`, `content.js`, `popup-content-filter.js`, `styles.css`, etc. — i.e., anything in the extension bundle — the user must reload the extension in `chrome://extensions` for it to take effect. Tell them.

## Constraints to remember

### Regex length cap
`isolated.js` defines `REGEX_MAX_LEN = 400`. The sanitizer **rejects the entire remote payload** if any single regex source exceeds it. A previous round of additions silently broke a remote rollout because the `adult-content-page-funnel-high` union grew to 278 chars (was 240 cap → entire payload dropped → users on bundled fallback). Before any commit:

```bash
node -e "
const r=require('./src/premium/content-filter/rules.json');
for (const rule of r.rules) {
  if (rule.type !== 'regex') continue;
  const n = rule.value.length;
  console.log(n > 400 ? '✗ TOO LONG' : '·', n, rule.id);
}
"
```

If a rule is over budget, split it into two rules with the same `severity`/`field` rather than dropping coverage. The two rules will both be level-listed.

### Avoid catastrophic regex
The sanitizer also rejects nested unbounded quantifiers (heuristic `\([^()]*[+*][^()]*\)[+*?]`). Patterns like `(.+)+`, `(a*)*`, `(\w+)?+` are auto-rejected. Use bounded quantifiers (`{0,8}`, `.{0,40}`) — they're more readable AND faster.

### Co-occurrence is the cure for false-positives
Single keywords on a Chinese spam token list are almost guaranteed to false-positive. Examples from history:
- `福利` alone hid users whose bio said `福利鸭` (self-mockery). Fix: require `福利(资源|视频|姬|群|社群|社区|导航|频道)` co-occurrence.
- `中推` alone hid a normal bio saying `全中推最懂政治`. Fix: require `中推.{0,6}(资源|群|福利|频道|加我|私聊)`.
- `30+` alone hid `30+的人都在体制内工作`. Fix: require `30\+.{0,20}(sao|骚|涩|[反返]差)`.

When in doubt, look at the FIRST PASS the heuristic flags and ask: would a normal user (not in the spam pattern) say this exact substring? If yes, add a co-occurrence anchor.

### Both 反差 and 返差 (typo variant)
Spam accounts misspell intentionally to dodge naive filters. Use `[反返]差` (character class) to catch both. Same idea for `sao|骚`, `pP`, `vV微`.

### whitelistFollowing fires before any rule
`classify()` calls `isWhitelisted()` first. A followed account never matters how many rules match — they pass. So when designing new rules, optimize for **non-followed account precision** since followed users have a hard whitelist override.

### DOM-fallback gating
`extractDomTweet()` hardcodes `following: false` because the article DOM doesn't expose the follow relationship. `applyHidesNow` only lets dom-fallback decisions fire on `severity: 'block'` matches — `high`/`medium`/`low` wait for the GraphQL response. So new `high` rules are safe (won't false-hide followed users in the cold-start window); `block` rules need extra scrutiny.

## Rule cookbook

Severity choice:
- `block` — promoted ads, hard-blacklist handles, telegram-funnel hard heuristic. **Bypasses dom-fallback gate**, so reserved for ground-truth signals.
- `high` — adult-funnel templates, sao/涩 phrases, profile-pitch bios. The workhorse severity for new additions.
- `medium` — borderline marketing, generic 加群/合作微信. Only fires at `strict` level.
- `low` — soft signals like 黑丝/写真. Only at `strict`.

Field choice:
- `content` for reply text (what users typed)
- `bio` for `description` (most spam templates land here)
- `name` for display-name funnels (`互联网赚（点头像）` etc.)
- `location` for `location` (`小号已禁言` template)
- `url` for `urls` derived from entities + bio URLs
- `screen_name` rarely useful — handles are mostly random

Type choice:
- `regex` — 95% of the time
- `keyword` — case-insensitive substring; use only when you really mean a literal
- `domain` — for blocked link targets. Do not use URL-only `t.me` as a rule; Telegram links are too common for normal creators.
- `short-symbol` — the builtin emoji-grid heuristic (`isShortSymbolSpam`); don't try to redefine this via user-config

## Redaction rules

Test fixtures and commit messages must NEVER carry real user identity. The repo's commit history was rewritten once already to scrub `Gyro / SuisPasDaVinci / Eve小逸 / 蜜糖少女 / 欧海` references — don't recreate the problem.

For each fixture in `tests/premium-content-filter.test.js`:

| Field | Replace with |
|---|---|
| Real handle (`@RKinnear7273`, `@SuisPasDaVinci`) | `spam_<role>_<n>` or `normal_user` |
| Real display name (`Tiffiny Palo`, `蜜糖少女`) | `Sample User` / `某用户A` / `普通用户` |
| Real status URL | `/example_main/status/100001` |
| Real bio prose | Strip down to load-bearing spam keywords only |
| `@二号 mention` in spam content | `@example_alt` |

Keep the SPAM keywords (`🔞 性癖 全网仅此一号 盗图死全家 主页打✈️ 一至五线 免费约P` etc.) verbatim — those are the load-bearing tokens that test the rule. Strip everything else.

In commit messages:
- ❌ Don't reference specific sample numbers ("Sample 10 (long status thread) exposed...")
- ❌ Don't name real handles or display names
- ❌ Don't paste verbatim multi-line spam from the sample
- ✅ Describe the spam family generically ("new adult-funnel bio template family with `线下社交匹配` / `一至五线` / `免费约P` tokens")

## Commit hygiene

One commit per tuning round. Message template:

```
fix(xvm): <rule-family> coverage — <short paraphrase of pattern>

<Sample-anonymous description of what was missed. E.g., "A new
funnel template surfaced in the reply column for a popular thread;
4 variants share the bio pitch '全网[独首][创发家]线下社交匹配...'">

New / extended rule(s):
- adult-bio-offline-match-high — bio union with 线下社交匹配,
  一至五线, 免费约P, 附近速配, 资源牵线, 靠谱中介, "无 App + 中介".

Tests: N positives + M negatives in premium-content-filter.test.js
(<exact descriptions of what was added>). All-green.
```

After commit, push to `main` directly (this repo uses force-push history rewrites only when explicitly asked — normally just `git push origin main`).

## When the user reports "我点了'立即检查更新'但没生效"

Diagnostic order:

1. **Verify git push completed**: `git log --oneline -1` and `git rev-parse HEAD == origin/main`.
2. **Verify GitHub raw is fresh**: `curl -s https://raw.githubusercontent.com/Icy-Cat/x-viral-monitor/main/src/premium/content-filter/rules.json | grep <new-rule-id>`. CDN typically updates within 1-2 min of push.
3. **Verify payload validates**: run the regex length probe above. If any rule is over 400 chars, `isValidRulesPayload` rejects the whole payload and users silently fall back to the bundled rules.js — looks like the refresh "didn't work" because the new rule isn't there but the popup shows "已更新".
4. **Verify extension version**: if `isolated.js` or any extension bundle file changed since the user last reloaded, they need a fresh extension reload (the rules update flows hot, but extension code doesn't).

## Bundled probe

`scripts/probe.mjs` (in this skill directory) takes a sample path argument and dumps the full classification report. Run it from the repo root.

If a sample has a non-trivial number of replies (>30) the per-reply listing gets long. The bottom of the output is what matters — `Text misses: N` and `Bio misses: M`. Zero on both = job done.
