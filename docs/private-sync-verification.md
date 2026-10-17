# Saved-loan sync verification (TASK-007B)

## Contract

`SavedLoanSyncController` accepts an injected `PrivateStorage` and a transport with three calls: `currentLoan()`, `saveLoan({ requestId, expectedRevision, createdAt, payload })`, and `deleteLoan({ requestId, expectedRevision, createdAt })`. The transport returns only `{ requestId, kind, revision }`; the controller binds the private lease ID before acknowledging it.

`await open(verifiedContext, online)` unlocks the account only after the storage partition generation is bound. Online open obtains the authoritative projection through `currentLoan`; offline open can use an already verified runtime context to queue. The future React adapter must supply that context only after online verification in the current page lifetime; this primitive cannot verify a caller's claim. `pump(online)` coalesces calls within one controller generation. A stopped account's unresolved promise cannot block a new account's open or enqueue. The controller claims one FIFO head at a time, never starts a send while offline, and exposes `nextRetryAt`. Transient failures retain the original operation. Validation and conflict failures pause it; authorization failures retain it and lock rendered private data.

`acknowledge` is receipt handling only. After a receipt, the controller calls `currentLoan` and applies that fresh projection through `applyServerState`; historical payloads never repopulate the cache. `resolveConflict(requestId, "keep-server")` refreshes and clears the observed paused FIFO chain in one guarded compare-and-swap. `resolveConflict(requestId, "resubmit-local")` preserves the latest local save or delete intent, replaces the observed chain under a new UUID and the fresh revision, and refuses a changed or actively leased queue. `discardFormerMember(false)` performs no write; `true` delegates to the guarded generation advancing discard.

Snapshot statuses are `locked`, `loading`, `ready`, `queued`, `sending`, `paused`, `storage-error`, and `refresh-needed`. The snapshot carries acknowledged cache, newest pending optimistic payload or deletion, pending count, retry time, safe error code, and expiry notice. The FIFO head controls wakeups, including lease recovery; a paused head never wakes or sends a later tail. Projection refresh has eight bounded attempts with backoff, including when no operations remain. Reconnection or explicit `retry()` starts a new window. Permanent refresh errors stop automatic retries; authorization rejection clears private fields and locks the controller.

The next expected revision follows the original FIFO chain even if a committed request lost its receipt. Storage rechecks the append revision in the same transaction, so two tabs cannot both append against one revision. Conflict replacement compares the entire observed queue before discarding it. Durable partition revocation locks an already-open store as soon as its next storage operation observes the change; the React layer still needs a cross-tab notification to clear an idle rendered view promptly.

## Evidence

Root-reviewed focused checkpoint on 16 September 2026: **23 controller tests** (`tests/private-sync.test.ts`), **22 storage tests**, and **16 transport tests** passed together: **61/61 in three files**. Covers offline pending state, authoritative refresh after receipt, capped retries, restart wakeups, abandoned lease recovery, stable replay identity, conflict choices, competing-tab appends, expired-head retention, authorization locking, durable revocation, cancelled/confirmed discard, delayed old-account callbacks and fresh-account progress.

Tests use fake IndexedDB, controlled clocks and injected transports. The transport suite exercises real Convex HTTP serialization against a substituted network boundary. This is local evidence, not browser persistence or a combined Clerk/Convex flow. Root corrected a retry test whose timer advanced without its clock and removed a reopen that masked recovery; the final test proves the scheduled retry itself restores the projection. The last whole-app checkpoint predates these files; a fresh integrated check follows stable auth/analytics work.

[Checkpoint record](evidence/private-client-checkpoint.json) records the run, working-tree status and SHA-256 hashes of the exercised source and tests.

## Integration boundaries

The eventual React adapter must provide a fresh verified runtime context, pass connectivity to `open`/`pump`, subscribe to snapshots, broadcast/promptly react to cross-tab discard, and stop on signout or account switch. It must surface `storage-error`, `paused`, `refresh-needed`, and expiry notices with explicit recovery. It must distinguish an active verified tab going offline from a cold private reload. The controller does not replace the existing `loanStore`, member providers, guest state, or service worker. An already-sent request may complete for its original account; stopping the local controller cannot retract it.
