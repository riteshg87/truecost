# Captured-account browser cleanup review

17 September 2026, dirty checkout. Root reviewed lib/privacy/deletion-cleanup.ts and the captured cleanup methods in private-storage/storage.ts and comparison/private-workspace.ts, then independently ran tests/deletion-cleanup.test.ts: five tests passed.

Capture requires explicit confirmation and a current verified session. The loan-storage binding checks profile, session and auth epoch. Cleanup can run after that grant is revoked, operates only on the captured partitions, preserves increasing generation records and does not transmit private payloads. Populated fixtures cover saved loan/outbox, comparison draft/snapshot/save, foreign data preservation, rejected stale writes, a switched storage runtime and retry after transaction failure.

This accepts the local cleanup primitive only. Store exposure, cross-tab revocation, analytics shutdown, UI confirmation/progress, reload recovery and actual browser/provider deletion are incomplete. No provider calls or deployment occurred during this slice.

Regression scope: root subsequently ran private-storage, private-sync, comparison-private-workspace and deletion-cleanup suites together. All 79 tests passed across four files on 17 September. This adds surrounding persistence/outbox coverage for the new captured cleanup methods; cross-tab auth integration is still a separate in-progress change.
