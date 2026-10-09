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

## Transaction signatures and readiness

- Use the active X webpack runtime to load the current `ondemand.s` chunk and
  initialize X's own transaction generator. Do not maintain a second copy of
  its obfuscated animation/fingerprint algorithm or assume a fixed hash length.
- The module ID is discovered from the loaded chunk. A changed/ambiguous module
  layout fails explicitly instead of selecting an arbitrary export.
- X removes its loading-animation SVGs after its first request. Restore only
  their geometry and CSS classes from the same-origin home response while
  priming a separate native generator; remove the temporary nodes and restore
  any original frame IDs/classes immediately afterward. The generator uses the
  running page's verification key, not the fresh home response's key.
- No `eval`, downloaded-code execution, new extension permission, or persistent
  signature storage is added. The current X loader loads X's own module.
- The WebSocket-based Grok UI does not need to emit a legacy request for this
  path to work. Captured legacy transaction IDs remain an optional fallback.
- **检查 Grok 就绪状态** runs in the active X tab. It checks the readable X
  session marker and builds a signature, without sending a chat. Its result
  explicitly says the generation endpoint was not verified; it is not an
  account-validity or Grok-entitlement check.
- AI error toasts display the original failure as text. They never send an
  automatic `hi` message or replace unrelated errors with “signature expired”.
