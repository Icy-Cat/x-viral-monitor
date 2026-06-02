# X Viral Monitor

[English](README.en.md)

在 X (Twitter) 时间线上实时显示每条推文的**浏览量流速**，并附带一整套阅读 / 创作辅助工具。

[![Chrome Extension](https://img.shields.io/badge/Chrome-扩展-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-精简版-orange?logo=tampermonkey)](userscript/x-viral-monitor.user.js)
[![iOS Userscripts](https://img.shields.io/badge/iOS_Safari-Userscripts-lightgrey?logo=safari)](userscript/x-viral-monitor.mobile.user.js)

> 同一套核心逻辑覆盖 **Chrome 扩展 / Tampermonkey 油猴脚本 / iOS Safari Userscripts App / 安卓 Quetta App** 四种宿主环境，详见[安装](#安装)章节。

---

## 功能总览

| 功能 | 触发位置 | 说明 |
|---|---|---|
| 流速徽章 | 时间线每条推文 | 每小时浏览量（impression/h），胶囊或行内两种样式 |
| 流速排行榜 | 浮动面板（可拖拽） | 当前页面可见推文按流速排序，列可自定义 |
| 书签数显示 | 推文操作栏 | 时间线上书签按钮旁直接显示数字 |
| 图片查看增强 | X 原生灯箱 | 滚轮缩放、拖拽平移、双击切换；长图（h/w > 3）自动切到固定宽度纵向滚动 |
| 内容过滤 | 推文回复区 | 多级规则过滤 spam/色情/电报漏斗，**规则远程拉取**自动更新 |
| 流速过滤 | 时间线 | 按 views/min 阈值隐藏低流速推文，文章和短推文独立阈值 |
| AI 评论候选 | 回复框 ✦ 按钮 | 借用浏览器登录态的 X Grok，4 套提示词模板 + 文章长文模板 |
| Markdown 复制 | 分享菜单 | 把推文复制成 Markdown 格式 |
| 感谢星图 | 分享菜单 | 把转推/引用用户做成动画粒子可视化 |

---

## 开源与官方版本

本仓库包含 X Viral Monitor 的完整源码，包括 Pro 功能闸门和 license 逻辑。源码按 MIT 协议开放，你可以自行审计、修改和构建。

Chrome Web Store 版本是**官方发行版**：提供一键安装、自动更新、license 激活和维护支持。自行从 GitHub 构建或通过开发者模式加载的版本属于 community/self-built build，按 MIT 协议以 "as-is" 方式提供，不包含 Chrome Web Store 自动更新和官方支持承诺。

### 免费 / Pro 功能边界

| 免费功能 | Pro / 试用可用的进阶能力 |
|---|---|
| 流速徽章、流速排行榜、书签数显示 | 流速过滤：按 views/min 和总浏览量隐藏低流速推文 |
| 图片查看增强、长图阅读 | 短推文 / 长文独立阈值 |
| 内容过滤、远程规则更新、自定义规则 | Home / Lists / Profile / Tweet detail 分范围启用 |
| AI 评论候选、Markdown 复制、感谢星图 | 后续高级监控、通知和自动化能力 |

Pro License 只用于解锁官方版本里的 Pro 功能。客户端代码本身不是 DRM 边界；真正的付费价值来自官方构建、自动更新、License 服务、支持和持续维护。

---

## 流速分级

| 图标 | 颜色 | 流速 | 含义 |
|------|------|------|------|
| 🌱 | 绿色 | < 1,000/h | 正常 |
| 🚀 | 橙色 | 1,000 - 10,000/h | 有热度 |
| 🔥 | 红色 | ≥ 10,000/h | 爆帖 |

### 爆帖指数（悬浮卡内）

综合评分 0-100，基于四个加权维度：

| 维度 | 权重 | 满分条件 |
|------|------|----------|
| 流速 | 40% | 50,000/h |
| 互动率 | 25% | 10% |
| 转发比 | 20% | 转发/点赞 = 50% |
| 收藏比 | 15% | 收藏/点赞 = 30% |

---

## AI 评论生成（Grok）

在任意推文回复框右下会出现 **✦ AI 生成** 按钮，点击：

1. 弹出提示词模板选择（推文 / 文章自动判定，≥600 字走文章模板组）
2. 候选评论流式渲染（第一条出来就能选，不用等全部生成完）
3. 点中一条 → 直接填进 X 的回复编辑器，回复按钮自动激活

**完全不需要 API key 或登录第三方** —— 链路在你本机走，经由 X 已登录的 `x.com/i/grok` 入口，不经过任何外部服务。

支持嵌套场景：回复某条推文下的回复时，提示词会自动拼装「原推文 + 被回复内容」两层上下文。

模板可在扩展弹窗里编辑——**推文模板**和**文章模板**分开存储。`[推文内容]` 占位符会被替换成源推文文本；模板里没有这个占位符时，源文本自动前置追加。"Temporary chat" 模式可避免污染你的 Grok 对话历史。

---

## 内容过滤

针对 X 推文回复区的多级 spam / 色情 / 电报漏斗过滤，**完全本地运行**，不上传任何内容。

- 三档强度：**宽松 / 标准 / 严格**
- 三档严重度：`block` / `high` / `medium` / `low`
- 白名单（关注的人 / handle / 域名）+ 黑名单 handle
- 自定义规则类型：`keyword` / `regex` / `domain` / `short-symbol`
- 被隐藏的回复在主推文下方折叠为「已过滤 N 条 - XVM」面板，可展开查看

### 远程规则自动更新

规则源于本仓库 `src/premium/content-filter/rules.json`，扩展会：

1. **冷启动**使用打包内置的 `rules.js`（永远可用）
2. 后台从 `raw.githubusercontent.com` 拉取最新 `rules.json`（6 小时 TTL，缓存在 `chrome.storage.local`）
3. 拉取成功后**热替换**，无需 reload 扩展
4. 弹窗"过滤"Tab 内显示当前规则来源 + 上次更新时间，可点 **「立即检查更新」** 手动刷新

```
[GitHub raw rules.json]
   ↓ fetch (6h TTL, cached in chrome.storage)
[XVM_CONTENT_FILTER_RULES_UPDATE postMessage]
   ↓
[filter.js 热替换 + 重新分类]
```

发现新 spam 模式? 提 PR 改 `rules.json`，合并到 main 后 6 小时内所有用户自动拿到。

---

## 安装

### Chrome / Edge 扩展（推荐）

**Chrome 应用商店：**
[安装 X Viral Monitor](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)

**手动安装（最新未上架版本）：**

1. 从 [Releases](../../releases) 页面下载最新版本的 zip
2. 解压
3. 打开 Chrome，访问 `chrome://extensions/`
4. 右上角打开**开发者模式**
5. 左上角点**加载已解压的扩展程序**
6. 选择解压后的文件夹

### 油猴脚本 / Tampermonkey（桌面精简版）

只想要徽章 + 排行榜，不要 Pro 功能？使用独立油猴脚本：

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 打开 [`userscript/x-viral-monitor.user.js`](userscript/x-viral-monitor.user.js)，点 "Raw" 安装
3. 通过 Tampermonkey 菜单打开设置面板

### 安卓 — Quetta + 油猴脚本

安卓 Chrome 不支持扩展，但 [**Quetta**](https://quetta.net/) 浏览器原生支持 Tampermonkey：

1. Play Store 或官网下载 Quetta App
2. 在 Quetta 内安装 Tampermonkey
3. 安装 [`userscript/x-viral-monitor.mobile.user.js`](userscript/x-viral-monitor.mobile.user.js)（移动版，启用 DOM fallback 兜底）

### iOS Safari — Userscripts App

iOS Safari 用户使用 [**Userscripts**](https://apps.apple.com/app/userscripts/id1463298887)（免费开源 App）：

1. App Store 搜索安装 "Userscripts" by Justin Wasack
2. 在 设置 → Safari → 扩展 中启用 Userscripts
3. 在 Userscripts App 内添加 [`userscript/x-viral-monitor.mobile.user.js`](userscript/x-viral-monitor.mobile.user.js)
4. 打开 x.com，Safari 地址栏左下角的 ⓂA 菜单 → Userscripts → 启用脚本

> 移动版油猴脚本默认不显示浮动排行榜面板（屏幕太小），只保留徽章。

---

## 工作原理

扩展通过 hook X 前端的 `fetch` / `XMLHttpRequest`，拦截 GraphQL API 响应，提取每条推文的指标数据（浏览量、点赞、转发、回复、收藏、发布时间）。计算平均流速（`总浏览量 / 发布至今小时数`），在推文操作按钮旁渲染内联标签。

未被初始拦截捕获的推文，会通过 TweetDetail API 逐条补充获取。

内容过滤工作在同一条 GraphQL 拦截链路上，从 `TweetDetail` / `HomeTimeline` 等响应里抽取每条 reply 的 author + content 字段做本地规则匹配，**不与服务器交互**。

油猴脚本和 iOS 移动版在没法 hook 网络时会启用 DOM fallback，从 article 节点直接抽取可见字段，精度略低但保证有徽章可看。

---

## 致谢

「感谢星图」功能改编自 [London-Chen/Thank-you-star-chart](https://github.com/London-Chen/Thank-you-star-chart)（MIT 协议）——
轨道动画的数学公式、侧边面板的布局、配色方案均移植自该项目。

---

## 项目结构

```
├── _locales/                  # 国际化（en / zh_CN / ja）
├── icons/                     # 扩展图标
├── lib/                       # 运行时库
│   ├── x-net-hook.js          # fetch/XHR 拦截
│   ├── grok-reply.js          # AI 评论候选
│   ├── image-viewer.js        # 增强图片查看器（zoom/pan）
│   └── long-image-viewer.js   # 长图阅读模式
├── src/premium/               # Pro 闸门 + 高级功能
│   ├── license/               # 试用 / 激活 / tier 路由
│   ├── content-filter/        # 内容过滤（免费，远程规则）
│   └── rate-filter/           # 流速过滤（Pro）
├── userscript/                # 油猴脚本（桌面 + 移动 + debug）
├── scripts/                   # 构建/同步脚本
├── tests/                     # vitest 测试
├── bridge.js                  # 扩展 ↔ 页面通信桥
├── content.js                 # 主内容脚本（MAIN world）
├── popup.html / popup.js      # 扩展弹窗设置界面
├── starchart.js               # 感谢星图模块
├── styles.css                 # 注入页面的样式
└── manifest.json              # Chrome 扩展清单
```

---

## 开发

```bash
npm install
npm test            # vitest run
npm run build:dist  # 同步 rules.js + 输出到 dist/
npm run sync:rules  # 只同步 rules.json → rules.js
```

`dist/` 用于 `chrome://extensions/` 的"加载已解压"入口，改完源码运行 `npm run build:dist` 后到扩展页面点 🔄 即可。

---

## 许可证

MIT. See [LICENSE](LICENSE).
