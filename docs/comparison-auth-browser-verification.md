# Guest comparison authentication browser verification

This report covers the opt-in guest comparison handoff path in `scripts/check-clerk-browser.mjs`. It is a development-only browser check.

## Procedure

Run the existing harness with an explicitly owned free localhost port and:

```text
TRUECOST_BROWSER_COMPARISON_CHECK=1 TRUECOST_CLERK_BROWSER_PORT=<owned-port> node scripts/check-clerk-browser.mjs
```

The harness requires the approved development `pk_test`/`sk_test` pair, the expected Clerk issuer, and the approved Convex target before any API call. It uses fresh Playwright contexts and Clerk's official Testing Token helper. It never logs keys, tokens, response bodies, token-bearing URLs, or persistent `storageState`; CAPTCHA controls remain untouched.

The comparison path starts as a guest, enters two synthetic offers, calculates the first result, and chooses **Sign in to save comparison**. It verifies that the bounded request ID and return destination survive the transition, reloads the verification page, restarts the code flow when the in-memory verification request requires it, and enters Clerk's development test code. After activation it checks the restored result text against the guest result, waits for the account save acknowledgement, reloads the result, and confirms that a member can add a third offer.

The optional continuation edits a second result while offline, confirms the browser queue state without treating it as a server acknowledgement, reconnects, waits for the save acknowledgement, and reads the authenticated Convex list. It reads each run-owned row through `getComparison`, then deletes only those result IDs through `deleteComparison` and verifies they are no longer readable. The run ends with the Account sign-out confirmation and a private-result absence check. Clerk cleanup revokes only sessions created by the disposable address and deletes that address when it did not exist at the start. A Convex profile may remain because there is no identity deletion operation.

## Current result

The final bounded run on 2026-09-16 used `http://localhost:4371`, Chrome 152.0.7977.83, Playwright 1.62.1, and build `rdBT1wGjLQ1OmSolKhP4p` (BUILD_ID SHA-256 `c8717d1546f50b832dc98f3c83ad4cee382958273fd1baba3573f8bafb8034ca`). The source revision was `b9e53c00219f778294a904e9b3175a9bb5bb26c2`; the harness source hash is `ac305116e1ff4f5c069c6b5fe15671ccf7fbb57f2b0205a11a1b308a0fac1b1d`. The machine record is [comparison-auth-browser.json](evidence/comparison-auth-browser.json), with guest and member captures [comparison-auth-comparison-auth-guest-result.png](evidence/comparison-auth-comparison-auth-guest-result.png) and [comparison-auth-comparison-auth-member-result.png](evidence/comparison-auth-comparison-auth-member-result.png).

The final record contains 61 passed checks, zero errors, and zero cleanup errors. It covered the guest two-offer calculation and intent preservation, invalid and valid OTP, exact member result restoration, authenticated Convex list/get without recalculation, member three-offer capacity, offline comparison queue and reconnect acknowledgement, run-owned comparison deletion, fixed-loan save/reload, transfer quote save/reload, warm and cold offline loan behavior, 320px and 390px responsive checks, keyboard sign-out focus, sign-out warning cancellation, loan deletion, and post-sign-out private comparison absence. The unique disposable Clerk user was deleted and one run-created session was revoked. The harness uses the default Clerk token only when its decoded `aud` claim is `convex`, matching the application provider.

Earlier failed attempts remain preserved in [attempt 1](evidence/comparison-auth-browser-20260916T042837Z-attempt1.json), [attempt 2](evidence/comparison-auth-browser-20260916T043112Z-attempt2.json), [the template-token attempt](evidence/comparison-auth-browser-20260916T043810Z-pre-token-mode.json), and [the first audience attempt](evidence/comparison-auth-browser-20260916T044025Z-pre-jwt-aud.json). Prior Clerk smoke artifacts remain preserved. Each opt-in run copies the stable smoke JSON and screenshots to dated `pre-comparison` names without renaming or repeatedly archiving already archived files.

## Limits

The procedure exercises Clerk's development test code, not real email delivery. It does not establish production-domain readiness, real user onboarding, financial correctness, or a general comparison-history UI. The direct Convex checks use the disposable authenticated session and only the run's result IDs. The final run deleted its own comparison rows and loan through the normal authenticated paths. Two earlier token-cleanup failures may have left synthetic comparison rows tied to deleted disposable users. Those rows were outside the final run's session and were not erased by this harness; identify and clean them before any pilot. Offline checks cover this browser session and do not establish cross-device synchronization.

## Current candidate evidence boundary, 3 October 2026

The release manifest binds exact current-candidate claims to `ydMzVTyEiY_q6uNn7FXx1`. The current loan-enabled Clerk/Convex run is the dated [56-check record](evidence/clerk-browser-loan-20261003T011547Z.json); it covers the authenticated loan and quote recovery slice without relabelling the older 61-check comparison capture. Provider retention/deletion, installed-app and real-device acceptance, production configuration, Mixpanel reconciliation and release approval remain open.

## Follow-up cleanup audit, 16 September 2026

A read-only Luna audit distinguished the failures: attempts 1 and 2 ended before
an authenticated comparison save. The pre-token-mode and pre-jwt-aud attempts
both recorded a save acknowledgement, then failed to acquire the token needed
for listing and cleanup. Their disposable Clerk identities were deleted.
The artifacts contain empty comparison-ID arrays and do not preserve their
random test email or owner identifiers. The suspected scope is up to two rows;
their continued presence has not been verified against the database.

Existing comparison APIs deliberately require the original verified owner.
Another signed-in account cannot remove these records, and no public admin
endpoint should be added to bypass that boundary. Inspect the development
database through its operator tooling and correlate the two run timestamps and
synthetic snapshots before recording exact IDs and removing any row. Lender
labels alone are insufficient evidence of ownership. This remains a development
cleanup dependency, not a verified deletion.

The subsequent read-only Convex CLI inspection could not access the selected
development project. It returned an access error before any data was retrieved.
No alternative project was selected and no provider data was changed. Operator
access to the approved development project is required to finish this audit.

## Provider references

- [Clerk testing overview](https://clerk.com/docs/guides/development/testing/overview)
- [Testing with Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview)
- [Clerk test emails and phones](https://clerk.com/docs/guides/development/testing/test-emails-and-phones)
- [Convex pagination](https://docs.convex.dev/database/pagination)
