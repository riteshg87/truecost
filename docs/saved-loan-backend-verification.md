# Saved-loan backend verification

TASK-006B implementation and development verification, updated 16 September
2026. Luna implemented the local slice; root reviewed it, synced the approved
development backend and verified real provider operations with synthetic data.
Production publication remains unapproved.

## Owned surface

- `convex/schema.ts`: `savedLoans`, `operationReceipts`, and
  `recordTombstones` with owner/request/entity indexes.
- `convex/savedLoans.ts`: owner-derived current query, save mutation, delete
  mutation, SHA-256 request identity, revision checks, replay envelopes and
  deletion guards.
- `lib/contracts/saved-loan.ts`: provider-independent payload parser,
  canonical serializer, UUID/revision/request-age checks.
- `tests/convex-saved-loans.test.ts`: contract, isolation, concurrency,
  replay, stale-write, tombstone and malformed-input coverage.
- `convex/_generated/api.d.ts`: public API types, refreshed by the official
  Convex development command during root verification.

The auth worker retains `convex/users.ts`. Every private operation calls
`ctx.auth.getUserIdentity()`, uses its `tokenIdentifier` with the indexed
`users.by_authKey` lookup, and requires `status === "active"`. Provider identity
fields never appear in the returned loan projection.

## API envelope

The singleton query has no owner or record ID argument:

```text
currentLoan({})
  -> { revision: 0, updatedAt: null, payload: null }
  -> { revision, updatedAt, payload }
  -> { revision: <tombstone revision>, updatedAt: <deletedAt>, payload: null }
```

Returning an empty state with revision 0, or a deleted state with its
tombstone revision, lets a fresh client make an intentional recreate decision
without exposing an owner or deleted financial payload.

The save request is:

```text
saveLoan({ requestId, expectedRevision, payload, createdAt })
```

Success and replay return `{ status, requestId, revision }`, where `status` is
`saved` or `replayed`. Expected stale revisions return
`{ status: "conflict", code: "revision_conflict", currentRevision }`.
Validation and request-ID reuse return a safe `{ status: "error", code,
message }` envelope.

Deletion uses:

```text
deleteLoan({ requestId, expectedRevision, createdAt })
```

It returns `deleted` or `replayed`, with the same conflict/error envelopes.

## Payload limits

The shared parser accepts the existing `LoanRecord` and `TransferQuote`
fields only. It accepts lender names up to 120 characters and
the existing rate-basis/reset-cycle enums. Blank lender and reset-date strings
remain explicit unknown values; the server does not infer them, a spread or a
reset date. Non-empty calendar dates must be canonical `YYYY-MM-DD`;
`rateResolvedAt` and `createdAt` must be canonical UTC ISO timestamps. Numbers
must be finite and within these technical bounds:

| Field | Bound |
| --- | --- |
| money values | `0..1,000,000,000,000` |
| rates | `0..1000` percent |
| spread | `-100..100` percent |
| remaining/new tenure | `0..1200` / `1..1200` months |
| buffer months | `0..120` |
| request age | no future values; maximum seven days old |

The parser rejects unknown fields, `NaN`, infinities, malformed non-empty dates,
invalid enums, and over-sized strings. The server canonicalizes the
validated payload and computes its SHA-256 identity; clients cannot supply or
override the receipt hash.

## Lifecycle guarantees

An absent record starts at revision 0. A successful save advances it to 1 and
each later successful save advances it by one. A deletion advances the
revision, removes the financial payload, and writes a singleton tombstone.
The tombstone remains as a revision guard, so an old update or initial create
cannot resurrect the record. A deliberate recreation must use the tombstone's
current revision and receives the next revision.

Receipts are looked up by `(ownerId, requestId)` through an index and are
written in the same Convex transaction as the saved record or tombstone.
Convex transactions are atomic and optimistic-concurrency checked, so a
racing write either commits its complete record-plus-receipt effect or retries
against the latest revision and returns a conflict. Same-kind,
same-payload, same-revision, same-createdAt retries return the original
acknowledgement. A reused request ID with a different kind, payload, revision
or timestamp returns `request_reuse`. The stored `reviewAfter` is a seven-day
replay review watermark, not an automatic TTL. This slice does not purge
receipts or tombstones, so the deletion guard remains available. Production
retention must outlive the seven-day outbox and follow the approved deletion
and backup policy.

## Local evidence

Focused command:

```text
npx vitest run tests/convex-saved-loans.test.ts
```

Result: 11 tests passed. The cases cover:

- anonymous, inactive and deleted-owner denial plus forged owner arguments;
- two-account isolation and safe projection;
- sequential replay and parallel same-request retry;
- changed request-ID reuse;
- same request IDs used independently by two owners;
- changed expected revision or timestamp reuse with unchanged row counts;
- one-winner concurrent revision saves and typed conflict;
- delete, duplicate delete, stale update/create denial, and deliberate recreate;
- old/future request rejection;
- exact seven-day boundary acceptance and one-millisecond expiry;
- unknown fields, `NaN`, infinity, invalid dates, over-sized lender and bounds,
  while preserving explicit unknown lender/reset values.

Root then ran the identity and saved-loan suites together: 17/17 tests passed.
Convex TypeScript compilation passed. These focused results do not replace the
integrated app test/build pass while auth and offline files are changing.

## Real development-provider evidence

Root checked the exact SHA-256 hashes of users, savedLoans, schema, auth config
and the shared saved-loan contract before and after syncing. They stayed
unchanged. The official development command generated types and installed the
reviewed functions/indexes in `dev:dutiful-fly-37`, exiting successfully.

The official Clerk backend SDK created temporary sessions for the two existing
synthetic test accounts. Their signed tokens were checked for the configured
development issuer, Convex audience and expected subject before use. All 28
assertions passed, including:

- anonymous read/write/delete denial and safe verified profile projection;
- two separate owners using the same request UUID without colliding;
- concurrent identical saves producing one saved revision and one replay;
- independent loan reads and rejection of forged owner fields on every operation;
- changed-payload request reuse and stale-revision conflicts;
- deletion advancing the revision, followed by an old acknowledged save replay
  that leaves the loan deleted;
- a delayed unacknowledged save being unable to cross the deletion revision;
- account B's record remaining intact while account A deletes its record.

Both temporary sessions were revoked. Both synthetic loan payloads were removed;
the existing test users/profiles and opaque receipt/tombstone metadata remain.
[Observed checks and cleanup](evidence/development-saved-loans.json) contain no
credentials or bearer tokens. Inactive-owner and request-age boundaries are
covered locally; this provider run did not mutate identity lifecycle status.

## Remaining verification

Client storage, outbox replay, sign-out cleanup and browser account-switch
behavior belong to the next privacy slices and are not wired by this backend
task. Browser OTP delivery, integrated app verification, immutable comparisons,
account lifecycle and approved retention remain separate open work.
