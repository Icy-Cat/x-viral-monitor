# Tampermonkey Leaderboard Parity Checklist

This document extracts the original extension leaderboard behavior from `dist/x-viral-monitor-v1.3.2/content.js` and `dist/x-viral-monitor-v1.3.2/styles.css` so the Tampermonkey version can be aligned step by step.

## Source Files

- Original behavior: `dist/x-viral-monitor-v1.3.2/content.js`
- Original styles: `dist/x-viral-monitor-v1.3.2/styles.css`
- Tampermonkey target: `dist/x-viral-monitor.user.js`

## Panel Structure

Original `ensureLeaderboard()` creates:

- Root: `.xvm-lb`
- Header: `.xvm-lb-head`
- Drag grip: `.xvm-lb-grip` with `⋮⋮`
- Title: `.xvm-lb-title`
- Back button: `.xvm-lb-back`, hidden until a leaderboard jump stores previous scroll
- List: `.xvm-lb-list`
- Resize handle: `.xvm-lb-resize`

Current Tampermonkey gaps:

- Has root/header/grip/title/back/list/resize handle.
- Has settings button/panel, which is Tampermonkey-specific.

## Panel Position And Size

Original defaults:

- Right: `16px`
- Top: `72px`
- Width: `280px`
- Min width: `240px`
- Max width: `640px`
- Position can switch from `right` anchoring to explicit `left/top` after dragging.
- Position and width are persisted through bridge messages:
  - `XVM_LB_POS_REQUEST`
  - `XVM_LB_POS_LOAD`
  - `XVM_LB_POS_SAVE`
  - `XVM_LB_SIZE_REQUEST`
  - `XVM_LB_SIZE_LOAD`
  - `XVM_LB_SIZE_SAVE`

Tampermonkey alignment target:

- Use localStorage instead of bridge messages.
- Persist `{ left, top }` after drag. Implemented with `settings.leaderboardPos`.
- Persist `width` after resize. Implemented with `settings.leaderboardWidth`.
- Clamp panel to viewport on drag, resize, and window resize. Implemented.

## Rows And Columns

Original defaults:

- `rank`: visible
- `icon`: visible
- `handle`: hidden
- `preview`: visible
- `views`: visible
- `velocity`: visible

Original row content:

- `.xvm-lb-rank`
- `.xvm-lb-icon`
- `.xvm-lb-preview`
- `.xvm-lb-views`
- `.xvm-lb-vel`

Original data source:

- `collectRanked()` only reads currently mounted `article[data-testid="tweet"]` nodes.
- It resolves ids through `getTweetIdFromArticle(article)`.
- It ignores cached tweets that are not represented by a mounted article.
- It sorts by computed velocity descending.

Tampermonkey alignment target:

- Keep mounted-article-only behavior.
- Keep default visible columns aligned.
- Expose optional columns in settings. Implemented with the original ids: `rank`, `icon`, `handle`, `preview`, `views`, `velocity`.

## Click And Jump Behavior

Original click behavior:

- Click leaderboard row.
- Resolve current entry from a fresh `collectRanked()` call.
- If entry article is not connected, do nothing.
- If clicking the currently linked row again, clear link.
- Save `window.scrollY` into `savedScrollY` only on the first jump.
- Show `.xvm-lb-back`.
- Scroll article into center with `{ behavior: 'smooth', block: 'center' }`.
- Call `setLink(id, li, entry.article)`.

Tampermonkey alignment target:

- Re-resolve article at click time instead of using stale closure data.
- Do not navigate to tweet detail as fallback for leaderboard clicks.
- Preserve original saved-scroll and back-button behavior.

## Link Geometry

Original `updateLinkGeometry()`:

- Re-resolves article each frame when current article node is missing or disconnected.
- Hides SVG when article cannot be found.
- Re-applies `.xvm-article-linked` to article because React may replace/strip classes.
- Uses `itemEl.getBoundingClientRect()`.
- Uses `article.getBoundingClientRect()`.
- Endpoint points to the article outer frame, not the badge or tweet text.
- Chooses item side based on article center vs item center:
  - If article is right of item, start from item right and end at article left.
  - If article is left of item, start from item left and end at article right.
- Article endpoint `endY` is clamped to the visible part of the article.
- Path is a cubic Bezier with horizontal handles:
  - Handle size: `Math.max(60, dx * 0.4)`
- Dot endpoints are positioned on the path start/end.

Tampermonkey alignment target:

- Keep article outer-frame endpoint.
- Keep original Bezier math.
- Keep SVG z-index below panel and above page content.
- Update link geometry on:
  - scroll capture
  - resize
  - drag movement. Implemented.
  - resize movement. Implemented.
  - leaderboard rerender when selected row DOM is replaced. Implemented.

## Link Clearing

Original behavior:

- `clearLink()` removes selected row class.
- Removes article highlight.
- Re-resolves stale article by tweet id and removes highlight.
- Removes SVG.
- Cancels pending link update rAF.
- Click outside row/article/panel clears link.
- `Escape` clears link.

Tampermonkey alignment target:

- Keep same clear triggers.
- Ensure any continuous follow loop is canceled on clear.

## Drag Behavior

Original behavior:

- Drag starts on `.xvm-lb-head`.
- Ignores non-left mouse button.
- Stores offset from pointer to panel.
- Uses rAF to flush drag updates.
- Clamps `left/top` to viewport.
- Sets `right = auto` after moving.
- Adds `.xvm-lb-dragging` during drag.
- Updates link geometry while dragging.
- Persists final position.

Tampermonkey alignment target:

- Keep current drag behavior. Implemented.
- Add missing position persistence. Implemented.
- Add `.xvm-lb-grip`. Implemented.

## Resize Behavior

Original behavior:

- Resize starts on `.xvm-lb-resize`.
- Uses rAF to flush width changes.
- Width is clamped by `LB_MIN_WIDTH`, `LB_MAX_WIDTH`, viewport width, and current left position.
- Adds `.xvm-lb-resizing` during resize.
- Updates link geometry while resizing.
- Persists final width.

Tampermonkey alignment target:

- Add resize handle. Implemented.
- Add width clamping. Implemented.
- Persist width in localStorage. Implemented.

## Rerender Timing

Original behavior:

- Leaderboard rerenders when settings change.
- Leaderboard rerenders periodically if enabled.
- Scroll refresh is throttled at 250ms to adapt to X virtualization.
- During rerender, if `linkState` exists:
  - Rebinds `linkState.itemEl` to the new `.xvm-lb-item`.
  - Re-adds selected class.
  - Clears link if linked row disappears.

Tampermonkey alignment target:

- Keep selected row rebinding.
- Keep scroll-triggered leaderboard refresh. Implemented with 250ms throttling.
- Avoid stale row click closures; use current id lookup.

## Style Details

Original style values to preserve:

- `.xvm-lb`: `width: 280px`, `right: 16px`, `top: 72px`, `border-radius: 14px`
- `.xvm-lb-list`: `max-height: 300px`
- `.xvm-lb-item`: `height: 28px`, `padding: 5px 12px`, `gap: 6px`
- `.xvm-lb-item-selected`: inset border and warm background
- `.xvm-article-linked`: `outline: 2px solid #bf5a2a`, `border-radius: 12px`
- Link path/dots:
  - Path stroke `#bf5a2a`
  - Path width `2`
  - Dot fill `#fff8f1`
  - Dot stroke `#bf5a2a`

## Step Plan

1. Restore link endpoint parity: article outer frame, original Bezier math. Done.
2. Fix stale click/row binding under X virtualization. Done.
3. Add drag-time and rerender-time link geometry updates. Done.
4. Add resize handle and width persistence. Done.
5. Add position persistence. Done.
6. Add scroll-throttled leaderboard refresh parity. Done.
7. Add configurable leaderboard fields. Done.
8. Add original grip and remaining small style differences. Grip done; remaining style differences require manual screenshot comparison.
9. Retest manually on X home and detail pages. Pending manual verification.
