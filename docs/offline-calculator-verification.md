# Offline calculator and service worker verification

## Scope

The public offline page is generated from `offline/index.template.html`,
`offline/styles.css` and `offline/main.ts`. Its calculation path imports the
existing `compareOffers`, validation and snapshot contracts. It has no Clerk,
Convex, Supabase, account, or legacy storage imports.

The generated manifest currently contains four exact public assets:

Latest checked manifest version: `8ecaf70f4be9b1ec`.

- `/offline/index.html`
- `/offline/assets/calculator.d82f6c7ca2a2fd6c.css`
- `/offline/assets/calculator.d93d123080e80ddb.js`
- `/offline/manifest.json`

The build is deterministic for unchanged sources. JavaScript and CSS filenames
carry a SHA-256 content prefix, and the service worker embeds the sorted asset
allowlist and manifest version. Rebuild with `node scripts/build-offline.mjs`.

## Guest state

`lib/guest/storage.ts` uses a separate IndexedDB database,
`truecost-public-guest-v1`, with one `guestState` record. The first valid
snapshot and its spent allowance are created in one read/write transaction.
Later calculations leave the record untouched and return `requires-auth`.
Unreadable records are reported as invalid. If storage is unavailable, the
calculator keeps the result in memory for the current visit and states that it
will not survive closing the tab.

## Service worker policy

The generated worker precaches only the four manifest assets. Normal
navigation is network-only and falls back to the clearly labelled public
offline page when the network fails. Query strings, cross-origin requests,
non-GET requests, RSC/data-prefetch requests, account/auth routes, API/Convex
routes, report routes and blob routes are excluded from caching. Activation
removes only TrueCost-owned offline caches and the known legacy `truecost-v1`
and `truecost-v2` names; unrelated caches are retained.

Installation uses a new versioned cache and rejects if any precache fails, so a
working previous version remains available. The app-side controller reports
`waiting-for-control`, `ready`, `blocked` or `failed`; it verifies the message
from the actual controlling worker before reporting ready. The auth flow still
owns the future private-hydration gate.

## Evidence

Focused verification on 16 September 2026:

- `npx vitest run tests/guest-state.test.ts tests/service-worker.test.ts tests/offline-submit.test.ts tests/service-worker-controller.test.ts`: **4 test files, 16 tests passed**.
- The offline slice has no TypeScript diagnostics. The concurrent auth fixture
  errors were subsequently fixed, and the auth worker reports a passing app typecheck.
- The service-worker harness verified exact manifest precache, offline fallback,
  private/RSC exclusion, query/navigation policy, legacy-cache cleanup while
  retaining an unrelated cache, and failed-precache retention of the old cache.
- The guest-state harness verified two-tab-like first-writer behavior,
  unchanged immutable replay, changed-input gating, invalid records and
  transaction failure without allowance consumption. It also opens two
  independent `fake-indexeddb` connections against the shared database and
  verifies the first-writer race against the actual adapter.
- The controller tests reject a stale matching-prefix worker and a status
  message from another worker source; only the manifest-matching controller is
  reported ready. The submit test confirms a cancelable form event is stopped
  synchronously before queued persistence can navigate the page.

The before/after cache reproduction is recorded in
[`docs/evidence/offline-cache-reproduction.json`](evidence/offline-cache-reproduction.json):
the earlier worker returned `UNRELATED-CACHE-CANARY` for an offline private
navigation. The current worker opens its own versioned cache for fallback and
asset reads; the focused test seeds the same-path unrelated canary and returns
the public shell while retaining the unrelated cache.

Root browser check on 16 September used a dedicated synthetic-only server at
`127.0.0.1:8474`. The real browser installed version `8ecaf70f4be9b1ec`,
removed the seeded `truecost-v2` cache and retained `fixture-unrelated`.
After account/API/RSC fetches, the TrueCost cache still contained exactly the
four public manifest assets. The fixture's private routes returned 404; this
checks cache exclusion, not application authorization.

That browser connection stopped responding after the server was stopped.
Root subsequently completed the public offline checks in an isolated headless
Chrome 152.0.7977.83 context, using the bundled Playwright runtime and the same
generated offline version. The user's browser profile was not accessed.

All **13 checks passed** with a real service worker and IndexedDB: exact public
cache contents and legacy cleanup; a new /account document served by the worker
after the HTTP server stopped; full two-offer calculation; changed-input and
new/save/download gates; unchanged first result after offline reload; API/RSC
network failure; hidden, untouched synthetic legacy private data; a 320px
reduced-motion layout; horizontal scrolling that exposes the complete second
offer; and no uncaught browser errors. Root inspected the desktop and mobile
captures. A complete browser-process restart and the integrated signed-in app
remain separate checks.

Evidence: [browser results](evidence/offline-browser-smoke.json),
[desktop](evidence/offline-browser-desktop.png),
[mobile](evidence/offline-browser-mobile.png) and
[scrolled mobile table](evidence/offline-browser-mobile-scrolled.png).
The reproducible runner is [check-offline-browser.mjs](../scripts/check-offline-browser.mjs).
Run it with Node and a local Playwright module path in
`TRUECOST_PLAYWRIGHT_MODULE`; it uses an ephemeral port and disposable Chrome
context and closes both afterward. No package installation was needed.

The older header fixtures under `evidence/local-production-headers*.json` retain
the asset hash recorded by their historical run (`calculator.9c60a1d4bf49b19e.js`).
The current generated manifest and October browser run use
`calculator.d93d123080e80ddb.js`; the historical JSON is retained as evidence,
not as the current asset manifest.

The same runner was repeated on 2 October 2026 after the normal analytics-disabled
build. It passed all 13 checks in headless Chrome 154.0.8037.59, with offline
version `8ecaf70f4be9b1ec`. The account/provider outage runner also passed 5/5;
it observed blocked Clerk script requests and installed scoped Convex
interceptors, but no Convex HTTP or socket request occurred in that guest flow.
No hosted provider or multi-tab claim follows from either run.

### Current local smoke checkpoint: 2 October 2026

The same runner passed 13 checks in headless Chrome 154.0.8037.59 against offline
version `8ecaf70f4be9b1ec`. It rechecked the four-asset public cache, stopped-server
cold navigation, complete guest calculation, changed-input/new/save/download gates,
offline reload, API/RSC exclusion, hidden legacy data, 320px reduced-motion layout,
horizontal table scrolling and uncaught-error absence. Evidence: [offline-browser-smoke.json](evidence/offline-browser-smoke.json).
This remains isolated guest/PWA evidence; it does not establish signed-in private
reload, installed-app upgrade, hosted provider behavior or multi-tab acceptance.

## Limits

The built Next.js server returned the intended no-store headers for the worker,
offline HTML and manifest, and immutable caching for hashed JS/CSS. See
[HTTP evidence](evidence/local-production-headers-localhost.json).
Anonymous app pages returned a static shared-cache header; private response
policy still needs verification on the eventual host and integrated auth flow.
The numeric-loopback startup failure and corrected localhost check are retained
separately in [initial evidence](evidence/local-production-headers.json).

The pinned dev dependencies are `esbuild@0.27.0` and
`fake-indexeddb@6.2.5`. A future client integration must keep member storage and
this guest database separate.

## Current service-worker browser evidence: 4 October 2026

The open-tab service-worker verifier passed generated-cache ownership, upgrade activation, reload continuity, rollback and rollback reload checks against the current local source. Evidence: docs/evidence/service-worker-upgrade-browser-current-2026-10-04.json. The check does not cover installed-app adoption, device lifecycle or production rollout.
