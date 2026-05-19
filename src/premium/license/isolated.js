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
  const LICENSE_PROXY_URL = '__XVM_LICENSE_WORKER__';

  const TRIAL_DAYS         = 14;
  const TRIAL_MS           = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  // Cache live licenses for 24h before revalidating (ADR-0004).
  const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  // After 7 days fully offline, drop back to free even with a cached license.
  const OFFLINE_GRACE_MS    = 7 * 24 * 60 * 60 * 1000;

  const STORAGE_KEY    = 'xvm_license_v1';
  const TRIAL_KEY      = 'xvm_trial_v1';
  const DEVICE_ID_KEY  = 'xvm_device_id';

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
  async function ensureTrialStarted() {
    let rec = await safeStorageGet(TRIAL_KEY, null);
    if (!rec || !Number.isFinite(rec.startAt)) {
      rec = { startAt: Date.now() };
      await safeStorageSet({ [TRIAL_KEY]: rec });
    }
    return rec;
  }

  function trialStatus(rec) {
    if (!rec || !Number.isFinite(rec.startAt)) {
      return { isTrialing: false, daysLeft: 0 };
    }
    const elapsed = Date.now() - rec.startAt;
    const msLeft = TRIAL_MS - elapsed;
    if (msLeft <= 0) return { isTrialing: false, daysLeft: 0 };
    return { isTrialing: true, daysLeft: Math.ceil(msLeft / 86400000) };
  }

  // ─── Creem proxy ────────────────────────────────────────────────────
  async function callProxy(action, body) {
    if (LICENSE_PROXY_URL === '__XVM_LICENSE_WORKER__') {
      throw new Error('worker_url_unset');
    }
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
    const updated = {
      ...stored,
      status: data.status || stored.status || 'active',
      activationLimit: data.activation_limit ?? stored.activationLimit,
      activationUsage: data.activation ?? stored.activationUsage,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : stored.expiresAt,
      lastTriedAt: Date.now(),
    };
    if (envelope?.ok && (data.status === 'active' || !data.status)) {
      updated.lastChecked = Date.now();
    }
    await safeStorageSet({ [STORAGE_KEY]: updated });
    pushTier();
  }

  // ─── License status read ────────────────────────────────────────────
  async function getLicenseStatus() {
    const stored = await safeStorageGet(STORAGE_KEY, null);
    if (!stored?.key || !stored?.instanceId) {
      return { tier: 'free', record: null, source: 'none' };
    }
    const sinceCheck = Date.now() - (stored.lastChecked || 0);
    const isStale     = sinceCheck > RECHECK_INTERVAL_MS;
    const beyondGrace = sinceCheck > OFFLINE_GRACE_MS;
    if (stored.status && stored.status !== 'active') {
      return { tier: 'free', record: stored, source: 'expired' };
    }
    if (!isStale) {
      return { tier: 'pro', record: stored, source: 'cached' };
    }
    // Stale → kick off background revalidate; serve current best guess.
    revalidateInBackground(stored).catch(() => {});
    if (beyondGrace) return { tier: 'free', record: stored, source: 'expired' };
    return { tier: 'pro', record: stored, source: 'offline-grace' };
  }

  // ─── Tier resolver (the one place tier is computed) ─────────────────
  // ADR-0004 invariant: tier is a deterministic function of (license, trial).
  // Pro wins over trial wins over free.
  async function resolveTier() {
    const lic = await getLicenseStatus();
    if (lic.tier === 'pro') return { tier: 'pro', daysLeft: 0, source: lic.source, record: lic.record };
    const trial = await safeStorageGet(TRIAL_KEY, null);
    const t = trialStatus(trial);
    if (t.isTrialing) return { tier: 'trial', daysLeft: t.daysLeft, source: 'trial', record: lic.record };
    return { tier: 'free', daysLeft: 0, source: lic.source || 'none', record: lic.record };
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
  });

  // ─── Bootstrap: ensure trial started, push tier so MAIN can render ──
  (async () => {
    await ensureTrialStarted();
    pushTier();
  })();

  // Re-push on storage change so tier flips immediately if the license
  // status / trial start changes from another page.
  try {
    chrome?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local') return;
      if (STORAGE_KEY in changes || TRIAL_KEY in changes) pushTier();
    });
  } catch (_) {}
})();
