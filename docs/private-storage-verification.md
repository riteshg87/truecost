# Private storage verification (TASK-007A)

## Scope

This slice provides a provider independent IndexedDB core for a future member saved-loan cache and outbox. It does not replace the existing UI stores, does not import guest or legacy storage, and does not make network calls.

## Public interface

`PrivateStorage` starts locked on every construction. A caller must explicitly `await unlock({ profileId, sessionId, authEpoch, verifiedOnline: true })` after its own online identity check. Unlock reads and binds the current durable discard generation before exposing a guard. Only `profileId` is used as the durable partition key. `sessionId`, `authEpoch`, and the runtime nonce remain in memory.

- `captureGuard()` and `isGuardCurrent(guard)` provide callback guards. `lock()` invalidates them; lock/unlock uses a monotonic runtime nonce to prevent ABA reuse.
- `readState(guard?)` returns `{ revision, cachedLoan, outbox }` for the current opaque profile.
- `queueSaveLoan({ requestId, expectedRevision, createdAt, payload }, guard?)` and `queueDeleteLoan({ requestId, expectedRevision, createdAt }, guard?)` validate using `lib/contracts/saved-loan.ts`, preserve the exact canonical payload and timestamp, and write to the same partition transaction.
- `claimNext(guard, online)` claims only the first outbox item. It requires `online === true`, uses a UUID lease, and recovers an expired lease. A sending or paused head blocks later items so revisions are never silently rebased.
- `acknowledge({ requestId, kind, leaseId, revision }, guard)` is an operation receipt. It requires the matching current guard and live lease, then atomically removes that operation. It never derives current cache data from a historical receipt.
- `applyServerState({ revision, payload }, guard)` is a separate current-server projection path. Older projections are rejected, so an old save receipt cannot repopulate a cache after a newer deletion.
- `recordTransientFailure(requestId, leaseId, errorCode, guard?)` uses a bounded error-code allowlist and capped exponential retry. The eighth failed attempt becomes `paused` with `retry-exhausted`.
- `pauseOperation(requestId, leaseId, reason, guard?)` records explicit validation, authorization, or conflict resolution state.
- `confirmDiscardFormerMember(guard, true)` increments the durable partition generation, clears only that profile partition, and locks the instance. `false` returns `cancelled` without a write.

All cache and outbox mutations use one IndexedDB read/write transaction. A failed transaction returns `storage-unavailable` and leaves the previous record intact. Stored operation/cache shapes are checked before claim or replay; malformed records are treated as unavailable and are not sent or destructively purged.

## Evidence

Update, 16 September 2026: root's combined review now covers 22 storage tests within the 61-test storage/controller/transport run. Appends recheck their expected revision atomically, receipts require the operation's expected next revision, and a detected durable discard locks the local instance. The unused single-operation discard API was removed; conflict recovery replaces only a fully observed paused chain. See [controller evidence](private-sync-verification.md). The original 20-test checkpoint below records the earlier isolated slice.

Focused fake-indexeddb verification: **20 tests passed in 1 file** (`tests/private-storage.test.ts`). It covers locked reload, explicit verified unlock and generation binding before first use, profile isolation, independent-connection claim race, durable discard generation across tabs, runtime nonce ABA protection, held-open stale transaction abort, lease recovery and stale lease callbacks, real transaction rollback, strict malformed oversized/duplicate record rejection, exact request reuse, serialized head blocking, retry cap including repeated crash leases, seven-day expiry, cancel/confirm discard, matching lease acknowledgement, historical receipt safety, and stale server projection rejection including revision-zero validation.

Targeted TypeScript check: no diagnostics for `lib/private-storage/**` or `tests/private-storage.test.ts`. The full application build and full suite were not run because auth and public offline slices are concurrently changing shared application surfaces.

## Limits and handoff notes

The backend caller still owns server authorization, transport, and mapping of Convex acknowledgements. `claimNext` is an offline queue primitive and never sends itself. A request older than seven days is retained as a paused `expired` operation and surfaced for explicit discard or fresh, user-confirmed resubmission; this is a replay deadline, not approval for automatic local purging. A later integration should pass the captured guard into every async callback, call `applyServerState` only from a verified current projection, and keep the existing guest/legacy keys untouched. No UI integration or global sign-out wiring is included here.
