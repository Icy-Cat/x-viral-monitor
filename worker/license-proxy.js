// Cloudflare Worker — license proxy for XVM Pro.
//
// Forwards license activate/validate/deactivate requests to Creem with the
// secret x-api-key header injected server-side. The extension calls THIS
// worker, never Creem directly, so the API key never ships in the extension
// bundle.
//
// Forked from x-article-md-paste/worker/license-proxy.js with one M1-driven
// change: CREEM_PRODUCT_ID singular → CREEM_PRODUCT_IDS comma-separated
// whitelist, so the same Worker validates licenses for BOTH XVM Pro
// products (Monthly + Annual) without needing two deployments.
//
// ─── Deployment ──────────────────────────────────────────────────────
//   See worker/DEPLOY.md for the full 5-minute walkthrough.
//
//   TL;DR env vars (Cloudflare dashboard → Worker → Settings → Variables):
//     CREEM_API_KEY      = "creem_live_xxxxx..."   (Type: Secret, Encrypt: on)
//     CREEM_PRODUCT_IDS  = "prod_xxx,prod_yyy"     (comma-sep whitelist)
//     ALLOWED_ORIGIN     = "chrome-extension://YOUR_EXT_ID"  ("*" while testing)
//
// ─── API ─────────────────────────────────────────────────────────────
//   POST /activate    { key, instance_name }
//   POST /validate    { key, instance_id }
//   POST /deactivate  { key, instance_id }
//
//   Response: { ok, status, data }   — same shape regardless of action
//
// ─── Backward-compat ─────────────────────────────────────────────────
// Single-product CREEM_PRODUCT_ID is also honoured (same semantics as the
// x-md-paste Worker) so the deploy flow stays familiar. Whitelist mode
// engages whenever CREEM_PRODUCT_IDS is set.

const CREEM_LIVE = 'https://api.creem.io/v1/licenses';
const CREEM_TEST = 'https://test-api.creem.io/v1/licenses';
const ALLOWED_ACTIONS = new Set(['activate', 'validate', 'deactivate']);

function creemBase(apiKey) {
  return (apiKey || '').startsWith('creem_test_') ? CREEM_TEST : CREEM_LIVE;
}

function parseProductIds(env) {
  if (env.CREEM_PRODUCT_IDS) {
    return env.CREEM_PRODUCT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (env.CREEM_PRODUCT_ID) return [env.CREEM_PRODUCT_ID.trim()];
  return [];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCors(env, origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
    }

    const url = new URL(request.url);
    const action = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!ALLOWED_ACTIONS.has(action)) {
      return json({ ok: false, error: 'unknown_action', action }, 404, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json({ ok: false, error: 'invalid_json' }, 400, corsHeaders);
    }

    // Whitelist fields — never let caller inject extra params (e.g. product_id
    // override) through to Creem.
    const safe = {};
    if (typeof body.key === 'string')           safe.key = body.key.trim();
    if (typeof body.instance_name === 'string') safe.instance_name = body.instance_name.slice(0, 80);
    if (typeof body.instance_id === 'string')   safe.instance_id = body.instance_id.trim();

    if (!safe.key) {
      return json({ ok: false, error: 'missing_key' }, 400, corsHeaders);
    }

    const base = creemBase(env.CREEM_API_KEY);
    let upstream;
    try {
      upstream = await fetch(`${base}/${action}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': env.CREEM_API_KEY,
        },
        body: JSON.stringify(safe),
      });
    } catch (e) {
      return json({ ok: false, error: 'upstream_unreachable', detail: String(e) }, 502, corsHeaders);
    }

    let data;
    try {
      data = await upstream.json();
    } catch (_) {
      data = null;
    }

    // Product gating: if a productId whitelist is configured, reject licenses
    // that belong to other products. Defends against using a key for another
    // Creem product on the same account.
    const allowedProducts = parseProductIds(env);
    if (allowedProducts.length && upstream.ok && data?.product_id
        && !allowedProducts.includes(data.product_id)) {
      return json({
        ok: false,
        status: 403,
        error: 'wrong_product',
        detail: { expected: allowedProducts, actual: data.product_id },
      }, 200, corsHeaders);
    }

    return json({ ok: upstream.ok, status: upstream.status, data }, 200, corsHeaders);
  },
};

function buildCors(env, requestOrigin) {
  // ALLOWED_ORIGIN can be:
  //   "*"                                    → wide-open (testing only)
  //   "chrome-extension://abc..."            → single ext
  //   "chrome-extension://abc,chrome-..."    → comma-separated whitelist
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*')
    ? '*'
    : (allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
