// === Rate filter settings (popup context) ===
//
// Renders the rate-filter settings form below the Pro tier banner. Owns
// chrome.storage.local.xvm_rate_filter_v1; isolated.js watches that key
// and pushes XVM_RATE_SETTINGS_UPDATE to MAIN-world filter.js.
//
// Tier-aware: when getCurrentTier() ∈ {trial, pro} the form is editable;
// when 'free' the form is shown but disabled with an "upgrade to unlock"
// hint above it. Settings persist across tier changes so a user who
// upgrades sees their previous configuration restored.

(function () {
  const STORAGE_KEY = 'xvm_rate_filter_v1';

  const DEFAULTS = {
    enabled: false,
    shortRateThreshold: 1000,
    shortAbsoluteThreshold: 10000,
    longRateThreshold: 1000,
    longAbsoluteThreshold: 10000,
    // The floating leaderboard owns the global enabled switch. Popup and
    // floating settings can both edit these scope flags.
    scopeHome: false,
    scopeList: false,
    scopeProfile: false,
    scopeStatus: false,
  };

  const BOOL_KEYS = ['scopeHome', 'scopeList', 'scopeProfile', 'scopeStatus'];
  const NUM_KEYS  = ['shortRateThreshold', 'shortAbsoluteThreshold',
                     'longRateThreshold',  'longAbsoluteThreshold'];

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
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    // Legacy migration: pre-scope-flag-redesign storage had a master
    // `enabled` toggle. If it was false AND the user never explicitly
    // opted into a scope after migration, fall back to all scopes off.
    const legacyDisabled = raw.enabled === false && !raw.__scopeMigratedV2;
    if ('enabled' in raw) out.enabled = raw.enabled === true;
    for (const k of BOOL_KEYS) {
      if (legacyDisabled) { out[k] = false; continue; }
      if (k in raw) out[k] = raw[k] !== false;
    }
    for (const k of NUM_KEYS) {
      const v = Number(raw[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k];
    }
    return out;
  }

  // Resolve tier independently (popup-pro.js already uses tier-logic.js for
  // banner; we can read again — cheap, and avoids cross-script coupling).
  async function resolveTier() {
    const TL = globalThis.__xvmTierLogic;
    if (!TL) return { tier: 'free', daysLeft: 0, source: 'tier-logic-missing' };
    const lic = await storageGet('xvm_license_v1', null);
    const trial = await storageGet('xvm_trial_v1', null);
    return TL.resolveTierFrom(lic, trial, Date.now());
  }

  function buildSection() {
    const section = document.getElementById('rate-filter-section');
    if (!section) return null;
    // mock A layout:
    //   header (icon + title)
    //   Enable toggle (full row, switch on right)
    //   Sub-tab card (Short / Long, underline-style sub-tabs + threshold inputs)
    //   Scope switches (Home / Lists / Profile / Tweet detail)
    //   Save (primary, full width) + Reset (ghost link below)
    section.innerHTML = `
      <h2 class="rf-title" data-k="rfTitle"></h2>
      <p class="rf-locked-hint" id="rf-locked-hint" data-k="rfLockedHint" hidden></p>

      <div class="rf-subcard">
        <div class="sub-tabbar" role="tablist">
          <button type="button" class="sub-tab-btn" role="tab" data-sub-tab="short" aria-selected="true"  data-k="rfSubShort"></button>
          <button type="button" class="sub-tab-btn" role="tab" data-sub-tab="long"  aria-selected="false" data-k="rfSubLong"></button>
        </div>
        <div data-sub-panel="short" data-active="1">
          <fieldset class="rf-fieldset">
            <label class="rf-row"><span data-k="rfRatePerMin"></span>    <input type="number" id="rf-shortRateThreshold"     min="0" step="1"   /></label>
            <label class="rf-row"><span data-k="rfAbsoluteViews"></span> <input type="number" id="rf-shortAbsoluteThreshold" min="0" step="100" /></label>
          </fieldset>
        </div>
        <div data-sub-panel="long">
          <fieldset class="rf-fieldset">
            <label class="rf-row"><span data-k="rfRatePerMin"></span>    <input type="number" id="rf-longRateThreshold"     min="0" step="1"   /></label>
            <label class="rf-row"><span data-k="rfAbsoluteViews"></span> <input type="number" id="rf-longAbsoluteThreshold" min="0" step="100" /></label>
          </fieldset>
        </div>
      </div>

      <div class="rf-scope" role="group" aria-label="${t('rfScopeLegend')}">
        <div class="rf-scope-title" data-k="rfScopeLegend"></div>
        <label class="rf-scope-switch">
          <span data-k="rfScopeHome"></span>
          <span class="switch"><input type="checkbox" id="rf-scopeHome" /><span class="slider"></span></span>
        </label>
        <label class="rf-scope-switch">
          <span data-k="rfScopeList"></span>
          <span class="switch"><input type="checkbox" id="rf-scopeList" /><span class="slider"></span></span>
        </label>
        <label class="rf-scope-switch">
          <span data-k="rfScopeProfile"></span>
          <span class="switch"><input type="checkbox" id="rf-scopeProfile" /><span class="slider"></span></span>
        </label>
        <label class="rf-scope-switch">
          <span data-k="rfScopeStatus"></span>
          <span class="switch"><input type="checkbox" id="rf-scopeStatus" /><span class="slider"></span></span>
        </label>
      </div>

      <p class="rf-rule-hint" data-k="rfRuleHint"></p>

      <div class="rf-actions">
        <button type="button" id="rf-reset" class="rf-btn-ghost" data-k="rfReset"></button>
      </div>
      <div class="rf-msg" id="rf-msg"></div>
    `;
    section.querySelectorAll('[data-k]').forEach((el) => { el.textContent = t(el.dataset.k); });

    // Sub-tab switching (Short / Long).
    // Codex bb-browser caught aria-selected staying stale after click in the
    // dataset.* form; switching to getAttribute for the comparison + an
    // explicit 'true'/'false' literal makes the wiring bulletproof. Same
    // pattern for the panel data-active flip.
    section.querySelectorAll('[data-sub-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-sub-tab');
        section.querySelectorAll('[data-sub-tab]').forEach((b) => {
          const matches = b.getAttribute('data-sub-tab') === target;
          b.setAttribute('aria-selected', matches ? 'true' : 'false');
        });
        section.querySelectorAll('[data-sub-panel]').forEach((p) => {
          p.setAttribute('data-active', p.getAttribute('data-sub-panel') === target ? '1' : '0');
        });
      });
    });

    return section;
  }

  function applyTo(section, settings) {
    for (const k of BOOL_KEYS) section.querySelector('#rf-' + k).checked = !!settings[k];
    for (const k of NUM_KEYS)  section.querySelector('#rf-' + k).value   = settings[k];
  }
  function readFrom(section, base = DEFAULTS) {
    const out = { ...base, __scopeMigratedV2: true };
    for (const k of BOOL_KEYS) out[k] = section.querySelector('#rf-' + k).checked;
    for (const k of NUM_KEYS)  {
      const v = Number(section.querySelector('#rf-' + k).value);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k];
    }
    return out;
  }

  function setLocked(section, locked) {
    section.dataset.locked = locked ? '1' : '0';
    const inputs = section.querySelectorAll('input, button');
    for (const el of inputs) el.disabled = !!locked;
    const hint = section.querySelector('#rf-locked-hint');
    if (hint) hint.hidden = !locked;
  }

  async function mount() {
    const section = buildSection();
    if (!section) return;

    let currentSettings = normalize(await storageGet(STORAGE_KEY, DEFAULTS));
    applyTo(section, currentSettings);

    const { tier } = await resolveTier();
    setLocked(section, tier === 'free');

    // Debounced auto-save on any input mutation.
    let saveTimer = null;
    function scheduleAutoSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        saveTimer = null;
        const payload = readFrom(section, currentSettings);
        currentSettings = normalize(payload);
        await storageSet({ [STORAGE_KEY]: payload });
        const msg = section.querySelector('#rf-msg');
        msg.textContent = t('cfAutoSaved');
        msg.dataset.kind = 'ok';
        setTimeout(() => { msg.textContent = ''; delete msg.dataset.kind; }, 1500);
      }, 300);
    }
    section.querySelectorAll('input').forEach((el) => {
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, scheduleAutoSave);
    });

    section.querySelector('#rf-reset').addEventListener('click', async () => {
      applyTo(section, DEFAULTS);
      currentSettings = { ...DEFAULTS };
      await storageSet({ [STORAGE_KEY]: DEFAULTS });
      const msg = section.querySelector('#rf-msg');
      msg.textContent = t('rfResetOk');
      msg.dataset.kind = 'ok';
      setTimeout(() => { msg.textContent = ''; delete msg.dataset.kind; }, 1500);
    });

    // Re-evaluate lock when tier changes (license activation / deactivation
    // happens in the same popup; storage onChanged fires).
    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        if ('xvm_license_v1' in changes || 'xvm_trial_v1' in changes) {
          const r = await resolveTier();
          setLocked(section, r.tier === 'free');
        }
        if (STORAGE_KEY in changes) {
          const next = normalize(changes[STORAGE_KEY].newValue);
          currentSettings = next;
          applyTo(section, next);
        }
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', mount);

  // Expose for popup.js / tests.
  window.__xvmRateFilterPopup = { STORAGE_KEY, DEFAULTS, mount };
})();
