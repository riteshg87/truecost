# Analytics preference backend verification

Status: bounded TASK-015D behavior verified in development; TASK-015 remains incomplete.

## Evidence

- Source: convex/analytics.ts and the analyticsPreferences table in convex/schema.ts.
- Local owner/consent suite: 8 tests passed; combined analytics foundation checkpoint: 44 tests in 5 files passed.
- Provider: dev:dutiful-fly-37, using two disposable users in the approved Clerk development instance.
- Passing report: [14 provider checks](evidence/analytics-preference-dev-prior-20260916T094620Z.json), checked at 2026-09-16T08:44:10.363Z. The report records source hashes and the existing sign-in build 2ptyOcKPxF0W0l8fJL_3V. That build supplies sign-in only; it does not contain the newer analytics consent UI.

The real mutation generated distinct UUIDs for two accounts after affirmative consent. Default and declined preferences granted no send permission. Repeated acceptance retained the same account ID. Forged owner/identifier arguments failed validation; concurrent writes from one revision produced one accepted change and a stale-write rejection. Withdrawal hid the retained internal ID and removed send permission.

## Cleanup and limits

The successful run revoked sessions and deleted its two disposable Clerk identities. Two declined synthetic preference/profile records remain in Convex because a reviewed deletion operation does not yet exist; their exact references are recorded in the passing report. This is not complete account-deletion acceptance.

Earlier failed runs stopped during sign-in/token readiness and had incomplete cleanup registration. Their empty cleanup-error lists do not establish that no identities remain. A later harness-only refactor failed with an undefined email variable, after the successful backend run. Preserve all reports; the latest filename is not necessarily the successful checkpoint. The executor is correcting bookkeeping and reporting any unresolved test artifacts.

No Mixpanel events were sent by these backend checks. Consent UI, durable withdrawal/reload behavior, actual analytics requests, dashboard counts and historical provider deletion still require separate evidence.

## Browser-to-backend transport checkpoint

On 16 September, `tests/analytics-preference-transport.test.ts` passed 8 tests against the real Convex HTTP client with fetch intercepted locally. Wrong subject, session, audience and expiry stop before a request. Losing the verified grant during token retrieval or while a response is pending rejects the result. The mutation contains only consent, policy version and expected revision; it omits browser cookies and cache use. Invalid local revisions and inconsistent server send permission fail closed.

This checkpoint verifies the client boundary without sending provider traffic. It supplements the 14 actual development-provider checks; it does not replace browser consent or end-to-end event evidence.

## Integrated local consent checkpoint

Root ran seven analytics test files at 10:13 on 16 September: 70 tests passed. This includes 18 mounted provider tests and the eight transport tests above. Review covered guest withdrawal, corrupt/unavailable storage, deferred acceptance racing with withdrawal, same-account queued-event preservation, replacement-account queue clearing, versioned pending markers and bounded revision-conflict recovery. Tracking remains disabled. The next slice connects comparison events and a bounded delivery pump; live ingestion, guest-to-member joining and save/report acknowledgement events are still incomplete.
