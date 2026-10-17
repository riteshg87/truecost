# TASK-003A contract verification

Verified: 15 September 2026  
Revision under test: `b9e53c0` on `codex/truecost-production`  
Scope: provider-independent comparison snapshots and auth intents

## Implemented contracts

### Comparison snapshots

`lib/contracts/snapshot.ts` adds a versioned immutable snapshot boundary around
the existing `compareOffers` result. A snapshot stores one normalized `offers`
array. Ranked rows reference those inputs by `offerId` and store the complete
copied `Derived` values, rank, best flag, APR/cost gaps, comparison basis,
notices and disagreement flag. `bestId` identifies the existing best row, so a
second mutable offer copy is not stored.

`createComparisonSnapshot` captures a complete two- or three-offer result once,
copies all nested values, assigns a cryptographically random UUID, and records
`schemaVersion`, descriptive `calculationVersion` (`finance-engine-v1`) and a
canonical UTC creation timestamp. `materializeComparison` rebuilds the current
`Comparison` shape from stored values and does not call the finance engine.
`decodeComparisonSnapshot` is the strict persisted-data boundary.

The parser rejects unknown fields, unsupported enums/schema versions, duplicate
or mismatched IDs, non-finite or out-of-range numbers, malformed timestamps,
incomplete offer counts and invalid rank/best relationships. Technical limits
are intentionally wider than UI nudges: 2-3 offers, lender 120 characters,
fee labels 80, up to 50 fee items, money up to ₹1,000,000,000,000, rates up to
1000%, tenure values up to 1200, and warning messages up to 500 characters.

### Auth intents

`lib/contracts/auth-intent.ts` defines the internal action union `save`,
`download`, `new_comparison`, and `recalculate_existing_draft`. Each intent
contains random `nonce` and stable `requestId`, fixed result/draft references,
expiry, state, initiating tab, and an optional opaque account binding and
authentication epoch. New pending intents are deliberately unbound so a guest
can sign in; the first claim binds the intent to the caller's already verified
account and current auth epoch. Recalculation requires a draft reference;
save/download require a result reference. `destinationForAuthIntent` returns only fixed internal destinations
(`/compare/results` or `/compare`), with no redirect URL input.
Intent lifetimes are bounded to 24 hours, with a two-minute renewable claim
lease capped by the intent expiry.

Pure transitions support pending → claimed → completed, cancellation, same
account/epoch lease recovery using the same request ID, and idempotent
already-claimed reads. Each claim has a fresh claim UUID; recovery rotates it,
so a late callback from an older lease cannot complete or cancel the current
claim. Claim, completion and cancellation require the initiating tab, while
completion and claimed cancellation also require the current claim UUID.
Other-account, stale-epoch, other-tab, malformed, expired, lease-expired and
terminal callbacks return typed errors. An unbound pending intent may be
cancelled with the dedicated `PendingIntentContext` containing only its
initiating tab and time; claiming and all claimed transitions require the
verified `IntentContext` account and epoch. The caller must supply that
identity, load the latest persisted intent, and serialize/CAS the write;
these pure helpers do not authenticate callers or prevent storage races, and do
not claim Convex concurrency, database idempotency or provider authorization.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Focused contract tests | PASS | 13/13 tests in 2 files. |
| Full test suite | PASS | `npm test -- --run`; 150/150 tests in 12 files. |
| Typecheck | PASS | `npm run typecheck`; route type generation and `tsc --noEmit` passed. |
| Diff/scope review | PASS | Manual review of all new contract files and `git diff --check`; no app/store/provider/Convex/dependency edits. `/review` was unavailable, so no automated review claim is made. |

Tests cover two/three-offer capture, exact round-trip, copied/frozen values,
changed-draft isolation, no-recalculation hydration, hostile unknown fields,
unknown enums, non-finite numbers, count and ID mismatches, unsupported schema,
safe intent destinations, required references, unbound guest claim and binding,
guest cancellation, pending/claim/complete, initiating-tab and account/epoch
isolation, claim UUID rotation across lease recovery, callback time ordering,
cancellation and malformed or expired intents.

## Boundary and follow-up notes

- The existing finance engine remains the sole calculator. This task does not
  add historical-engine execution or a second calculation path.
- Snapshot IDs are result identifiers, not account ownership. Ownership,
  Convex validators, request receipts, revisions and provider-derived identity
  remain later integration work.
- Intent transitions are pure in-memory helpers. Server transaction ordering,
  durable receipts, outbox behavior and the sensitive-action bridge are outside
  TASK-003A.
- The working tree contains root-owned `AGENTS.md`, README and shared docs;
  this task added only `lib/contracts/` and this report.

## 4 October 2026 local account-contract rerun

Five focused test files passed 45 tests for receipt identity, recent-auth grant/recovery, account-export UI state and deletion recovery. Evidence is recorded in docs/evidence/account-contracts-recent-auth-local-2026-10-04.json. The run changed no provider, hosted, production or external state. Server-connected recent-auth and provider receipt acceptance remain open.
