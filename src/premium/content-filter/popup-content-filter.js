// === Content filter settings (popup context) ===
//
// Owns chrome.storage.local.xvm_content_filter_v1. isolated.js forwards this
// value to the MAIN-world content filter.

(function () {
  const STORAGE_KEY = 'xvm_content_filter_v1';
  const DEFAULTS = {
    enabled: false,
    level: 'standard',
    customRules: [],
    whitelistHandles: [],
    whitelistDomains: [],
    whitelistFollowing: true,
    blacklistHandles: [],
  };
  const FIELDS = ['name', 'screen_name', 'bio', 'location', 'content', 'url'];
  const TYPES = ['keyword', 'regex', 'domain'];
  const SEVERITIES = ['low', 'medium', 'high', 'block'];

  function t(key, ...subs) {
    try {
      const v = chrome?.i18n?.getMessage?.(key, subs.length ? subs.map(String) : undefined);
      if (v) return v;
    } catch (_) {}
    return key;
  }

  function storageGet(key, fallback) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (o) => resolve(o?.[key] ?? fallback)); }
      catch (_) { resolve(fallback); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, resolve); }
      catch (_) { resolve(); }
    });
  }

  function normalize(raw) {
    const out = {
      ...DEFAULTS,
      customRules: [],
      whitelistHandles: [],
      whitelistDomains: [],
      whitelistFollowing: true,
      blacklistHandles: [],
    };
    if (!raw || typeof raw !== 'object') return out;
    out.enabled = raw.enabled === true;
    out.level = ['light', 'standard', 'strict'].includes(raw.level) ? raw.level : DEFAULTS.level;
    out.customRules = Array.isArray(raw.customRules) ? raw.customRules.map(normalizeRule).filter(Boolean) : [];
    out.whitelistHandles = normalizeList(raw.whitelistHandles);
    out.whitelistDomains = normalizeList(raw.whitelistDomains);
    out.whitelistFollowing = raw.whitelistFollowing !== false;
    out.blacklistHandles = normalizeList(raw.blacklistHandles).map((s) => s.replace(/^@+/, '').trim()).filter(Boolean);
    return out;
  }

  function normalizeList(v) {
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(/[\n,，\s]+/).map((s) => s.trim()).filter(Boolean);
    return [];
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const value = String(rule.value || '').trim();
    if (!value) return null;
    const type = TYPES.includes(rule.type) ? rule.type : 'keyword';
    return {
      id: String(rule.id || `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      type,
      field: FIELDS.includes(rule.field) ? rule.field : (type === 'domain' ? 'url' : 'content'),
      severity: SEVERITIES.includes(rule.severity) ? rule.severity : 'medium',
      value,
      source: 'custom',
    };
  }

  async function resolveTier() {
    const TL = globalThis.__xvmTierLogic;
    if (!TL) return { tier: 'free', daysLeft: 0, source: 'tier-logic-missing' };
    const lic = await storageGet('xvm_license_v1', null);
    const trial = await storageGet('xvm_trial_v1', null);
    return TL.resolveTierFrom(lic, trial, Date.now());
  }

  function builtinRules() {
    return globalThis.__xvmContentFilterBuiltinRules || { levels: { light: [], standard: [], strict: [] }, rules: [] };
  }

  function ruleCount(level) {
    const src = builtinRules();
    const ids = new Set(src.levels?.[level] || []);
    return (src.rules || []).filter((r) => ids.has(r.id)).length;
  }

  function buildSection() {
    const section = document.getElementById('content-filter-section');
    if (!section) return null;
    section.innerHTML = `
      <h2 class="cf-title" data-k="cfTitle"></h2>
      <p class="cf-locked-hint" id="cf-locked-hint" data-k="cfLockedHint" hidden></p>

      <label class="rf-toggle">
        <span data-k="cfEnabled"></span>
        <span class="switch">
          <input type="checkbox" id="cf-enabled" />
          <span class="slider"></span>
        </span>
      </label>

      <div class="cf-levels" role="radiogroup" aria-label="${t('cfLevel')}">
        <button type="button" class="cf-level" data-level="light"></button>
        <button type="button" class="cf-level" data-level="standard"></button>
        <button type="button" class="cf-level" data-level="strict"></button>
      </div>
      <p class="rf-rule-hint" id="cf-rule-count"></p>

      <details class="cf-custom">
        <summary data-k="cfCustomTitle"></summary>
        <div class="cf-add-grid">
          <select id="cf-type">${TYPES.map((v) => `<option value="${v}">${v}</option>`).join('')}</select>
          <select id="cf-field">${FIELDS.map((v) => `<option value="${v}">${v}</option>`).join('')}</select>
          <select id="cf-severity">${SEVERITIES.map((v) => `<option value="${v}">${v}</option>`).join('')}</select>
          <input id="cf-value" type="text" data-placeholder-k="cfValue" />
        </div>
        <button type="button" id="cf-add" class="rf-btn" data-k="cfAddRule"></button>
        <div id="cf-custom-list" class="cf-custom-list"></div>
        <label class="rf-scope-switch cf-following">
          <input type="checkbox" id="cf-whitelistFollowing" />
          <span data-k="cfWhitelistFollowing"></span>
        </label>
        <label class="rf-row cf-whitelist"><span data-k="cfWhitelistHandles"></span><input type="text" id="cf-whitelistHandles" /></label>
        <label class="rf-row cf-whitelist"><span data-k="cfBlacklistHandles"></span><input type="text" id="cf-blacklistHandles" /></label>
        <label class="rf-row cf-whitelist"><span data-k="cfWhitelistDomains"></span><input type="text" id="cf-whitelistDomains" /></label>
      </details>

      <p class="rf-rule-hint" data-k="cfRuleHint"></p>
      <div class="rf-actions">
        <button type="button" id="cf-save" class="rf-btn" data-k="rfSave"></button>
        <button type="button" id="cf-reset" class="rf-btn-ghost" data-k="rfReset"></button>
      </div>
      <div class="rf-msg" id="cf-msg"></div>
    `;
    section.querySelectorAll('[data-k]').forEach((el) => { el.textContent = t(el.dataset.k); });
    section.querySelectorAll('[data-placeholder-k]').forEach((el) => { el.placeholder = t(el.dataset.placeholderK); });
    section.querySelector('[data-level="light"]').textContent = `${t('cfLevelLight')} · ${ruleCount('light')}`;
    section.querySelector('[data-level="standard"]').textContent = `${t('cfLevelStandard')} · ${ruleCount('standard')}`;
    section.querySelector('[data-level="strict"]').textContent = `${t('cfLevelStrict')} · ${ruleCount('strict')}`;
    return section;
  }

  function applyTo(section, settings) {
    section.querySelector('#cf-enabled').checked = !!settings.enabled;
    section.querySelectorAll('[data-level]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.level === settings.level ? 'true' : 'false');
    });
    section.dataset.level = settings.level;
    section.querySelector('#cf-rule-count').textContent = t('cfRuleCounts', ruleCount(settings.level), settings.customRules.length);
    section.querySelector('#cf-whitelistFollowing').checked = settings.whitelistFollowing !== false;
    section.querySelector('#cf-whitelistHandles').value = settings.whitelistHandles.join(', ');
    section.querySelector('#cf-blacklistHandles').value = settings.blacklistHandles.join(', ');
    section.querySelector('#cf-whitelistDomains').value = settings.whitelistDomains.join(', ');
    renderCustomList(section, settings);
  }

  function readFrom(section, current) {
    return normalize({
      enabled: section.querySelector('#cf-enabled').checked,
      level: section.dataset.level || DEFAULTS.level,
      customRules: current.customRules,
      whitelistFollowing: section.querySelector('#cf-whitelistFollowing').checked,
      whitelistHandles: section.querySelector('#cf-whitelistHandles').value,
      blacklistHandles: section.querySelector('#cf-blacklistHandles').value,
      whitelistDomains: section.querySelector('#cf-whitelistDomains').value,
    });
  }

  function renderCustomList(section, settings) {
    const list = section.querySelector('#cf-custom-list');
    list.innerHTML = '';
    if (!settings.customRules.length) {
      list.innerHTML = `<p class="rf-rule-hint">${t('cfCustomEmpty')}</p>`;
      return;
    }
    settings.customRules.forEach((rule, idx) => {
      const row = document.createElement('div');
      row.className = 'cf-custom-row';
      row.innerHTML = `<span>${rule.type}/${rule.field}/${rule.severity}: ${escapeHtml(rule.value)}</span><button type="button" data-del="${idx}" aria-label="${t('cfDeleteRule')}">×</button>`;
      list.appendChild(row);
    });
  }

  function setLocked(section, locked) {
    section.dataset.locked = locked ? '1' : '0';
    section.querySelectorAll('input, button, select').forEach((el) => { el.disabled = !!locked; });
    const hint = section.querySelector('#cf-locked-hint');
    if (hint) hint.hidden = !locked;
  }

  function flash(section, key) {
    const msg = section.querySelector('#cf-msg');
    msg.textContent = t(key);
    msg.dataset.kind = 'ok';
    setTimeout(() => { msg.textContent = ''; delete msg.dataset.kind; }, 1500);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function mount() {
    const section = buildSection();
    if (!section) return;
    let settings = normalize(await storageGet(STORAGE_KEY, DEFAULTS));
    applyTo(section, settings);
    const { tier } = await resolveTier();
    setLocked(section, tier === 'free');

    section.querySelectorAll('[data-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        section.dataset.level = btn.dataset.level;
        settings = readFrom(section, settings);
        applyTo(section, settings);
      });
    });
    section.querySelector('#cf-add').addEventListener('click', () => {
      const rule = normalizeRule({
        type: section.querySelector('#cf-type').value,
        field: section.querySelector('#cf-field').value,
        severity: section.querySelector('#cf-severity').value,
        value: section.querySelector('#cf-value').value,
      });
      if (!rule) return;
      settings = readFrom(section, settings);
      settings.customRules.push(rule);
      section.querySelector('#cf-value').value = '';
      applyTo(section, settings);
    });
    section.querySelector('#cf-custom-list').addEventListener('click', (event) => {
      const idx = event.target?.dataset?.del;
      if (idx == null) return;
      settings = readFrom(section, settings);
      settings.customRules.splice(Number(idx), 1);
      applyTo(section, settings);
    });
    section.querySelector('#cf-save').addEventListener('click', async () => {
      settings = readFrom(section, settings);
      await storageSet({ [STORAGE_KEY]: settings });
      flash(section, 'rfSavedOk');
    });
    section.querySelector('#cf-reset').addEventListener('click', async () => {
      settings = normalize(DEFAULTS);
      await storageSet({ [STORAGE_KEY]: settings });
      applyTo(section, settings);
      flash(section, 'rfResetOk');
    });

    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        if ('xvm_license_v1' in changes || 'xvm_trial_v1' in changes) {
          const r = await resolveTier();
          setLocked(section, r.tier === 'free');
        }
        if (STORAGE_KEY in changes) {
          settings = normalize(changes[STORAGE_KEY].newValue);
          applyTo(section, settings);
        }
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', mount);
  window.__xvmContentFilterPopup = { STORAGE_KEY, DEFAULTS, mount, normalize };
})();
