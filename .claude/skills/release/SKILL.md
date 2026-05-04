---
name: release
description: "Automate Chrome extension release: bump patch version, package zip, generate patch, commit and push. Use this skill whenever the user says /release, 发版, 打包发布, 打包, bump version, 更新版本, or wants to package the extension for Chrome Web Store upload. Also use when the user asks to create a release zip or prepare a new version for submission."
---

# Release Workflow

Package the X Viral Monitor Chrome extension for release. This skill bumps the patch version, creates a zip for Chrome Web Store upload, generates a git format-patch, commits, and pushes.

## Steps

### 1. Bump version

Read the current version from `manifest.json` (field `"version"`). Increment the patch number (e.g., `1.6.1` → `1.6.2`). Also bump the userscript version in `userscript/x-viral-monitor.user.js` (the `@version` line) — keep major.minor in sync with the extension, so `0.1.1` → `0.1.2`.

Use the Edit tool to update both files. Do NOT change any other fields.

### 2. Package the zip

Create a zip file named `x-viral-monitor-v{VERSION}.zip` in the `release/` directory. The zip must contain only the extension source files needed for Chrome Web Store submission — no dev files, no release artifacts, no node_modules.

**Files to include:**
```
_locales/
icons/
lib/
bridge.js
content.js
manifest.json
popup.html
popup.js
starchart.js
styles.css
```

**Files to exclude** (do NOT include these):
```
node_modules/
release/
userscript/
scripts/
docs/
store-assets/
tests/
.github/
.claude/
.superpowers/
.playwright-mcp/
*.md
*.json (except manifest.json)
*.patch
*.zip
vitest.config.js
```

Use PowerShell `Compress-Archive` to create the zip:
```powershell
Compress-Archive -Path '_locales','bridge.js','content.js','icons','lib','manifest.json','popup.html','popup.js','starchart.js','styles.css' -DestinationPath 'release/x-viral-monitor-v{VERSION}.zip' -Force
```

### 3. Commit

Stage `manifest.json` and `userscript/x-viral-monitor.user.js`, then commit with message:
```
Bump version to v{VERSION}
```

### 4. Generate patch

Run `git format-patch -1 HEAD -o release/` to create a patch file in the release directory.

### 5. Push

Run `git push` to push to remote.

### 6. Report

Print a summary:
- New version number
- Zip file path and size
- Patch file path
- Remind the user to upload the zip at Chrome Web Store developer console

## Notes

- The `release/` directory is gitignored — zip and patch files won't be committed.
- If the user specifies a version explicitly (e.g., "/release 2.0.0"), use that instead of auto-incrementing.
- If there are uncommitted changes beyond the version bump, warn the user before proceeding.
