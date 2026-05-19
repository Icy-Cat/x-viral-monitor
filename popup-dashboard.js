// === Tab router + toast + cross-script glue ===
//
// Tab layout (mock A, locked 2026-05-19 after 3rd UI pivot). Routes:
//   <button role="tab" data-tab="pro|filter|leaderboard|about"> click
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
  const TABS = ['pro', 'filter', 'leaderboard', 'about'];

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

  function setTab(name) {
    if (!TABS.includes(name)) name = 'filter';
    document.body.dataset.tab = name;
    document.querySelectorAll('[role="tab"]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
    });
    document.querySelectorAll('[data-tab-panel]').forEach((p) => {
      p.dataset.active = (p.dataset.tabPanel === name) ? '1' : '0';
    });
    window.scrollTo(0, 0);
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
    document.querySelectorAll('[role="tab"]').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
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
      if (tier === 'pro') label = t('chipTierPro');
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
      attributes: true, attributeFilter: ['data-tier'],
    });
    window.addEventListener('xvm-pro-days', refresh);
  }

  // === Theme toggle (light warm default / dark slate) ===
  const THEME_KEY = 'theme';
  function applyTheme(name) {
    const safe = name === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = safe;
    const aboutBtn = document.getElementById('theme-toggle-about');
    if (aboutBtn) aboutBtn.textContent = t(safe === 'dark' ? 'themeSwitchToLight' : 'themeSwitchToDark');
  }
  function loadTheme() {
    try {
      chrome.storage.sync.get({ [THEME_KEY]: 'light' }, (items) => {
        applyTheme(items[THEME_KEY] || 'light');
      });
    } catch (_) { applyTheme('light'); }
  }
  function toggleTheme() {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
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
    loadTheme();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTab('filter'); // default — Filter is the primary Pro feature surface
    wireTabButtons();
    wireProNav();
    wireActivateCancel();
    syncTierChip();
    wireTheme();
  });

  window.__xvmTabs = { setTab, showToast, TABS, applyTheme };
})();
