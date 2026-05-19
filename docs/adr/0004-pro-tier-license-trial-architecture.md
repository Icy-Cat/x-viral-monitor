# ADR-0004: Pro Tier, License, and Trial Architecture

Status: Proposed
Date: 2026-05-19

## Context

X Viral Monitor M1 introduces paid Pro features, starting with the tweet rate
filter migrated from the `x-tweet-rate-filter` proof of concept. The repository
remains MIT/open source, so paid code is visible to users. The goal is therefore
not strong DRM. The goal is a pragmatic runtime gate that:

- keeps all existing free features working,
- unlocks Pro features for valid Creem licenses and the 14 day local trial,
- avoids shipping Creem API secrets in the extension bundle,
- centralizes tier decisions so premium features do not each invent their own
  license logic,
- degrades predictably when offline or when the license service fails.

This ADR covers the license/trial/tier boundary only. The rate filter migration
can proceed independently with a temporary gate stub that returns `trial`.

## Decision

Use a single runtime tier gate, exposed to feature modules as:

```js
getCurrentTier()       // 'free' | 'trial' | 'pro'
isFeatureEnabled(name) // boolean, backed by a central feature map
onTierChange(fn)       // notify UI/features when tier changes
```

Feature modules must only call the gate. They must not read license records,
trial timestamps, Creem responses, cache age, or storage keys directly.

The trusted implementation lives in `src/premium/license/` and is the only place
allowed to combine:

- Creem license state,
- local trial state,
- offline cache/grace state,
- feature-to-tier mapping.

The initial M1 decision is:

- `free`: all existing XVM features remain available.
- `trial`: Pro features enabled during the local trial.
- `pro`: Pro features enabled for a server-validated Creem license.
- `rate-filter`: minimum tier `trial`.
- Rate filtering is disabled by default; the user must explicitly enable it.
- Tweets hidden by the rate filter do not render XVM viral badges.
- XVM Pro uses its own independent Creem product and license state; it does not
  share a license key with `x-md-paste`.
- The trial starts automatically on install.
- Trial expiry is a soft downgrade to Free plus a small upgrade prompt, not a
  hard lock.

## Runtime Boundary

The runtime shape should be:

```text
premium feature
  -> window.__xvmPro.isFeatureEnabled('rate-filter')
      -> getCurrentTier()
          -> license status from Creem proxy/client
          -> local 14 day trial status
          -> cached/offline grace status
```

Allowed dependencies:

- Premium features may depend on `window.__xvmPro`.
- Popup/account UI may call the public license API for activation,
  deactivation, force revalidation, and status display.
- The license module may use `chrome.storage.local` and the license proxy.

Forbidden dependencies:

- Premium features must not directly call Creem, the Worker proxy, or
  `chrome.storage`.
- Premium features must not maintain their own trial counters, timestamps, or
  cached tier booleans.
- Popup UI must not unlock features by writing a local `isPro` boolean.
- The extension bundle must not contain a Creem API key.

## License Validation

Creem calls must go through a server-side proxy, following the existing
`x-article-md-paste` pattern:

- the extension sends license key, instance/device identifiers, and action;
- the proxy holds the Creem API key;
- the extension stores only the returned license record and cache metadata.

Recommended storage:

- `chrome.storage.local`, not `sync`, unless product strategy explicitly changes.
- XVM-specific keys, for example:
  - `xvm_license_v1`
  - `xvm_device_id`
  - `xvm_trial_v1`

The license record should include:

- license key,
- instance id/name,
- local device id,
- activatedAt,
- lastChecked,
- lastTriedAt,
- status,
- activationLimit/activationUsage,
- expiresAt,
- productId.

Product ID must be checked when Creem returns it. A valid active license for a
different product must not unlock XVM Pro unless the user explicitly decides on
a cross-product bundle. Current default: XVM Pro is independent from
`x-md-paste`.

## Cache and Offline Grace

Use a short cache for normal operation and a bounded offline grace for users who
have already validated.

Required behavior:

- Fresh active cached status returns `pro`.
- Stale active cached status triggers background revalidation.
- Network failure during the grace window keeps `pro`.
- Network failure beyond grace returns `free`.
- Explicit expired, disabled, inactive, or wrong-product status returns `free`.

M1 target:

- 24 hour normal cache before background revalidation.
- 7 day offline grace, matching the project decision in thread.

If copied code from `x-md-paste` still uses a different cache/grace duration, it
must be adjusted for XVM or documented as an intentional deviation before merge.

## Trial

Use a local 14 day trial stored in `chrome.storage.local`.

Required behavior:

- Trial start is a timestamp, not a run counter.
- Trial state is independent of license state.
- Valid Pro license wins over trial.
- If no valid license and `now - trialStartAt < 14 days`, tier is `trial`.
- If no valid license and trial expired, tier is `free`.

Product decision:

- Trial starts automatically on install.
- Trial expiry soft-downgrades to Free and shows a small upgrade prompt.

Security note: local trial reset by uninstall/reinstall or storage clearing is
accepted for M1. Do not add server-side trial registration unless the product
decision changes.

## Tier Resolution

`getCurrentTier()` must be deterministic and ordered:

1. If Creem status is valid active for the expected product, return `pro`.
2. Else if local trial is active, return `trial`.
3. Else return `free`.

`isFeatureEnabled(name)` must be backed by a central feature map, for example:

```js
const FEATURE_TIER = {
  'rate-filter': 'trial',
};
```

This map is the only place to decide whether a feature is Free, Trial-enabled,
or Pro-only.

## Threat Model

Accepted risks:

- Open-source users can patch the runtime gate locally.
- Users can reset the local trial by clearing extension storage.
- Runtime checks can be bypassed by a determined user with DevTools.

Mitigated risks:

- API key extraction: Creem API key stays in a server-side proxy.
- Accidental unlock: feature modules only query one gate.
- Offline lockout: validated users get bounded grace.
- Cross-product confusion: product id is checked before returning `pro`.
- Regression drift: tests pin the central gate and prevent direct feature-level
  storage/license reads.

Out of scope for M1:

- Strong anti-tamper or code obfuscation.
- Server-side trial anti-reset.
- Build-time Free/Pro split.
- Shared license package across extensions.

## Implementation Requirements

Before merging the license slice:

- Replace the step 1 hardcoded gate with the real tier resolver.
- Ensure `window.__xvmPro` is initialized before premium feature scripts.
- Keep the public gate API stable:
  - `getCurrentTier`
  - `isFeatureEnabled`
  - `onTierChange`
- Ensure all premium modules use `isFeatureEnabled(featureName)`.
- Keep existing free features outside Pro gates.
- Add popup/account UI using the same status source as the feature gate.
- Do not store or ship Creem API secrets in the extension.
- Make network failure non-fatal.

## Review Gate Checklist

Codex review should block merge if any item fails:

- [ ] No Creem API key or secret appears in extension source, manifest, tests,
      or bundled output.
- [ ] Only `src/premium/license/` reads/writes license and trial storage keys.
- [ ] Premium features do not call Creem/proxy/fetch for license state.
- [ ] Premium features do not read `chrome.storage` for tier decisions.
- [ ] `getCurrentTier()` resolves `pro -> trial -> free` in that order.
- [ ] License product id is checked before returning `pro`.
- [ ] Cache and offline grace durations match this ADR or document why not.
- [ ] Trial is timestamp-based and returns `free` after 14 days with no license.
- [ ] `rate-filter` is gated by the central feature map.
- [ ] Existing free features are not accidentally gated.
- [ ] Unit tests cover free, active trial, expired trial, valid pro, invalid
      license, stale cache, offline grace, and wrong product.
- [ ] E2E/manual checklist covers:
  - free user: rate filter disabled and upgrade CTA visible,
  - trial user: rate filter enabled and days-left visible,
  - pro user: rate filter enabled and license status visible,
  - expired trial without license: rate filter disabled.

## Consequences

Positive:

- License behavior is auditable in one place.
- Feature modules remain simple and replaceable.
- Existing free users are protected from accidental paywall regressions.
- The open-source model remains compatible with a pragmatic paid feature.

Tradeoffs:

- This is not strong DRM.
- Copying license code from `x-md-paste` creates some maintenance duplication.
- Local trial is easy to reset.
- Future cross-product bundle support will require an explicit product/license
  strategy update.

## Locked Product Decisions

These product decisions are locked for M1:

- Rate filtering defaults off after install; users opt in.
- Hidden tweets do not get XVM viral badges.
- XVM Pro is an independent Creem product, not bundled with `x-md-paste`.
- Trial starts automatically on install.
- Trial expiry soft-downgrades to Free and shows an upgrade prompt.
