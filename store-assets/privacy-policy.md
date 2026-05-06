# Privacy Policy — X Viral Monitor

**Last updated:** May 2026

## Summary
X Viral Monitor does **not** collect, store, or transmit any personal data or browsing data to external servers. All processing happens locally in your browser.

## What the extension accesses

- **X GraphQL API responses**: The extension hooks into the network calls that X's website already makes and reads tweet metrics (view counts, likes, retweets, replies, bookmarks, post timestamps) from those responses. No copies leave your browser.
- **X same-origin endpoints**: For the Star Chart and Grok Reply features, the extension calls X's own public endpoints (e.g. `grok.x.com`, X GraphQL) using your existing X session — the same way the X web app does. No third-party servers are contacted.
- **Page DOM on x.com / pro.x.com**: To render badges, the leaderboard, the enhanced photo viewer, and the Star Chart panel directly on the X interface.

## Local storage usage

- **chrome.storage.sync** (synced via your Google account): your trending/viral velocity thresholds, badge style, leaderboard column preferences, Grok prompt template, feature on/off toggles. Numeric and configuration values only — no tweet content, no personal data.
- **chrome.storage.local** (this device only): a small Star Chart query template cache (so the visualization keeps working when X rotates its API parameters) and short-lived Star Chart result caches.

## What the extension does NOT do

- Does not collect any personal information
- Does not track browsing history
- Does not contact any third-party server, analytics service, or telemetry endpoint
- Does not inject ads
- Does not access or store login credentials or passwords
- Does not share any data with anyone

## Open source

The full source code is publicly available at:
https://github.com/Icy-Cat/x-viral-monitor

## Contact

For questions about this privacy policy, please open an issue on the GitHub repository.
