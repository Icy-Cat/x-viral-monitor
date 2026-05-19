# 部署 xvm-license Worker（5 分钟）

XVM Pro 走 Cloudflare Worker 当 Creem 代理——把 `x-api-key` 留在 Worker 端，**不漏到扩展包**。免费档每天 100k 请求够用。

ADR-0004 边界：extension/代码内不含任何 server-side secret，secret 永远只在你的 Worker env 里。

## 方法 A：网页 dashboard（推荐，零命令行）

1. 登录 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create**
2. 选 **Hello World** template → 起名 `xvm-license` → **Deploy**
3. 部署完成 → 点 **Edit code** → **删光默认代码**，把 `worker/license-proxy.js` 全文粘贴进去 → **Save and Deploy**
4. 回到 Worker 详情页 → **Settings** → **Variables and Secrets** → **Add variable**

   | Variable name        | Type      | Value                                                          |
   |----------------------|-----------|----------------------------------------------------------------|
   | `CREEM_API_KEY`      | **Secret** ✅ | 你的 Creem API key（`creem_live_xxx` for live, `creem_test_xxx` for test） |
   | `CREEM_PRODUCT_IDS`  | Plain     | `prod_7f7t9EHK3RJlOK37DWr7J,prod_69yTiXGXb04DKm46DNVbN9` （Monthly + Annual，逗号分隔无空格）|
   | `ALLOWED_ORIGIN`     | Plain     | `*` （测试用，上线前改成 `chrome-extension://YOUR_EXT_ID`）   |

   `CREEM_API_KEY` 的 Type 一定要选 **Secret**（点 Encrypt），别让任何人能看到值。

5. **Save** → 回到 Worker 顶部，复制 **Workers Routes** 里的 URL，形如：
   ```
   https://xvm-license.YOUR-SUBDOMAIN.workers.dev
   ```

6. 把这个 URL 发给我（@Coder），我用 `node build.mjs` 或 sed 把 `src/premium/license/client.js` 的 `__XVM_LICENSE_WORKER__` 占位替换掉。

## 方法 B：命令行（wrangler，更专业）

```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy license-proxy.js --name xvm-license

# 设置 secrets
wrangler secret put CREEM_API_KEY      # 粘贴你的 creem_live_xxx (live) 或 creem_test_xxx
# CREEM_PRODUCT_IDS / ALLOWED_ORIGIN 走普通 vars，dashboard 加更方便
```

## 测试 Worker 是否工作

部署完成后跑（替换成你的 worker URL）：

```bash
curl -X POST https://xvm-license.YOUR-SUBDOMAIN.workers.dev/validate \
  -H "Content-Type: application/json" \
  -d '{"key":"any-fake-key","instance_id":"any"}'
```

预期：返回 JSON `{ "ok": false, "status": 404, "data": {...} }` —— Creem 拒绝了一个不存在的 key，**这正说明你的 Worker 通了**。如果返回 `{ "ok": false, "error": "upstream_unreachable" }` 或 401，说明 API key 没设对。

## 上线前清单

1. **生成 Live API key**（Creem dashboard → Settings → API Keys → 切到 Live mode）
2. **更新 Worker 的 `CREEM_API_KEY` Secret**（设为 `creem_live_xxx`）
3. **确认 `CREEM_PRODUCT_IDS`**：Live 模式下的 product ID 跟 Test 不同，需要重新填
4. **更新 popup 的 Payment URLs**：从 `creem.io/test/payment/...` 改成 `creem.io/payment/...`（去掉 `/test/`）
5. **收紧 `ALLOWED_ORIGIN`**：从 `*` 改成 `chrome-extension://YOUR_EXT_ID`（提交 Chrome Web Store 后会拿到 ext id）

## 跟 x-md-paste Worker 的差异

只有 1 处：`CREEM_PRODUCT_ID`（单值）→ `CREEM_PRODUCT_IDS`（逗号分隔白名单）。
- 单值的 `CREEM_PRODUCT_ID` 也保留向后兼容，但建议直接用复数版
- 这一改对应 XVM 有 Monthly + Annual 两个 product 的现实——一份 Worker 验两个产品的 license
