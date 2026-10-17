# TASK-006C comparison backend verification

## Scope and revision

This slice adds private immutable comparison persistence only. The working
tree was already shared and dirty at revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2`
on branch `codex/truecost-production`; unrelated auth, offline, finance,
prepayment, saved-loan, and documentation changes remain present.

Owned files are `convex/comparisons.ts`, additive tables and indexes in
`convex/schema.ts`, generated Convex API bindings, `tests/convex-comparisons.test.ts`,
and this report.

## Contract implemented

- `saveComparison` derives the owner from the verified identity and requires an
  active profile. It parses the existing strict snapshot decoder, requires the
  request `createdAt` to be canonical, no later than now, and within seven
  days. A preserved snapshot may have an older calculation timestamp, but it
  cannot be from after the save request. UTF-8 snapshot size is capped at 256
  KiB.
- The calculation timestamp inside a preserved snapshot remains unchanged. A
  fresh save request may carry an older calculation snapshot, provided the
  snapshot is no later than the request time.
- Stored snapshots are canonical JSON strings. Their calculation version,
  inputs, ranked rows, notices, warnings, and displayed derivatives are
  retained without server recalculation. Titles are trimmed and capped at 120
  characters. `source` is recorded provenance and does not grant authority.
- Receipts are owner-scoped by request UUID and retain only a complete server
  operation hash plus non-content routing metadata. Same content replays the
  original comparison acknowledgement; changed request reuse returns a typed
  error. A second request for the same owner/result UUID cannot create another
  row; a matching acknowledgement gets its own receipt, while different
  content returns `result_conflict`.
- `getComparison` returns the same `null` shape for a missing or foreign record.
  `listComparisons` uses the owner/createdAt index, newest-first Convex
  pagination, 1-50 requested items, bounded cursor length, and read caps of
  50 rows/512 KiB. It is a manual-pagination wrapper around Convex metadata,
  rather than a direct `usePaginatedQuery` shape. Invalid cursors return a safe
  typed error with no raw backend message.
- `deleteComparison` uses the stable result UUID, creates a tombstone even when
  no row exists, and blocks later saves for that result UUID. Delete receipts
  acknowledge historical work only; they do not imply current existence.
- A per-owner indexed rate-window row allows 20 successful writes or deletes
  per rolling 60 seconds. Server processing time, rather than client
  `createdAt`, counts toward the limit. An already stored identical receipt
  and blocked historical save do not consume quota. Every new receipt,
  including an existing-result acknowledgement or a repeated tombstone delete,
  is quota checked. A limited response includes a finite positive
  `retryAfterMs`; comparison, receipt, and tombstone rows retain `reviewAfter`
  for later retention review and no purge is scheduled.

## Verification

Command:

`npm test -- --run tests/convex-comparisons.test.ts tests/convex-saved-loans.test.ts tests/convex-users.test.ts`

- **29/29 tests passed across 3 files.** Coverage includes two-owner and
  foreign-ID isolation, anonymous/inactive denial, canonical snapshot fidelity,
  malformed JSON/unknown fields/oversize/unsupported schema/offer count and
  timestamp bounds, preserved older snapshot saves, replay and changed reuse,
  receipt persistence, same-result concurrency,
  delete-before-create and replay suppression, newest-first pagination and
  malformed page limits, and write/delete quota rollover, replay, and attack
  loops.
- `npx tsc --noEmit -p convex/tsconfig.json`: **passed**.
- `git diff --check` for owned tracked paths: **passed**. New owned files are
  untracked in the shared worktree and were inspected directly.
- No full Next build, cloud data mutation, production deployment, commit, or
  push was part of this slice.

## Review and limits

The Convex expert/reviewer checks were applied to schema, owner derivation,
validators, indexes, pagination, bounded reads, receipt/tombstone lifecycle,
and rate-limit transaction ordering. The local test harness does not prove
Clerk token validation or a real development-cloud invocation; those remain
parent-owned integration checks. Convex OCC is the concurrency boundary, and
the pure snapshot decoder remains the sole historical parser.

During an attempted local `npx convex codegen --typecheck enable`, the CLI
printed component upload analysis steps before failing on an intermediate
TypeScript typing issue. The installed CLI source confirms this path calls
`startComponentsPushAndCodegen` without `finishPush`, so it did not modify the
running deployment. A read-only function inventory still showed only the
previous users and saved-loans functions; no comparison function was active.
No further cloud command was run. The later local Convex `tsc` run passed.

Open product decisions remain retention duration, pilot capacity tuning, and
the later UI/outbox integration. FIN06/07 and other finance findings are out
of scope.

## Real development-provider check

On 16 September, root intentionally synced the reviewed schema and functions
to the approved `dev:dutiful-fly-37` after the integrated 258-test, app typecheck
and production-build checkpoint. The CLI confirmed the development target;
production was unchanged.

`node scripts/check-development-comparisons.mjs` then passed **34/34 assertions**
with two existing reserved Clerk test users and real signed development tokens.
Anonymous access, foreign direct-ID reads, owner selection, foreign deletion,
preserved calculation timestamps, snapshot fidelity, concurrent retries,
receipt reuse, bounded cursor pagination, individual deletion and late-save
resurrection were exercised against the real functions. The runner removed
its two synthetic comparison payloads and revoked both sessions. Minimal opaque
receipts and tombstones remain under the pending retention policy.

[Machine-readable evidence](evidence/development-comparisons.json) includes
source hashes, checks and cleanup. The first runner attempt omitted required
profile consistency arguments; it was corrected without backend changes. Its
[initial evidence](evidence/development-comparisons-initial.json) is retained.
This verifies development server behavior, not real email delivery, private
browser storage, the future history UI or production readiness.
