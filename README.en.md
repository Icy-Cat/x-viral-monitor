# X Viral Monitor

[中文说明](README.md)

Chrome extension that displays real-time impression velocity on every tweet in your X (Twitter) timeline.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)

## What it does

- Shows impression velocity (views/hour) on each tweet in your timeline
- Color-coded badges indicate traffic levels at a glance
- Hover tooltip with detailed metrics (views, likes, retweets, replies, bookmarks, viral score)
- Works across all timeline tabs (For You, Following, Lists, etc.)
- Floating **velocity leaderboard** — draggable panel ranking visible tweets by velocity (toggle in popup, off by default; columns are user-configurable)
- Copy any tweet as Markdown from the share menu
- Generate a Thank-You Star Chart for any tweet — animated visualization of every retweeter and quoter
- **AI reply generator** in the reply composer — invokes X's built-in Grok directly (no API key needed). 4 default prompt templates (default / short Chinese / sharp opinion / Tieba veteran tone); long-form posts auto-switch to a deeper-reasoning template set
- Supports English, Chinese, and Japanese

### Velocity Tiers

| Icon | Color | Velocity | Meaning |
|------|-------|----------|---------|
| 🌱 | Green | < 1,000/h | Normal |
| 🚀 | Orange | 1,000 - 10,000/h | Trending |
| 🔥 | Red | ≥ 10,000/h | Viral |

### AI reply generation (Grok)

A **✦ AI 生成** button appears in every reply composer. Click it to:

1. Pick a prompt template (tweets vs long-form articles auto-detected; ≥600 chars routes to the article template set)
2. Watch candidate replies stream in (you can pick the first one as soon as it appears, no need to wait for all 10)
3. Click any candidate → it's inserted into X's reply editor and the submit button activates

**No API key or third-party login required.** The extension piggybacks on the Grok session already in your X tab (`x.com/i/grok`); the entire request runs locally in your browser, no external service in the path.

Nested-reply aware: when replying to a comment underneath someone else's tweet, the prompt context is composed as 「original tweet + the reply being responded to」 so Grok sees the full conversation, not just an isolated comment.

Templates can be edited in the extension popup. **Tweet templates** and **article templates** are stored separately. The `[推文内容]` placeholder gets replaced with the source text; if your custom prompt has no placeholder, the source is prepended automatically.

## Install

**Recommended — Chrome Web Store:**
[Install X Viral Monitor](https://chromewebstore.google.com/detail/x-viral-monitor/dkplofpecmjmbhgjgleeflcnfgfkdfpd)

**Manual install (latest unpublished build):**

1. Download the latest release zip from [Releases](../../releases)
2. Unzip the downloaded file
3. Open Chrome and go to `chrome://extensions/`
4. Toggle **Developer mode** on (top right corner)
5. Click **Load unpacked** (top left)
6. Select the unzipped folder and confirm

## How it works

The extension intercepts X's GraphQL API responses to extract tweet metrics (views, likes, retweets, replies, bookmarks, post time). It calculates the average impression velocity (`total views / hours since posted`) and renders an inline badge next to each tweet's action buttons.

For tweets not captured by the initial intercept, it falls back to fetching individual tweet details via the TweetDetail API.

### Viral Score (shown in tooltip)

A composite 0-100 score based on four weighted dimensions:

| Dimension | Weight | Max condition |
|-----------|--------|---------------|
| Velocity | 40% | 50,000/h |
| Engagement rate | 25% | 10% |
| Retweet ratio | 20% | RT/Like = 50% |
| Bookmark ratio | 15% | Bookmark/Like = 30% |

## Acknowledgements

The Thank-You Star Chart visualization is adapted from
[London-Chen/Thank-you-star-chart](https://github.com/London-Chen/Thank-you-star-chart) (MIT License) —
orbital field math, side-panel layout, and color palette ported from that project.

## License

MIT
