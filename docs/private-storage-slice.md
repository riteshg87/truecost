# Next privacy slices

Prepared from source inspection and a synthetic service-worker reproduction, 15 September 2026. This records implementation boundaries for TASK-006 through TASK-009; none is complete.

## Existing behavior reproduced

An isolated Node VM executed the current public/sw.js with synthetic successful network responses. /account navigation, /api/private-export and a /compare/results React data request all entered the cache. Activation deleted an unrelated cache name. A real-browser cache inspection remains required after the fix.

Source review shows one global saved-loan key and one comparison-draft key. LoanProvider restores unassigned device data before identity verification and automatically reconciles it through the legacy Supabase adapter when a member appears. These paths must be replaced before accepting the new Clerk sign-in flow.

## Implementation order

1. Owned saved-loan backend: strict bounded payloads, active server-derived owner, revision conflicts, stable request receipts and deletion tombstones. Prove two-account reads/writes, simultaneous retries and stale-write denial with local tests and the development provider.
2. Account-bound client storage: lock private cold reloads until online verification, preserve unassigned legacy data, offer explicit adoption, serialize durable IndexedDB outbox changes and ignore late account/epoch callbacks. Remove automatic Supabase synchronization. Distinguish queued work from acknowledged saves.
3. Sign-out coordination: Stay preserves unsynced work; confirmed sign-out clears former-member private caches/queues and broadcasts the transition. A failed remote sign-out must remain explicit and must not silently claim success.
4. Public offline calculator: build a data-free shell and an asset allowlist from the actual finance engine; cache only those artifacts. Never cache ordinary private navigation, API/auth responses, report objects or React data requests. Remove only old TrueCost caches.

The existing immutable snapshot and auth-intent contracts remain the basis for the subsequent guest gate, history and PDF slices. Keep finance calculations unchanged.

## Required evidence

- Account B cannot read, mutate or import A's private data through direct IDs, forged owner fields, restored local keys or late callbacks.
- Offline reload stays locked; a previously verified live tab may keep permitted work in memory/its own queue. Reconnection requires the same verified account before replay.
- Storage denial/full quota produces a visible recoverable state, never a false save acknowledgement.
- A stale queued update cannot resurrect a deleted loan. Duplicate retries use one request identity and one acknowledged effect.
- Import requires an explicit choice and an acknowledged idempotent write before local data is marked imported or offered for removal.
- Guest comparison works after an online visit followed by an offline cold load. Private/API/React response canaries are absent from Cache Storage; unrelated caches survive upgrades.
- Real-browser sign-in, cancellation, reload, logout and two-account checks follow the coordinated protections. Mock-only results do not close TASK-005 through TASK-009.
