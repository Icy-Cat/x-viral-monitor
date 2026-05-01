# Grok Reply Generator

## Scope

- Entry point: add an `AI 生成` button inside X reply composers only.
- Source tweet: prefer the cached tweet data collected for badges/GraphQL; fall back to the visible tweet DOM only if cache is unavailable.
- Prompt templates: support multiple user-defined templates in the extension popup. Each template may use `[推文内容]` as the source tweet placeholder.
- Default template:

```text
[推文内容]

为我生成针对该推文的10条评论,每条评论用代码块包裹
```

- Grok request: use the built-in Grok web endpoint and payload shape. Runtime auth headers come from the active X session.
- Grok mode: match the X web "快速" mode, currently `grokModelOptionId: "grok-3-latest"` with `modelMode: "MODEL_MODE_FAST"`.
- Result UI: after generation, show an Options panel containing the generated comments. Clicking an option fills the active reply input.

## Non-goals

- Do not bundle Playwright or bb-browser into the extension.
- Do not require users to manually capture a Grok payload before first use.
- Do not add the `AI 生成` button to the main compose box.
