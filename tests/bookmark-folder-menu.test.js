import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const bridge = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const popupHtml = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const popupJs = readFileSync(resolve(repo, 'popup.js'), 'utf8');
const bookmarkMenu = readFileSync(resolve(repo, 'bookmark-menu.js'), 'utf8');
const styles = readFileSync(resolve(repo, 'styles.css'), 'utf8');
const enMessages = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
const zhMessages = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
const jaMessages = JSON.parse(readFileSync(resolve(repo, '_locales/ja/messages.json'), 'utf8'));
const buildScript = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');

describe('bookmark folder menu integration', () => {
  it('loads bookmark-menu.js in the MAIN-world content script bundle', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    expect(main, 'manifest must have a MAIN-world content_scripts entry').toBeTruthy();
    expect(main.js).toContain('bookmark-menu.js');
  });

  it('ships bookmark-menu.js in dist builds', () => {
    expect(buildScript).toContain("'bookmark-menu.js'");
  });

  it('wires the popup toggle to synced featureBookmarkFolders settings', () => {
    expect(popupHtml).toContain('id="feat-bookmark-folders"');
    expect(popupHtml).toContain('data-i18n="featureBookmarkFoldersTitle"');
    expect(popupJs).toContain("featureBookmarkFolders: false");
    expect(popupJs).toContain("document.getElementById('feat-bookmark-folders')");
    expect(popupJs).toContain('chrome.storage.sync.set({ featureBookmarkFolders: bookmarkFolderToggle.checked }');
  });

  it('bridges folder cache refreshes into the MAIN-world menu script', () => {
    expect(bridge).toContain('featureBookmarkFolders: false');
    expect(bridge).toContain('featureBookmarkFolders: !!raw?.featureBookmarkFolders');
    expect(bridge).toContain("type: 'XVM_FOLDERS_UPDATE'");
    expect(bridge).toContain("type === 'XVM_REQUEST_FOLDER_REFRESH'");
    expect(bridge).toContain('bookmarkFoldersCache');
    expect(bridge).toContain('BookmarkFoldersSlice');
    expect(bridge).toContain('changes.featureBookmarkFolders?.newValue === true');
  });

  it('requests initial settings and refreshes folders when enabled', () => {
    expect(bookmarkMenu).toContain("type: 'XVM_REQUEST_SETTINGS'");
    expect(bookmarkMenu).toContain("type: 'XVM_REQUEST_FOLDER_REFRESH'");
    expect(bookmarkMenu).toContain('requestSettings();');
    expect(bookmarkMenu).toContain('Loading bookmark folders');
    expect(bookmarkMenu).not.toContain('Open the extension popup to refresh');
  });

  it('localizes menu copy and does not render question-mark folder placeholders', () => {
    for (const key of [
      'contentBookmarkMenuInFolder',
      'contentBookmarkMenuChecking',
      'contentBookmarkMenuNewFolderPlaceholder',
    ]) {
      expect(bridge).toContain(`'${key}'`);
      expect(enMessages[key]?.message).toBeTruthy();
      expect(zhMessages[key]?.message).toBeTruthy();
      expect(jaMessages[key]?.message).toBeTruthy();
    }
    expect(bookmarkMenu).toContain('event.data.messages');
    expect(bookmarkMenu).not.toContain("unknown ? '?' : ''");
  });

  it('has dedicated dark-mode styles and custom scrollbar treatment', () => {
    expect(bookmarkMenu).toContain('detectPageTheme()');
    expect(bookmarkMenu).toContain('applyMenuTheme');
    expect(styles).toContain('.xvm-bk-menu[data-theme="dark"]');
    expect(styles).toContain('.xvm-bk-list::-webkit-scrollbar-button');
    expect(styles).toContain('scrollbar-color: var(--xvm-bk-scroll-thumb) transparent');
  });

  it('renders native-style folder rows with colored bookmark icons and chevrons', () => {
    expect(bookmarkMenu).toContain('FOLDER_COLORS');
    expect(bookmarkMenu).toContain('folderColor(f)');
    expect(bookmarkMenu).toContain('xvm-bk-folder-icon');
    expect(bookmarkMenu).toContain('xvm-bk-chevron');
    expect(styles).toContain('width: 292px');
    expect(styles).toContain('.xvm-bk-folder-icon');
    expect(styles).toContain('.xvm-bk-chevron');
  });

  it('floats the bookmark folder menu upward using measured height near the viewport bottom', () => {
    expect(bookmarkMenu).toContain('const MENU_MARGIN = 8');
    expect(bookmarkMenu).toContain('const menuHeight = m.offsetHeight || 320');
    expect(bookmarkMenu).toContain('window.innerHeight - menuHeight - MENU_MARGIN');
    expect(bookmarkMenu).not.toContain('window.innerHeight - 320');
    expect(bookmarkMenu).not.toContain('m.style.maxHeight');
  });

  it('dismisses the bookmark folder menu on outside pointerdown for mobile taps', () => {
    expect(bookmarkMenu).toContain("document.addEventListener('pointerdown'");
    expect(bookmarkMenu).toContain('hideMenuNow()');
    expect(bookmarkMenu).toContain('menuEl.contains(target) || findBookmarkBtn(target)');
    expect(bookmarkMenu).toContain('}, true);');
  });

  it('uses the canonical X operation name when removing a tweet from a bookmark folder', () => {
    expect(bookmarkMenu).toContain("removeTweetFromBookmarkFolder: { queryId: '2Qbj9XZvtUvyJB4gFwWfaA', operationName: 'RemoveTweetFromBookmarkFolder' }");
    expect(bookmarkMenu).toContain('operation?.operationName || op');
    expect(bookmarkMenu).toContain('bookmark_collection_id: id');
  });

  it('invalidates X bookmark folder pages after folder membership changes', () => {
    expect(bookmarkMenu).toContain("type: 'XVM_BOOKMARK_FOLDER_MUTATION'");
    expect(bookmarkMenu).toContain("type === 'XVM_BOOKMARK_FOLDER_DIRTY'");
    expect(bookmarkMenu).toContain('dirtyBookmarkFolderIds');
    expect(bookmarkMenu).toContain('window.location.assign(url.href)');
    expect(bridge).toContain("type === 'XVM_BOOKMARK_FOLDER_MUTATION'");
    expect(bridge).toContain('bookmarkFolderMutation');
  });
});
