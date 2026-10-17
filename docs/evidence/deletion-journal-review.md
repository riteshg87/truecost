# Deletion request journal review

17 September 2026, local dirty TrueCost checkout based on `b9e53c00219f778294a904e9b3175a9bb5bb26c2`. Luna implemented the journal; Astra reviewed its binding and write checks.

The sessionStorage journal retains only the request/grant identifiers, original Clerk subject/session, timestamp, version and submission phase. It rejects unexpected fields and malformed or oversized records. An unresolved request does not disappear because time has elapsed. Reads distinguish a missing record from unavailable storage, and another session's record is preserved.

Writes and removals require readback verification. A stale completion cannot clear a newer request, and an accepted request cannot move backward to submitting. Review caught an invalid runtime phase being written before validation; the fixed implementation rejects it before touching storage. A direct synthetic Node probe confirmed `invalid/phase` and `originalPreserved: true`.

Root verification: `npx vitest run tests/deletion-journal.test.ts tests/deletion-request.test.ts`, 27 passed. The journal has 14 tests and the coordinator has 13.

This is a recovery record, not authorization. Every replay still needs server validation of the original Clerk session. The journal is not yet wired into the account UI and cannot recreate a captured browser-cleanup capability. Actual reload recovery remains unverified and TASK-014 stays open. Nothing was deployed.
