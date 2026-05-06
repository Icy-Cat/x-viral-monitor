# Chrome Web Store - 隐私权 (Privacy)

> 编辑页面: https://chrome.google.com/webstore/devconsole/ea0eccb4-2164-4994-a688-53acfdb73acc/dkplofpecmjmbhgjgleeflcnfgfkdfpd/edit/privacy

## 单一用途说明 (Single Purpose)

```
Augment the X (Twitter) timeline reading and engagement experience: surface tweet impression velocity as inline badges, improve in-page media viewing (including long screenshots), and provide local helper tools (copy-as-Markdown, supporter visualization, Grok reply drafting) that operate solely on the X page the user is currently viewing.
```

## 权限说明

### 需请求 storage 的理由 (justification for `storage`)

```
chrome.storage is used to persist user preferences and cache data locally in the browser. Specifically:

• chrome.storage.sync — user-configurable thresholds (Trending / Viral views-per-hour), badge style, leaderboard column order, Grok prompt template, feature on/off toggles. These follow the user across devices.

• chrome.storage.local — Star Chart query template cache (so the visualization survives X's API rotations) and short-lived Star Chart result cache. Local-only; never synced or transmitted.

No personal data, browsing history, or tweet content is stored. Only user settings and X API metadata.
```

### 需请求主机权限的理由 (justification for host access)

```
The extension declares content scripts on https://x.com/* and https://pro.x.com/* (no other host_permissions). It needs to run on those pages to:

(1) Hook the page's existing fetch/XHR calls so it can read tweet metrics (views, likes, retweets) from X's GraphQL responses already arriving for the timeline.

(2) Render velocity badges, the hot-on-page leaderboard, the enhanced photo/long-image viewer, and the Star Chart panel directly on the X DOM.

(3) Call X's same-origin endpoints (e.g., grok.x.com for the Grok reply feature, X GraphQL for the Star Chart) — same endpoints the X web app itself uses, called from the same origin with the user's existing session.

The extension does NOT contact any third-party server, analytics service, or telemetry endpoint. All network traffic is between the user's browser and X.
```

## 远程代码

- **是否使用远程代码**: 否
- 所有 JavaScript 在打包内随扩展一同分发；扩展不通过 `eval` / 远程脚本注入等方式加载外部代码。

## 数据使用声明 - 收集的数据类型

以下数据类型均**未勾选**（不收集、不上传）：

- [ ] 个人身份信息
- [ ] 健康信息
- [ ] 财务和付款信息
- [ ] 身份验证信息
- [ ] 个人通讯
- [ ] 位置
- [ ] 网络记录
- [ ] 用户活动
- [ ] 网站内容

> 说明：扩展确实**读取** X 页面上的推文指标（views/likes/RT 等）和 Star Chart 的转发者公开列表，但这些数据仅在用户本地浏览器中处理与展示，从不离开用户设备，因此不构成 Chrome Web Store 隐私表中定义的"收集"。

## 数据使用声明 - 合规承诺

以下三项均**已勾选**：

- [x] 我不会出于已获批准的用途之外的用途向第三方出售或传输用户数据
- [x] 我不会为实现与我的产品的单一用途无关的目的而使用或转移用户数据
- [x] 我不会为确定信用度或实现贷款而使用或转移用户数据

## 隐私权政策网址

```
https://github.com/Icy-Cat/x-viral-monitor/blob/main/store-assets/privacy-policy.md
```

> 当前 `store-assets/privacy-policy.md` 仍是旧版本（只描述了徽章功能），需要同步更新到反映 Star Chart / Grok / 图片查看器等新功能。或者改用一个独立托管的页面 URL。
