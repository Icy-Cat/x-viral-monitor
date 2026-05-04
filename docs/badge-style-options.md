# Badge Style Options

This document records the two inline velocity badge visual styles that should be kept available for future style switching.

## Style IDs

| Style ID | Name | Source | Intended use |
| --- | --- | --- | --- |
| `pill-solid` | Solid pill badge | `dist/x-viral-monitor.user.js` Tampermonkey prototype | Optional compact, high-contrast style. Keep as a selectable style because it is visually useful and liked during manual testing. |
| `inline-classic` | Classic inline text badge | `dist/x-viral-monitor-v1.3.2/styles.css` | Existing extension default style. Use as the baseline when matching the original UI. |

## Current New Style: `pill-solid`

Visual notes:

- Compact rounded pill.
- White text on solid tier background.
- Icon and velocity are rendered as separate pseudo-elements.
- More visible than the classic inline style.
- Good candidate for a "Pill" or "Solid" style option.

CSS snapshot:

```css
.xvm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  line-height: 16px;
  color: #fff;
  vertical-align: middle;
  cursor: default;
  user-select: none;
}

.xvm-badge::before {
  content: attr(data-prefix);
}

.xvm-badge::after {
  content: attr(data-velocity) "/h";
}

.xvm-badge--green {
  background: #16a34a;
}

.xvm-badge--orange {
  background: #ea580c;
}

.xvm-badge--red {
  background: #dc2626;
}
```

Tooltip CSS paired with this style:

```css
.xvm-tooltip {
  position: fixed;
  z-index: 2147483647;
  display: none;
  max-width: 260px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(15, 20, 25, 0.96);
  color: #fff;
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  white-space: pre-line;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  pointer-events: auto;
}
```

## Original Design Style: `inline-classic`

Visual notes:

- Inline text treatment that blends into the X metadata row.
- Tier state is expressed by text color instead of filled background.
- Hover state shifts the text color.
- Better when the badge should feel native and less visually dominant.

CSS snapshot:

```css
.xvm-badge {
  display: inline-flex;
  align-items: center;
  color: rgb(83, 100, 113);
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  padding: 0;
  margin-right: 4px;
  cursor: default;
  line-height: 20px;
  white-space: nowrap;
  transition: color 0.2s;
}

.xvm-badge::before {
  content: attr(data-prefix) " " attr(data-velocity) "/h";
}

.xvm-badge:hover {
  color: rgb(29, 155, 240);
}

.xvm-badge--green {
  color: #4caf50;
}

.xvm-badge--orange {
  color: #ff9800;
}

.xvm-badge--red {
  color: #f44336;
}

.xvm-badge--green:hover {
  color: #66bb6a;
}

.xvm-badge--orange:hover {
  color: #ffa726;
}

.xvm-badge--red:hover {
  color: #ef5350;
}
```

Tooltip CSS paired with this style:

```css
.xvm-tooltip {
  display: none;
  position: fixed;
  z-index: 2147483647;
  background: rgb(15, 20, 26);
  color: rgb(231, 233, 234);
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  white-space: pre-line;
  line-height: 1.6;
  min-width: 160px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
```

## Implementation Notes For Future Style Switching

- Add a setting such as `badgeStyle`, defaulting to `inline-classic` for extension parity.
- Keep `pill-solid` available as an alternate style.
- Apply the selected style by adding a root class, for example:
  - `xvm-style-inline-classic`
  - `xvm-style-pill-solid`
- Avoid changing metric calculation, tier thresholds, or tooltip content when switching styles.
- Keep the same tier classes:
  - `xvm-badge--green`
  - `xvm-badge--orange`
  - `xvm-badge--red`

