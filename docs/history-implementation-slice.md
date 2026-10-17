# TASK-011: saved comparison history implementation handoff

Status: routes, snapshot rendering and durable deletion are implemented. The integrated checkpoint passed 474 tests and the production build; 21 development-browser checks passed on 16 September 2026. Narrow history-list and keyboard checks pass; remaining acceptance coverage is under review, so TASK-011 remains open.

## Foundation checkpoint (superseded by integrated checks below)

- `lib/comparison/history-transport.ts`: bounded list/get/delete requests with
  session lifetime checks, validated snapshots and matching deletion hashes.
  Seventeen focused tests pass, including wrong-record rejection and a response
  that arrives after an account change. Root strengthened the deferred-response
  test so invalidation happens after the request actually starts.
- `components/SavedComparisonView.tsx`: recorded inputs/results, IST timestamp,
  version, warnings and native expandable details. Two tests pass with finance
  functions replaced by throwing spies; rendering and expansion do not call them.
- Integrated suite: 452/452 tests across 39 files; typecheck passed. These new
  modules are not yet wired into application routes. No browser or deployed
  history behavior is claimed by these checks.

## Required result

Members can list, reopen and deliberately delete their saved comparisons.
Each view renders the original validated snapshot, including its calculation
version and timestamp. Opening history must never recalculate, replace the active
comparison draft, or overwrite the current Loan health record.

## Existing foundations and boundaries

- `convex/comparisons.ts` already has owner-derived `listComparisons`,
  `getComparison` and `deleteComparison` operations. Reuse them and their bounded
  pagination instead of adding an unrestricted read endpoint.
- `lib/comparison/transport.ts` currently exposes save only. Add a separately
  named history transport or coordinate ownership before extending that module.
  Preserve token, account lifetime, no-store and safe error handling.
- Private views require the current verified `privateSession`. Never restore
  access from a stored profile identifier. Drop pending reads and clear visible
  records immediately on account change, sign-out or grant invalidation.
- Reuse `ResultsTable` with `materializeComparison(snapshot)` for historical
  figures, and render stored offer details without new calculations.
  `OfferBreakdown` currently invokes `scheduleFor()` on expansion, so it needs
  an explicit snapshot-only variant before reuse. Do not reuse the current results page's `Verdict`:
  `recommend()` calls `computeOffer()` for counterfactual fee/rate suggestions.
  Those calculations are not persisted in snapshot schema v1. Historical views
  must label the stored ranking and show recorded costs/APR, assumptions and
  warnings without silently adding suggestions calculated by a newer engine.
- `lib/auth/access.ts` permits guests on descendants of `/compare` and `/account`.
  A history route under either prefix needs an explicit member-only rule before
  the generic prefix rule, plus direct-route tests. Server ownership is still the
  security boundary.
- Offline deletion needs a durable account-bound request, stable request ID,
  original timestamp, honest pending status and reload recovery. Coordinate it
  with the existing comparison outbox; a transient React array is insufficient.
  Confirm deletion before queueing. Prevent a queued save from resurrecting a
  deleted result; preserve the server tombstone behavior.

## Acceptance checks

1. Empty, loading, populated, unavailable, offline and invalid/missing-record
   states are readable and keyboard accessible at narrow widths.
2. Newest-first pages append without duplicates; stale responses from old
   requests or identities cannot append into the new view.
3. Historical figures exactly match the saved snapshot even when the current
   engine produces different figures. Unsupported/corrupt snapshots fail safely.
4. Two accounts cannot list, open or delete each other's records by direct ID.
5. Delete cancellation preserves the item. Pending deletion and acknowledged
   deletion are distinct. Offline/reload/retry and lost acknowledgement use the
   original request. Failed persistence does not hide a record as though queued.
6. Existing active drafts, queued saves, guest allowance and Loan health data
   survive history navigation unchanged.

Capture targeted tests first, then integrated typecheck/tests/build and real
development-provider browser checks. Record the exact build and synthetic record
cleanup. PDF from an opened history record remains required under TASK-012;
do not render a download control before it works. No task checkbox changes until
its full acceptance is evidenced.


## Integrated history checkpoint, 16 September 2026

Build `2ptyOcKPxF0W0l8fJL_3V` includes member history routes, durable account-bound deletion, pending/retry UI and current-draft preservation. The integrated suite passed 474 tests across 40 files; production compilation and TypeScript passed. Source remains an uncommitted working tree based on `b9e53c0`.

The development-browser report records 21 passing checks with two disposable Clerk accounts and the approved Convex development backend. It covers empty/list/detail, stored APR/EMI/total-repayment parity, cancellation, another tab, warm offline deletion, cold private lock, reconnect acknowledgement, missing IDs and account isolation. Three run-owned records and both disposable identities were cleaned up with zero recorded cleanup errors. See `evidence/comparison-history-browser.json` and `evidence/history-build-source-check.json`.

Root inspected the numeric and server-acknowledgement assertions and the pending-deletion screenshot. Root reviewed top/bottom viewport detail captures and the 320px history list. The apparent header overlap is a full-page capture artifact; normal viewport captures show the header at the top. The 320px keyboard cancellation/focus-return check and 390px overflow check pass. Twelve mounted history UI tests now include StrictMode deferred-response and hidden-row pagination regressions. Narrow detail/error states and the complete release accessibility matrix still need evidence; TASK-011 stays open.

