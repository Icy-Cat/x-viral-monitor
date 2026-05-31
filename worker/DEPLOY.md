# Deploy xvm-license Worker

XVM Pro uses an independent Cloudflare Worker so it does not share CORS,
product whitelist, or entitlement signing keys with XMP.

## One-command deploy

1. Fill `secrets/worker-secrets.json` with the current Creem API key.
2. Run from repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\secrets\upload-to-worker.ps1
```

The script uploads Worker secrets, then deploys `worker/wrangler.toml`.

## Required config

Plaintext vars in `worker/wrangler.toml`:

- `ALLOWED_ORIGIN=chrome-extension://dkplofpecmjmbhgjgleeflcnfgfkdfpd,chrome-extension://jfopmepbbdmhidjafcebokfmdkphfmpl`
- `CREEM_PRODUCT_IDS=prod_7f7t9EHK3RJlOK37DWr7J,prod_69yTiXGXb04DKm46DNVbN9`

Secrets in Cloudflare:

- `CREEM_API_KEY`
- `ENTITLEMENT_SIGNING_PRIVATE_JWK`

Current Worker URL:

<https://xvm-license.lengkuxiaomao.workers.dev>

## Validate

```powershell
curl -i https://xvm-license.lengkuxiaomao.workers.dev/validate `
  -H "Origin: chrome-extension://dkplofpecmjmbhgjgleeflcnfgfkdfpd" `
  -H "Content-Type: application/json" `
  --data "{\"key\":\"fake-key\",\"instance_id\":\"fake\"}"
```

Expected: JSON response from the Worker (not a browser CORS failure). A fake
key should be rejected by Creem; a real XVM key should return signed
`entitlement_payload` and `entitlement_sig`.
