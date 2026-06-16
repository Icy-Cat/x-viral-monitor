// === XVM Pro license bridge (ISOLATED world) ===
//
// Owns chrome.storage.local for license state and trial timestamp, and the
// Worker proxy calls for Creem license activate/validate/deactivate. Pushes
// the resolved tier to MAIN world via window.postMessage so gate.js
// (MAIN world) can answer feature modules without touching chrome.storage
// or fetch.
//
// ADR-0004 边界:
//   - extension code contains NO server-side secret (Worker holds CREEM_API_KEY)
//   - tier resolution lives in a single computation path (resolveTier)
//   - feature modules NEVER read license/trial/storage directly — they only
//     receive postMessage updates routed through gate.js
//
// Message contract (event.data.type):
//   ← XVM_TIER_REQUEST                              (from MAIN/gate.js on init)
//   → XVM_TIER_UPDATE { tier, daysLeft, source }    (to MAIN/gate.js)
//   ← XVM_LICENSE_ACTIVATE  { key }                 (from popup)
//   → XVM_LICENSE_ACTIVATE_RESULT { ok, error? }
//   ← XVM_LICENSE_DEACTIVATE
//   → XVM_LICENSE_DEACTIVATE_RESULT { ok }
//   ← XVM_LICENSE_STATUS_REQUEST
//   → XVM_LICENSE_STATUS { record, tier, daysLeft, source }
//
// Worker URL is a build-time placeholder; deploy step (worker/DEPLOY.md)
// produces the real URL which is sed'd into this file before zip.

(() => {
  if (window.__xvmLicenseBridge) return; // idempotent on hot reload
  window.__xvmLicenseBridge = true;

  // ─── Configuration ──────────────────────────────────────────────────
  // Placeholder replaced at build time. If you see __XVM_LICENSE_WORKER__
  // in production, the build script failed to substitute.
  const LICENSE_PROXY_URL = 'https://xvm-license.lengkuxiaomao.workers.dev';

  // All tier-resolution logic lives in tier-logic.js (loaded BEFORE us per
  // manifest content_scripts order). Pulling from globalThis keeps both
  // contexts (isolated + popup) on a single source of truth.
  const TL = globalThis.__xvmTierLogic;
  const ENT = globalThis.__xvmEntitlement;
  if (!TL) {
    console.error('[xvm pro] tier-logic.js not loaded before isolated.js — manifest content_scripts order broken');
    return;
  }
  if (!ENT) {
    console.error('[xvm pro] entitlement.js not loaded before isolated.js — manifest content_scripts order broken');
    return;
  }
  const { isXvmProduct, trialStatus, licenseStatusFrom, resolveTierFrom } = TL;
  const { verifyEntitlementEnvelope } = ENT;

  const STORAGE_KEY    = 'xvm_license_v1';
  const TRIAL_KEY      = 'xvm_trial_v1';
  const DEVICE_ID_KEY  = 'xvm_device_id';
  const RATE_FILTER_KEY = 'xvm_rate_filter_v1';
  const CONTENT_FILTER_KEY = 'xvm_content_filter_v1';
  const CONTENT_FILTER_RULES_KEY = 'xvm_content_filter_rules_remote_v1';
  const REVALIDATE_RETRY_MS = 5 * 60 * 1000;

  // Remote rules: fetched from the repo's canonical rules.json so we can
  // ship new filter heuristics without rebuilding the extension. Cached in
  // chrome.storage with a 6h TTL; cold-start falls back to the bundled
  // rules.js when cache is empty AND fetch fails.
  const REMOTE_RULES_URL = 'https://raw.githubusercontent.com/Icy-Cat/x-viral-monitor/main/src/premium/content-filter/rules.json';
  const REMOTE_RULES_TTL_MS = 6 * 60 * 60 * 1000;
  // Even on failure, never re-attempt more than once per 5 min. Multi-tab
  // users would otherwise hammer raw.githubusercontent.com per page load.
  const REMOTE_RULES_MIN_RETRY_MS = 5 * 60 * 1000;
  const REMOTE_RULES_SCHEMA_MAX = 2;
  const REMOTE_RULES_CURRENT_VERSION = 2;

  const KEY_RE = /^[A-Za-z0-9_\-]{8,128}$/;

  // ─── chrome.storage wrappers (best-effort no-op outside extension) ──
  function safeStorageGet(key, fallback) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) return resolve(fallback);
        chrome.storage.local.get(key, (o) => resolve(o?.[key] ?? fallback));
      } catch (_) { resolve(fallback); }
    });
  }
  function safeStorageSet(obj) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) return resolve();
        chrome.storage.local.set(obj, resolve);
      } catch (_) { resolve(); }
    });
  }
  function safeStorageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.storage?.local) return resolve();
        chrome.storage.local.remove(key, resolve);
      } catch (_) { resolve(); }
    });
  }

  // ─── Trial state machine ────────────────────────────────────────────
  // trialStatus pure helper imported from tier-logic.js above.
  async function ensureTrialStarted() {
    let rec = await safeStorageGet(TRIAL_KEY, null);
    if (!rec || !Number.isFinite(rec.startAt)) {
      rec = { startAt: Date.now() };
      await safeStorageSet({ [TRIAL_KEY]: rec });
    }
    return rec;
  }

  // ─── Creem proxy ────────────────────────────────────────────────────
  async function callProxy(action, body) {
    if (LICENSE_PROXY_URL === '__XVM_LICENSE_WORKER__') {
      throw new Error('worker_url_unset');
    }
    try {
      if (chrome?.runtime?.sendMessage) {
        const proxied = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'XVM_LICENSE_PROXY', action, body }, resolve);
        });
        if (proxied?.ok) return proxied.payload;
      }
    } catch (_) {}
    const res = await fetch(`${LICENSE_PROXY_URL}/${action}`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function getDeviceId() {
    let id = await safeStorageGet(DEVICE_ID_KEY, null);
    if (!id) {
      id = crypto.randomUUID();
      await safeStorageSet({ [DEVICE_ID_KEY]: id });
    }
    return id;
  }

  function buildInstanceName(deviceId) {
    const ua = navigator.userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
    const os = /Windows/.test(ua) ? 'Win'
      : /Mac OS/.test(ua) ? 'Mac'
      : /Linux/.test(ua) ? 'Linux' : 'Other';
    return `${browser} / ${os} — ${deviceId.slice(0, 8)}`;
  }

  // ─── License operations ─────────────────────────────────────────────
  async function activate(rawKey) {
    const key = String(rawKey || '').trim();
    if (!KEY_RE.test(key)) return { ok: false, error: 'invalid_format' };
    const deviceId = await getDeviceId();
    const instanceName = buildInstanceName(deviceId);
    let envelope;
    try {
      envelope = await callProxy('activate', { key, instance_name: instanceName });
    } catch (e) {
      return { ok: false, error: 'network', message: String(e?.message || e) };
    }
    if (!envelope?.ok) return { ok: false, error: 'activation_failed', detail: envelope };
    const data = envelope.data || {};
    // Client-side product scoping — reject licenses belonging to another
    // product on the same shared Worker (e.g. an x-md-paste license that
    // the Worker's whitelist would otherwise accept).
    if (!isXvmProduct(data.product_id)) {
      return { ok: false, error: 'wrong_product', detail: { actual: data.product_id } };
    }
    const entitlement = await verifyEntitlementEnvelope(envelope, {
      productId: data.product_id,
      instanceId: data.instance?.id || '',
      key,
    }, isXvmProduct);
    if (!entitlement.ok) {
      return { ok: false, error: entitlement.error, detail: entitlement.detail || null };
    }
    const inst = data.instance || {};
    const record = {
      key,
      instanceId: inst.id || null,
      instanceName: inst.name || instanceName,
      deviceId,
      activatedAt: Date.now(),
      lastChecked: Date.now(),
      lastTriedAt: Date.now(),
      status: data.status || 'active',
      activationLimit: data.activation_limit ?? null,
      activationUsage: data.activation ?? null,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
      productId: data.product_id || null,
      entitlementPayload: envelope.entitlement_payload || '',
      entitlementSig: envelope.entitlement_sig || '',
      entitlementExpiresAt: entitlement.entitlement.exp * 1000,
    };
    await safeStorageSet({ [STORAGE_KEY]: record });
    pushTier();
    return { ok: true, record };
  }

  async function deactivate() {
    const stored = await safeStorageGet(STORAGE_KEY, null);
    if (stored?.key && stored?.instanceId) {
      try { await callProxy('deactivate', { key: stored.key, instance_id: stored.instanceId }); }
      catch (_) {}
    }
    await safeStorageRemove(STORAGE_KEY);
    pushTier();
    return { ok: true };
  }

  async function revalidateInBackground(stored) {
    let envelope;
    try {
      envelope = await callProxy('validate', { key: stored.key, instance_id: stored.instanceId });
    } catch (_) {
      await safeStorageSet({ [STORAGE_KEY]: { ...stored, lastTriedAt: Date.now() } });
      return;
    }
    const data = envelope?.data || {};
    if (envelope?.ok && !isXvmProduct(data.product_id)) {
      await safeStorageRemove(STORAGE_KEY);
      pushTier();
      return;
    }
    let entitlement = { ok: false, error: 'missing_entitlement' };
    if (envelope?.ok) {
      entitlement = await verifyEntitlementEnvelope(envelope, {
        productId: data.product_id,
        instanceId: stored.instanceId,
        key: stored.key,
      }, isXvmProduct);
      if (!entitlement.ok) {
        await safeStorageSet({ [STORAGE_KEY]: { ...stored, lastTriedAt: Date.now() } });
        pushTier();
        return;
      }
    }
    const updated = {
      ...stored,
      status: data.status || stored.status || 'active',
      activationLimit: data.activation_limit ?? stored.activationLimit,
      activationUsage: data.activation ?? stored.activationUsage,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : stored.expiresAt,
      productId: data.product_id || stored.productId,
      entitlementPayload: envelope?.entitlement_payload || stored.entitlementPayload || '',
      entitlementSig: envelope?.entitlement_sig || stored.entitlementSig || '',
      entitlementExpiresAt: entitlement.entitlement?.exp ? entitlement.entitlement.exp * 1000 : stored.entitlementExpiresAt,
      lastTriedAt: Date.now(),
    };
    if (envelope?.ok && (data.status === 'active' || !data.status)) {
      updated.lastChecked = Date.now();
    }
    await safeStorageSet({ [STORAGE_KEY]: updated });
    pushTier();
  }

  function shouldRevalidate(info, stored) {
    if (!stored?.key || !stored?.instanceId) return false;
    if (!['offline-grace', 'stale', 'invalid_entitlement', 'missing_product'].includes(info?.source)) return false;
    return Date.now() - (stored.lastTriedAt || 0) > REVALIDATE_RETRY_MS;
  }

  // ─── License status + tier resolver ─────────────────────────────────
  // Pure logic lives in tier-logic.js. We only do storage I/O + the
  // side-effecting background revalidate.
  async function getLicenseStatus() {
    const stored = await safeStorageGet(STORAGE_KEY, null);
    const status = licenseStatusFrom(stored, Date.now());
    // Stale-cache side-effect: kick off background revalidate. The pure
    // helper just reports the verdict; we own the I/O.
    if (shouldRevalidate(status, stored)) {
      revalidateInBackground(stored).catch(() => {});
    }
    return status;
  }

  async function resolveTier() {
    const stored = await safeStorageGet(STORAGE_KEY, null);
    const trial = await safeStorageGet(TRIAL_KEY, null);
    const r = resolveTierFrom(stored, trial, Date.now());
    // Side-effect: if the verdict served from offline-grace, kick revalidate.
    if (shouldRevalidate(r, stored)) {
      revalidateInBackground(stored).catch(() => {});
    }
    return r;
  }

  // ─── Push tier to MAIN world ────────────────────────────────────────
  async function pushTier() {
    const r = await resolveTier();
    window.postMessage({
      type: 'XVM_TIER_UPDATE',
      tier: r.tier,
      daysLeft: r.daysLeft,
      source: r.source,
    }, '*');
  }

  // ─── Message router ─────────────────────────────────────────────────
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const t = event.data?.type;
    if (t === 'XVM_TIER_REQUEST') {
      pushTier();
      return;
    }
    if (t === 'XVM_LICENSE_STATUS_REQUEST') {
      const lic = await getLicenseStatus();
      const r = await resolveTier();
      window.postMessage({
        type: 'XVM_LICENSE_STATUS',
        record: lic.record,
        tier: r.tier,
        daysLeft: r.daysLeft,
        source: r.source,
      }, '*');
      return;
    }
    if (t === 'XVM_LICENSE_ACTIVATE' && typeof event.data.key === 'string') {
      const res = await activate(event.data.key);
      window.postMessage({
        type: 'XVM_LICENSE_ACTIVATE_RESULT',
        ok: !!res.ok,
        error: res.error || null,
      }, '*');
      return;
    }
    if (t === 'XVM_LICENSE_DEACTIVATE') {
      const res = await deactivate();
      window.postMessage({ type: 'XVM_LICENSE_DEACTIVATE_RESULT', ok: !!res.ok }, '*');
      return;
    }
    if (t === 'XVM_CONTENT_FILTER_RULES_REFRESH') {
      await fetchRemoteContentFilterRules({ force: true });
      window.postMessage({ type: 'XVM_CONTENT_FILTER_RULES_REFRESH_DONE' }, '*');
      return;
    }
  });

  // ─── Rate filter settings bridge ────────────────────────────────────
  // Popup (extension context) owns xvm_rate_filter_v1; filter.js (MAIN
  // world) needs to react to changes. We forward the storage value as
  // XVM_RATE_SETTINGS_UPDATE postMessage at boot + on every change.
  async function pushRateSettings() {
    const settings = await safeStorageGet(RATE_FILTER_KEY, null);
    if (settings && typeof settings === 'object') {
      window.postMessage({ type: 'XVM_RATE_SETTINGS_UPDATE', settings }, '*');
    }
  }

  async function pushContentFilterSettings() {
    const settings = await safeStorageGet(CONTENT_FILTER_KEY, null);
    if (settings && typeof settings === 'object') {
      window.postMessage({ type: 'XVM_CONTENT_FILTER_SETTINGS_UPDATE', settings }, '*');
    }
  }

  // ─── Remote content-filter rules ────────────────────────────────────
  // Validate the shape AND contents. A broken/malicious remote payload
  // should not wipe out the cached-or-bundled rules and should not be
  // able to inject a regex that catastrophically backtracks per reply.
  const RULE_TYPES_ALLOWED = new Set(['keyword', 'regex', 'domain', 'short-symbol']);
  const RULE_FIELDS_ALLOWED = new Set(['name', 'screen_name', 'bio', 'location', 'content', 'url']);
  const RULE_SEVERITIES_ALLOWED = new Set(['low', 'medium', 'high', 'block']);
  // Spam rule unions can legitimately get long (we've shipped a
  // 278-char content-funnel union; the previous 240 cap silently
  // rejected the whole payload). 400 still blocks obviously-crafted
  // catastrophic regexes paired with the nested-quantifier heuristic.
  const REGEX_MAX_LEN = 400;
  // Catastrophic backtracking heuristic: nested unbounded quantifiers
  // like (.+)+ / (.*)*. Not exhaustive but blocks the obvious foot-guns.
  const REGEX_NESTED_QUANTIFIER = /\([^()]*[+*][^()]*\)[+*?]/;

  function isValidRule(rule) {
    if (!rule || typeof rule !== 'object') return false;
    if (!RULE_TYPES_ALLOWED.has(rule.type)) return false;
    if (rule.field && !RULE_FIELDS_ALLOWED.has(rule.field)) return false;
    if (!RULE_SEVERITIES_ALLOWED.has(rule.severity)) return false;
    if (typeof rule.value !== 'string' || !rule.value.length) return false;
    if (rule.type === 'regex') {
      if (rule.value.length > REGEX_MAX_LEN) return false;
      if (REGEX_NESTED_QUANTIFIER.test(rule.value)) return false;
      try { new RegExp(rule.value, 'iu'); } catch (_) { return false; }
    }
    return true;
  }

  function isValidRulesPayload(p) {
    if (!p || typeof p !== 'object') return false;
    if (p.version !== REMOTE_RULES_CURRENT_VERSION) return false;
    if (!p.levels || typeof p.levels !== 'object') return false;
    if (!Array.isArray(p.rules)) return false;
    if (typeof p.version === 'number' && p.version > REMOTE_RULES_SCHEMA_MAX) return false;
    // Reject the whole payload if ANY rule is invalid. Partial trust is a
    // bigger surface to reason about than all-or-nothing.
    return p.rules.every(isValidRule);
  }

  async function pushCachedContentFilterRules() {
    const cached = await safeStorageGet(CONTENT_FILTER_RULES_KEY, null);
    if (cached && isValidRulesPayload(cached.payload)) {
      window.postMessage({
        type: 'XVM_CONTENT_FILTER_RULES_UPDATE',
        rules: cached.payload,
        source: 'remote-cache',
        fetchedAt: cached.fetchedAt || 0,
      }, '*');
      return cached;
    }
    return null;
  }

  async function fetchRemoteContentFilterRules({ force = false } = {}) {
    const cached = await safeStorageGet(CONTENT_FILTER_RULES_KEY, null);
    const cachedValid = cached && isValidRulesPayload(cached.payload);
    const now = Date.now();
    if (!force) {
      // Successful fetch within TTL → skip.
      if (cachedValid && cached.fetchedAt && (now - cached.fetchedAt) < REMOTE_RULES_TTL_MS) return;
      // Recent attempt (success or failure) within retry floor → skip so
      // a flapping network or down origin can't trigger a request per page.
      if (cachedValid && cached.lastAttemptedAt && (now - cached.lastAttemptedAt) < REMOTE_RULES_MIN_RETRY_MS) return;
    }
    let payload = null;
    try {
      const res = await fetch(REMOTE_RULES_URL, { cache: 'no-cache' });
      if (res.ok) {
        const json = await res.json();
        if (isValidRulesPayload(json)) payload = json;
      }
    } catch (_) {
      // Network error: fall through to mark the attempt.
    }
    if (payload) {
      const record = { fetchedAt: now, lastAttemptedAt: now, payload };
      await safeStorageSet({ [CONTENT_FILTER_RULES_KEY]: record });
      window.postMessage({
        type: 'XVM_CONTENT_FILTER_RULES_UPDATE',
        rules: payload,
        source: 'remote-fresh',
        fetchedAt: record.fetchedAt,
      }, '*');
    } else if (cachedValid) {
      // Failed fetch — keep payload, just record the attempt so we throttle.
      await safeStorageSet({ [CONTENT_FILTER_RULES_KEY]: { ...cached, lastAttemptedAt: now } });
    } else {
      // No cache and fetch failed — write a stub so retry-throttle applies.
      await safeStorageSet({ [CONTENT_FILTER_RULES_KEY]: { lastAttemptedAt: now } });
    }
  }

  // ─── Bootstrap: ensure trial started, push tier so MAIN can render ──
  (async () => {
    await ensureTrialStarted();
    pushTier();
    pushRateSettings();
    pushContentFilterSettings();
    await pushCachedContentFilterRules();
    fetchRemoteContentFilterRules().catch(() => {});
  })();

  // Re-push on storage change so tier flips immediately if the license
  // status / trial start changes from another page.
  try {
    chrome?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local') return;
      if (STORAGE_KEY in changes || TRIAL_KEY in changes) pushTier();
      if (RATE_FILTER_KEY in changes) pushRateSettings();
      if (CONTENT_FILTER_KEY in changes) pushContentFilterSettings();
      if (CONTENT_FILTER_RULES_KEY in changes) pushCachedContentFilterRules();
    });
  } catch (_) {}
})();
