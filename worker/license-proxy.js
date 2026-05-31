// Cloudflare Worker — minimal proxy that forwards license activate/validate/
// deactivate requests to Creem with the secret x-api-key header injected
// server-side. The extension calls THIS worker, never Creem directly, so
// the API key never ships in the extension bundle.
//
// Forked for XVM. Keep this Worker independent from XMP so product
// whitelists, origins, and signing keys can diverge safely.
//
// ─── Deployment ──────────────────────────────────────────────────────
//   1. Sign in to https://dash.cloudflare.com → Workers & Pages → Create
//   2. Choose "Hello World" template, paste this entire file as the worker
//   3. Settings → Variables → add:
//        CREEM_API_KEY     = "creem_live_xxxxx..."   (Encrypt = on)
//        CREEM_PRODUCT_IDS = "prod_month,prod_year" (comma-separated, required)
//        ENTITLEMENT_SIGNING_PRIVATE_JWK = '{"kty":"EC",...}' (Secret)
//        ALLOWED_ORIGIN    = "chrome-extension://STORE_ID,chrome-extension://DEV_ID"
//                            (comma-separated; required in production; do not use "*")
//   4. Deploy. Worker URL will be like:
//        https://xvm-license.YOUR-SUBDOMAIN.workers.dev
//   5. Paste that URL into src/premium/license/{isolated,popup-pro}.js
//      → LICENSE_PROXY_URL
//
// ─── API ─────────────────────────────────────────────────────────────
//   POST /activate    { key, instance_name }
//   POST /validate    { key, instance_id }
//   POST /deactivate  { key, instance_id }
//   Referral endpoints are retired. Old clients receive 410 Gone JSON.
//
//   Response: { ok, status, data }   — same shape regardless of action

// Creem uses separate hosts for test vs live mode. Auto-route based on
// the API key prefix so you don't have to maintain two Worker deployments.
const CREEM_LIVE = 'https://api.creem.io/v1/licenses';
const CREEM_TEST = 'https://test-api.creem.io/v1/licenses';
const ALLOWED_ACTIONS = new Set(['activate', 'validate', 'deactivate']);
const REMOVED_REFERRAL_ACTIONS = new Set(['referral/code', 'referral/claim', 'referral/stats']);
const ENTITLEMENT_TTL_SECONDS = 10 * 60;
const DEFAULT_XVM_PRODUCT_IDS = [
  'prod_7f7t9EHK3RJlOK37DWr7J',
  'prod_69yTiXGXb04DKm46DNVbN9',
];

function creemBase(apiKey) {
  return (apiKey || '').startsWith('creem_test_') ? CREEM_TEST : CREEM_LIVE;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = buildCors(env, origin);

    const url = new URL(request.url);
    const action = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (REMOVED_REFERRAL_ACTIONS.has(action)) {
      return json({
        ok: false,
        code: 'feature_removed',
        error: 'feature_removed',
        message: 'Referral rewards have been retired.',
      }, 410, corsHeaders);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
    }

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

    const productCheck = checkProductId(data?.product_id, env);
    if (upstream.ok && action !== 'deactivate' && !productCheck.ok) {
      return json({
        ok: false,
        status: 403,
        error: productCheck.error,
        detail: { expected: productCheck.expected, actual: data?.product_id || null },
      }, 200, corsHeaders);
    }

    const payload = { ok: upstream.ok, status: upstream.status, data };
    if (upstream.ok && (action === 'activate' || action === 'validate')) {
      const instanceId = action === 'activate'
        ? data?.instance?.id
        : safe.instance_id;
      let entitlement;
      try {
        entitlement = await makeSignedEntitlement({
          licenseKey: safe.key,
          instanceId,
          status: data?.status || 'active',
          productId: data?.product_id,
          activationLimit: data?.activation_limit ?? null,
          activationUsage: data?.activation ?? null,
          expiresAt: data?.expires_at || null,
        }, env);
      } catch (e) {
        return json({ ok: false, status: 500, error: 'entitlement_signing_config_missing', detail: String(e?.message || e) }, 200, corsHeaders);
      }
      payload.entitlement = entitlement.entitlement;
      payload.entitlement_payload = entitlement.payload;
      payload.entitlement_sig = entitlement.signature;
    }

    return json(payload, 200, corsHeaders);
  },
};

export class ReferralLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response(JSON.stringify({ ok: false, code: 'feature_removed', error: 'feature_removed' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function checkProductId(productId, env) {
  const allowed = getAllowedProductIds(env);
  if (!allowed.length) {
    return { ok: false, error: 'server_product_config_missing', expected: [] };
  }
  if (!productId) {
    return { ok: false, error: 'missing_product_id', expected: allowed };
  }
  if (!allowed.includes(productId)) {
    return { ok: false, error: 'wrong_product', expected: allowed };
  }
  return { ok: true, expected: allowed };
}

function getAllowedProductIds(env = {}) {
  const configured = typeof env.CREEM_PRODUCT_IDS === 'string'
    ? env.CREEM_PRODUCT_IDS.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
  if (configured.length) return configured;
  if (typeof env.CREEM_PRODUCT_ID === 'string' && env.CREEM_PRODUCT_ID.trim()) {
    return [env.CREEM_PRODUCT_ID.trim()];
  }
  return DEFAULT_XVM_PRODUCT_IDS;
}

async function makeSignedEntitlement(input, env) {
  const now = Math.floor(Date.now() / 1000);
  const entitlement = {
    v: 1,
    product_id: input.productId,
    license_key_hash: await sha256(input.licenseKey),
    instance_id: input.instanceId || '',
    status: input.status || 'active',
    activation_limit: input.activationLimit,
    activation_usage: input.activationUsage,
    expires_at: input.expiresAt,
    iat: now,
    exp: now + ENTITLEMENT_TTL_SECONDS,
  };
  const payload = base64UrlEncode(JSON.stringify(entitlement));
  const signature = await ecdsaSign(payload, env.ENTITLEMENT_SIGNING_PRIVATE_JWK);
  return { entitlement, payload, signature };
}

async function ecdsaSign(payload, privateJwkJson) {
  if (!privateJwkJson) throw new Error('missing ENTITLEMENT_SIGNING_PRIVATE_JWK');
  let jwk;
  try {
    jwk = typeof privateJwkJson === 'string' ? JSON.parse(privateJwkJson) : privateJwkJson;
  } catch {
    throw new Error('invalid ENTITLEMENT_SIGNING_PRIVATE_JWK');
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload));
  return base64UrlBytes(new Uint8Array(sig));
}

function base64UrlEncode(value) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildCors(env, requestOrigin) {
  // ALLOWED_ORIGIN can be:
  //   "*"                                    → wide-open (testing only)
  //   "chrome-extension://abc..."            → single ext
  //   "chrome-extension://abc,chrome-..."    → comma-separated whitelist
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes('*')
    ? '*'
    : (allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || 'null');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export const __test = {
  buildCors,
  checkProductId,
  creemBase,
  getAllowedProductIds,
  makeSignedEntitlement,
};
