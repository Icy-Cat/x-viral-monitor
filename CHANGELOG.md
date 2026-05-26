# Changelog

This project follows Keep a Changelog and Semantic Versioning.
本项目遵循 Keep a Changelog 与 Semantic Versioning。

---

## [1.7.2] - 2026-05-26

### Added

- Added Pro content filtering for adult, ad, phishing, and funnel replies with Light / Standard / Strict severity levels.
- Added local built-in rules plus user custom keyword / regex / domain rules, handle/domain whitelist support, and a filtered-replies summary strip on X pages.
- Added popup controls for content filter enablement, strength, rule counts, and custom rules.

### Internal

- Integrated the content filter into the existing premium gate, GraphQL response pipeline, and cross-filter hide-marker restore logic.

---

## [1.7.1] - 2026-05-24

### Fixed

- Switched XVM Pro license activation from the shared XMP Worker to an independent `xvm-license` Worker, fixing Chrome extension CORS failures during activation.
- Added Worker-signed ECDSA entitlement envelopes and client-side verification before storing or refreshing Pro license state.
- Made XVM product scoping fail closed: missing or non-XVM `product_id` now rejects the license and downgrades to Free.
- Pinned the license proxy URL to `https://xvm-license.lengkuxiaomao.workers.dev`.

### Internal

- Added independent Worker deployment config, XVM-only product whitelist, and local ignored secret helper files.
- Kept the existing $2.9/month and $29/year Creem checkout product IDs while the new pricing products are pending.

---

## [1.7.0] - 2026-05-20

### Added

- XVM Pro tier: Free / Trial / Pro states, a 14-day local trial, Creem-backed Pro license checks through a Cloudflare Worker proxy, and Trial/Pro-only feature gating.
- Hot-only filtering: hide low-velocity tweets using views-per-minute and absolute view thresholds, with separate short-post and long-article settings.
- Hot-only scope controls: Home, Lists, Profiles, and Tweet detail pages can be enabled independently from the popup.
- Floating leaderboard controls: compact Hot-only switch synced with the popup. Free or expired users see a disabled switch with a Pro badge; Trial/Pro users can toggle directly from X.

### Changed

- Popup filter controls now use consistent switch styling for binary feature toggles while preserving checkboxes for multi-select settings.
- The floating leaderboard's Hot-only switch was resized to match the header text scale.
- Short/Long rate-filter tabs now have a reliable selected state and keyboard focus styling.

### Security

- Pro license checks keep the Creem API key out of the extension package.

### Internal

- Added contract tests for Hot-only filtering, switch rendering, i18n lock-step, and dist sync.
- Synced source and `dist/` for the v1.7.0 extension package.

---

## [1.7.0] - 2026-05-20 (中文)

### 新增

- XVM Pro 套装: Free / Trial / Pro 三态、14 天本地试用、通过 Cloudflare Worker 代理 Creem license 校验, 并对 Trial/Pro 功能做统一 gating。
- 仅看热帖: 按 views/min + 总浏览量双阈值隐藏低流速推文, 短推和 X Article 长文可分开设置。
- 仅看热帖作用域: 首页、List、博主主页、推文详情页可在 popup 中独立开关。
- 悬浮流速榜控制: 在 X 页面悬浮面板中显示“仅看热帖”开关, 与 popup 双向同步。Free/过期用户显示灰色禁用 + Pro 角标, Trial/Pro 可直接切换。

### 变更

- popup 中二元功能控件统一为 switch, 多选设置继续保留 checkbox。
- 悬浮榜“仅看热帖”开关缩小到与标题文字更匹配。
- 流速过滤短推/长文 tab 补齐可靠选中态和键盘焦点样式。

### 安全

- Pro license 校验继续通过 Worker 代理, Creem API key 不进入扩展包。

### 内部

- 新增流速过滤、switch 渲染、i18n 与 dist sync 合同测试。
- 已同步 source 与 `dist/` 作为 v1.7.0 打包基础。

---

## [1.6.13] - 2026-05-19

### Fixed

- Fixed normal image zoom loss on multi-image tweets by making the image viewer active-swipe aware.
- Fixed the medium-tall image ratio gap after the long-image viewer threshold moved from 2.0 to 3.0.

### Internal

- Added active-swipe and threshold-sync contract tests.

---

## Earlier versions

See git tags for v1.6.x and v1.5.x releases.
