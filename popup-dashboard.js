// === Tab router + toast + cross-script glue ===
//
// Tab layout (mock A, locked 2026-05-19 after 3rd UI pivot). Routes:
//   <button role="tab" data-tab="pro|filter|leaderboard|ai|about"> click
//     → body.dataset.tab = …
//     → CSS [data-tab-panel="…"][data-active="1"] shows the panel
//
// Also bridges:
//   - popup-pro.js renders into #xvm-pro-section (Pro tab) AND writes
//     body.dataset.tier so #tier-chip (header) recolors.
//   - "Activate existing license" link inside the Pro tab unhides the
//     inline #activate-inline form (popup-pro.js wires submit/cancel).
//   - Coming-soon stubs (lucide list inside Pro tab) are static — no
//     click handler (display only; M2 work item).

(() => {
  const TABS = ['pro', 'filter', 'leaderboard', 'ai', 'about'];
  const ACTIVE_TAB_KEY = 'xvm_popup_active_tab';

  // Critical bug fix (Codex polish item 3): the previous t(key) signature
  // didn't forward substitution args, so chrome.i18n.getMessage was always
  // called with no replacements — placeholders rendered as empty strings.
  // That's why "试用 · 还剩 天" showed up missing the days number.
  function t(key, ...subs) {
    try {
      const v = chrome?.i18n?.getMessage?.(key, subs.length ? subs.map(String) : undefined);
      if (v) return v;
    } catch (_) {}
    return key;
  }

  function isValidTab(name) {
    return TABS.includes(name);
  }

  function persistTab(name) {
    if (!isValidTab(name)) return;
    try { localStorage.setItem(ACTIVE_TAB_KEY, name); } catch (_) {}
    try { chrome.storage.local.set({ [ACTIVE_TAB_KEY]: name }); } catch (_) {}
  }

  function markTabReady() {
    document.body.dataset.tabReady = '1';
  }

  function readLocalTab() {
    try {
      const saved = localStorage.getItem(ACTIVE_TAB_KEY);
      return isValidTab(saved) ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function readHashTab() {
    try {
      const hash = String(location.hash || '').replace(/^#/, '');
      return isValidTab(hash) ? hash : null;
    } catch (_) {
      return null;
    }
  }

  function setTab(name, opts = {}) {
    if (!TABS.includes(name)) name = 'filter';
    const persist = opts.persist !== false;
    document.body.dataset.tab = name;
    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
    });
    document.querySelectorAll('[data-tab-panel]').forEach((p) => {
      p.dataset.active = (p.dataset.tabPanel === name) ? '1' : '0';
    });
    window.scrollTo(0, 0);
    if (persist) persistTab(name);
  }

  function loadInitialTab() {
    const hashTab = readHashTab();
    if (hashTab) {
      setTab(hashTab, { persist: true });
      markTabReady();
      return;
    }
    const localTab = readLocalTab();
    if (localTab) {
      setTab(localTab, { persist: false });
      markTabReady();
    }
    try {
      chrome.storage.local.get({ [ACTIVE_TAB_KEY]: 'filter' }, (items) => {
        const saved = items?.[ACTIVE_TAB_KEY];
        const next = isValidTab(saved) ? saved : 'filter';
        setTab(next, { persist: false });
        try { localStorage.setItem(ACTIVE_TAB_KEY, next); } catch (_) {}
        markTabReady();
      });
    } catch (_) {
      setTab('filter', { persist: false });
      markTabReady();
    }
  }

  function showToast(msg, ms = 2200) {
    const el = document.getElementById('xvm-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function wireTabButtons() {
    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });
    window.addEventListener('hashchange', () => {
      const hashTab = readHashTab();
      if (hashTab) setTab(hashTab);
    });
  }

  // popup-pro.js dispatches 'xvm-pro-nav' with { view: 'activate' } when
  // the "Activate existing license" link in the hero is clicked, or
  // { view: 'pro' } after a successful activation to return to Pro tab.
  function wireProNav() {
    window.addEventListener('xvm-pro-nav', (ev) => {
      const dest = ev?.detail?.view;
      if (dest === 'activate') {
        setTab('pro');
        const form = document.getElementById('activate-inline');
        if (form) form.hidden = false;
        const key = document.getElementById('activate-key');
        if (key) key.focus();
      } else if (dest === 'pro' || dest === 'dashboard') {
        setTab('pro');
        const form = document.getElementById('activate-inline');
        if (form) form.hidden = true;
      }
    });
  }

  // Activate-form cancel button collapses the inline activate panel.
  function wireActivateCancel() {
    const cancel = document.getElementById('activate-cancel');
    if (!cancel) return;
    cancel.addEventListener('click', () => {
      const form = document.getElementById('activate-inline');
      if (form) form.hidden = true;
    });
  }

  // Initial tier-chip text comes from popup-pro.js writing body.dataset.tier.
  // We mirror that into the #tier-chip label so it always reads the tier in
  // the user's locale.
  function syncTierChip() {
    const chip = document.getElementById('tier-chip');
    if (!chip) return;
    const refresh = () => {
      const tier = document.body.dataset.tier || 'free';
      let label, sub;
      if (document.body.dataset.buildChannel === 'community-dev') label = 'DEV';
      else if (tier === 'pro') label = t('chipTierPro');
      else if (tier === 'trial') label = t('chipTierTrial');
      else label = t('chipTierFree');
      // Trial: show days-left in chip if available via popup-pro state.
      // popup-pro.js stores it on window.__xvmProPopup; query optionally.
      if (tier === 'trial') {
        const days = window.__xvmProDays;
        if (days != null) sub = days === 1 ? t('chipTrialOne') : t('chipTrialDays', String(days));
      }
      chip.textContent = sub ? `${label} · ${sub}` : label;
    };
    refresh();
    new MutationObserver(refresh).observe(document.body, {
      attributes: true, attributeFilter: ['data-tier', 'data-build-channel'],
    });
    window.addEventListener('xvm-pro-days', refresh);
  }

  // === Theme toggle (3-state: light / dark / system; default system) ===
  //
  // Storage holds the USER PREFERENCE ('light' | 'dark' | 'system'); the
  // resolved theme that drives CSS (body.dataset.theme) is always 'light'
  // or 'dark'. When preference is 'system', we mirror
  // `prefers-color-scheme: dark`. Default preference is 'system' so a
  // fresh install matches the user's OS without any setup.
  //
  // The toggle button in the header rotates light → dark → system → light.
  // body.dataset.themePref carries the user-chosen preference (so the
  // toggle icon + About-tab label know which step we're at), while
  // body.dataset.theme always carries the *resolved* 'light' / 'dark'.
  const THEME_KEY = 'theme';
  const THEME_ORDER = ['light', 'dark', 'system'];
  const _mq = (typeof matchMedia === 'function')
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return (_mq && _mq.matches) ? 'dark' : 'light';
  }

  function applyTheme(pref) {
    const p = THEME_ORDER.includes(pref) ? pref : 'system';
    const resolved = resolveTheme(p);
    document.body.dataset.theme = resolved;
    document.body.dataset.themePref = p;
    const aboutBtn = document.getElementById('theme-toggle-about');
    if (aboutBtn) {
      const labelKey = p === 'system' ? 'themeFollowSystem'
                     : p === 'dark'   ? 'themeSwitchToLight'
                                      : 'themeSwitchToDark';
      aboutBtn.textContent = t(labelKey);
    }
  }
  function loadTheme() {
    try {
      chrome.storage.sync.get({ [THEME_KEY]: 'system' }, (items) => {
        applyTheme(items[THEME_KEY] || 'system');
      });
    } catch (_) { applyTheme('system'); }
  }
  function toggleTheme() {
    // light → dark → system → light
    const cur = document.body.dataset.themePref || 'system';
    const idx = THEME_ORDER.indexOf(cur);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    applyTheme(next);
    try { chrome.storage.sync.set({ [THEME_KEY]: next }); } catch (_) {}
  }
  function wireTheme() {
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('theme-toggle-about')?.addEventListener('click', toggleTheme);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && THEME_KEY in changes) applyTheme(changes[THEME_KEY].newValue);
      });
    } catch (_) {}
    // OS-level color-scheme changes only matter when pref === 'system'.
    if (_mq) {
      try {
        _mq.addEventListener('change', () => {
          if (document.body.dataset.themePref === 'system') {
            applyTheme('system');
          }
        });
      } catch (_) {}
    }
    loadTheme();
  }

  function currentExtensionVersion() {
    try { return chrome.runtime.getManifest().version || ''; } catch (_) { return ''; }
  }

  function renderPopupVersion() {
    const el = document.getElementById('popup-version');
    if (el) el.textContent = currentExtensionVersion();
  }

  function showReleaseNotesOnCurrentTab() {
    const version = currentExtensionVersion();
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (!tabId) {
          showToast(t('aboutShowUpdateNotesNoTab'));
          return;
        }
        chrome.tabs.sendMessage(tabId, {
          type: 'XVM_RELEASE_NOTES_SHOW_MANUAL',
          version,
        }, () => {
          const err = chrome.runtime.lastError;
          showToast(err ? t('aboutShowUpdateNotesNoTab') : t('aboutShowUpdateNotesSent'));
        });
      });
    } catch (_) {
      showToast(t('aboutShowUpdateNotesNoTab'));
    }
  }

  function wireReleaseNotesButton() {
    document.getElementById('show-update-notes')?.addEventListener('click', showReleaseNotesOnCurrentTab);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadInitialTab(); // default — Filter is the primary Pro feature surface
    renderPopupVersion();
    wireTabButtons();
    wireProNav();
    wireActivateCancel();
    syncTierChip();
    wireTheme();
    wireReleaseNotesButton();
  });

  window.__xvmTabs = { setTab, showToast, TABS, applyTheme, ACTIVE_TAB_KEY };
})();
