# X Viral Monitor

Chrome extension that displays real-time impression velocity on every tweet in your X (Twitter) timeline.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)

## What it does

- Shows impression velocity (views/hour) on each tweet in your timeline
- Color-coded badges indicate traffic levels at a glance
- Hover tooltip with detailed metrics (views, likes, retweets, replies, bookmarks, viral score)
- Works across all timeline tabs (For You, Following, Lists, etc.)
- Supports English, Chinese, and Japanese

### Velocity Tiers

| Icon | Color | Velocity | Meaning |
|------|-------|----------|---------|
| 🌱 | Green | < 1,000/h | Normal |
| 🚀 | Orange | 1,000 - 10,000/h | Trending |
| 🔥 | Red | ≥ 10,000/h | Viral |

## Install

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

## License

MIT
