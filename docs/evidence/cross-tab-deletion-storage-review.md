# Cross-tab deletion storage review

17 September 2026. Local dirty checkout; no deployment, provider configuration,
commit, push, or live account deletion performed.

## Scope

`tests/cross-tab-deletion-storage-mounted.test.tsx` mounts the real
`LoanProvider` and `CompareProvider` with only auth and transport boundaries
mocked. A fresh `fake-indexeddb` factory is used for each test.

## Fixture and observed result

- Account A is seeded with a cached saved loan, a queued loan write, a
  comparison draft, and a queued comparison save.
- Account B receives an equivalent but independent persisted partition.
- A is mounted offline. The test delivers the deletion payload through the
  `storage` event fallback with `BroadcastChannel` unavailable.
- The auth revoke callback switches A to anonymous and rerenders the keyed
  providers before the queued cleanup runs. Cleanup then clears A's loan and
  comparison partitions from IndexedDB.
- A's pre-signal storage runtime and guard cannot queue another write after the
  generation tombstone; the loan result is exactly `{ kind: "locked", reason:
  "stale-callback" }`.
- Two pre-signal comparison runtimes reject late `setWorking` and `queueSave`
  with `{ kind: "error", code: "locked" }`; a second fresh A read after these
  attempts remains empty.
- A fresh A read shows a null cached loan, an empty outbox, no draft, no
  snapshot, and no queued saves.
- B hydrates afterward with its cached loan, draft, snapshot, and queued save
  still present.
- The mounted transports make no network calls, and A's captured `getToken`
  function is never called after the signal.

## Verification

`npx vitest run tests/cross-tab-deletion-storage-mounted.test.tsx`

Result: 1 test passed. The captured cleanup deadline regression also covers
blocked opens, late successful opens (closed without a transaction), and a
late upgrade event (aborted without schema mutation), and a successful retry
after timeout: 10 tests passed. Existing cleanup and storage
suites passed 56 tests.

`npx tsc --noEmit --pretty false --incremental false` was run after the opener
change; it reports only unrelated parent checkout errors in
`lib/privacy/account-deletion-provider.tsx` and
`tests/account-deletion-provider-mounted.test.tsx`, plus the comparison opener
strictness error fixed in this slice is gone. The focused Vitest suites passed.

This is an offline synthetic mounted-provider acceptance. Real browser
multi-tab scheduling, reload recovery, and provider deletion remain separate
release gates.
