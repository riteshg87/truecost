# Optional feedback backend verification

## Scope

TASK-013A adds the owner-derived Convex contract for optional comparison and
Loan health feedback. This slice has no admin review endpoint, export wiring,
account-deletion wiring, analytics event wiring, or UI integration.

## Context contract

The member client creates one opaque UUID for the displayed comparison result
or Loan health suggestion and keeps it for retries. A changed result or
suggestion receives a new UUID. The client sends no finance values, input
hashes, lender names, or account identifiers. The server accepts only the
feature/version pairs `comparison/v1` and `loan_health/v1`.

An authenticated owner can therefore submit or dismiss one context/version.
The server proves owner-bound uniqueness and request idempotency. For an
unsaved result or suggestion, an opaque client context cannot prove that a
calculation really occurred without sending finance data or requiring a save;
that limitation remains explicit.

## Server behavior

- `submitFeedback` accepts `yes` or `no` and an optional comment up to 1,000
  characters. The submitted comment is stored as text; no HTML interpretation
  occurs in this backend.
- `dismissFeedback` records a separate terminal dismissal. A later submission
  for that context/version is rejected as already resolved.
- Identical request retries replay. A changed payload with a reused request ID
  returns `request_reuse`.
- Submit/dismiss operations check both request and context indexes in the same
  Convex transaction. A context has one terminal outcome even when the two
  operations race.
- A per-owner window allows 20 new writes per minute. Replays and already
  resolved contexts do not consume quota.
- Guest, missing, deleting, and deleted profiles are rejected through the
  verified Convex identity and active `users` row.
- There is no public all-feedback query. `getFeedbackStatus` returns only the
  caller's status for the supplied context.

## Local evidence

Environment: TrueCost working tree, Convex test runtime, synthetic identities.
No live provider data was used.

```text
npx vitest run tests/convex-feedback.test.ts --reporter=dot
1 file, 11 tests passed

npx vitest run tests/convex-feedback.test.ts tests/analytics-backend.test.ts \
  tests/convex-comparisons.test.ts tests/convex-saved-loans.test.ts \
  tests/convex-users.test.ts --reporter=dot
5 files, 52 tests passed

npx tsc --noEmit --pretty false
TYPECHECK_EXIT=0
```

The dedicated tests cover guest denial, exact malicious text storage, the
1,000-character boundary, retries and request reuse, terminal dismissal,
owner isolation, deleting profiles, malformed and unsupported contexts,
quota boundary/replay, and submit/dismiss races.

## Remaining verification

Development-provider deployment and a real authenticated browser flow remain
pending. Admin review/export/deletion behavior and product prompt lifecycle
remain separate tasks.

## Development activation, 16 September 2026

Root verified `.env.local` selects only `dev:dutiful-fly-37` and the matching public URL, rejected deployment-key/self-host overrides, then ran the installed CLI's one-shot development sync with TypeScript enabled and codegen disabled. The CLI reported the existing rajesh-shinde:truecost development target and functions ready at 11:53:26. This activates reviewed feedback tables/functions and the tested saved-loan provenance changes in development; it is not a production deployment.

Direct unauthenticated requests to getFeedbackStatus, submitFeedback and dismissFeedback all failed with the expected identity rejection. Evidence: `docs/evidence/feedback-dev-guest.json`. These three checks prove endpoint availability and guest rejection, not member UI or complete lifecycle behavior. Authenticated feedback writes and cleanup verification remain pending.
