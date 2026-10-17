# Loan provider verification

## Scope

`LoanProvider` binds private loan state to the runtime-only verified
`AuthValue.privateSession` grant. A new profile, session, auth epoch, or grant
starts with a blank view while the new IndexedDB/controller lifetime opens. The
provider does not read, adopt, write, or delete `truecost.loan.v1`, and it has
no Supabase path.

## Public contract

- `scopeKey` identifies the current profile/session/epoch scope. `hydrated` is
  true only after that scope has opened, or when no verified session exists.
- `sync` is the controller snapshot. The displayed loan uses the newest
  pending payload when present, otherwise the acknowledged cache. A queued
  operation remains queued until its server receipt is processed.
- `draftDirty` marks local quote, surplus or buffer edits. Quote changes
  stay in the current draft; `saveDraft()` is the explicit durable action and
  retains the recorded rate-resolution timestamp. `markRateResolved()` validates
  and queues the complete payload directly.
- `saveLoan(loan, {surplus, bufferMonths})` validates and queues one complete
  payload with `rateResolvedAt: null`. All mutating methods return a typed
  `PrivateResult`, including setters, `clearAll`, retry, and discard.
- `resolveConflict(choice)` reads the current paused queue head internally,
  then delegates the guarded `keep-server` or `resubmit-local` decision. The
  UI does not need to provide a request ID.
- `discardPrivateData(false)` is side-effect free. Confirmed discard clears
  only the local private partition, locks this lifetime, and broadcasts only a
  profile identifier through `BroadcastChannel` when available. The server is
  not changed by this local privacy action. A repeated confirmed discard in
  the same lifetime is idempotent.

## Evidence

Focused provider verification: **16/16 tests passed**, 16 September 2026, with:

```text
npx vitest run tests/loan-provider.test.tsx --reporter=verbose
```

The tests cover no-session blank state and legacy-key preservation, immediate
account A to B blanking while A is still opening, warm offline queueing with
the complete payload, same-lifetime rerenders and local draft state, explicit
draft save, IndexedDB failure without a false saved state, and cancelled versus
confirmed discard, durable rate-resolution persistence, and immediate removal
of a dirty A draft when the verified lifetime changes to B. Additional regressions
prove blank fields on the first render of a replacement grant with the same
identity, preservation of edits made during a delayed durable save, rejection of
a former account's delayed discard, and clearing of unsaved fields when a refresh
is denied. Both StrictMode and production-style mounts are exercised, including
empty accounts, coalesced refreshes and discard during an in-flight refresh.

The authorization regression failed before the fix: the controller was locked
but the dirty loan still showed 1800000. The provider now clears the entire draft
and rejects writes for that revoked lifetime. A confirmed discard deliberately
locks storage; its completion checks the captured account/grant rather than
requiring that storage to remain open.

The focused provider suite was repeated on 2 October 2026: 18/18 tests passed
in isolation, and the five-file offline/provider rerun passed 34/34. The local
guest-provider-outage browser check passed 5/5 on the restored production build.
It observed ten blocked Clerk script requests and installed scoped Clerk HTTP
and Convex WebSocket interceptors without page errors. No Convex HTTP or socket
request was observed in this guest flow, so this confirms auth-script outage
handling rather than a full Convex outage test. These are local checks; hosted
provider lifecycle and multi-tab behavior remain open.

## Boundaries

The authenticated loan screens use this provider; see
[screen evidence](loan-ui-verification.md). Global comparison state and explicit
legacy adoption remain separate open work. The transport remains bound
to the verified identity and session by the existing adapter; the server stays
the authorization authority. Cold offline sessions have no private grant and
therefore remain blank. Browser-level account switching and service-worker
integration are covered by their owning slices.
