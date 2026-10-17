# Account action approvals

Status: local implementation. Export and deletion workflows are still incomplete.

## Boundaries

`POST /api/privacy/approval` checks the configured origin, accepts only an action purpose, and uses Clerk's server `has({ reverification: "strict" })` check. A successful response contains a signed proof valid for 120 seconds. Responses are not cacheable. The browser supplies neither identity nor verification age.

The authenticated Convex action `privacyApprovals.exchange` checks the signature and binds the proof to the verified JWT subject and `sid`, the configured environment audience, and the requested purpose. Missing `sid` fails closed. Real development token claim availability still needs verification.

This uses a standard Convex authenticated action instead of the previously proposed HTTP action. Convex performs bearer-token verification, so a separate HTTP authentication implementation is unnecessary. Internal grant issuance checks the active account and returns the same record after an exact replay. A mismatched nonce replay must fail.

Grant consumption must occur in the same mutation as creating the export session or deletion job. The helper alone does not complete either workflow. An operation receipt will also be needed to reconcile a lost response after consumption without starting a second job.

## Configuration

All signing settings are server-only. On 16 September root prepared the four Next server settings in the ignored local `.env.local`, using a fresh random signing key and localhost port 3337 for the planned development check. Existing values were preserved and no key was printed. Matching Convex settings and provider/browser verification remain pending:

- Next server: `TRUECOST_APP_ORIGIN`, `TRUECOST_PRIVACY_AUDIENCE`, `TRUECOST_PRIVACY_KEY_ID`, `TRUECOST_PRIVACY_SIGNING_KEY`.
- Convex: the same audience and `TRUECOST_PRIVACY_VERIFICATION_KEYS`, a JSON object mapping key IDs to 64-character hexadecimal keys.
- Use separate random keys and audiences for each environment. Never use a `NEXT_PUBLIC_` name for these settings.
- Rotation: install the new verification key first, switch the signer to its key ID, then remove the old verification key after outstanding proofs expire. The verifier permits at most three keys.

Do not put keys, proofs or bearer tokens in logs, screenshots, evidence files or analytics. A grant ID never bypasses current account/session checks.

## Evidence and remaining checks

On 16 September, the proof and Next route suites passed 15 checks. The Convex exchange suite passed three checks: exact retry, identity/session/purpose rejection, and missing/replaced verification keys. These are local tests using mocked Clerk and convex-test, not provider acceptance evidence.

Before acceptance: finish and review atomic consumption tests; implement export/deletion operations and retry receipts; verify actual email reverification, signed session claims, key rotation, account replacement, session revocation, and browser behavior in development. Configure retention for approval metadata without silently treating backup retention proposals as approved.

## Development configuration, 16 September

Root installed the matching audience and verification-key map on dutiful-fly-37 using an ephemeral local file, then removed that file. The CLI confirmed two new development variables without exposing their values. Reviewed Convex functions and indexes deployed successfully at 17:15:47 UK time with typecheck enabled. Actual browser export and signed sid availability remain unverified; deployment alone is not acceptance.

## Live development export, 16 September

Root ran scripts/check-account-export-browser.mjs against localhost:3337 and the approved development providers. Seventeen checks passed: fresh email OTP sign-in, UI comparison save acknowledgement, actual 3,570-byte JSON download containing one synthetic comparison, signed-out approval rejected with HTTP 401, B's authenticated list empty and direct lookup of A's still-present comparison returning null, followed by fresh A authentication and acknowledged comparison removal. Disposable Clerk accounts were deleted. Convex profile/receipt/export metadata cleanup is not established by this test.

The artifact declared comparisons, savedLoan, feedback and feedbackDismissals; only comparisons were populated in this run. Root's offline export validator passed. Actual owner/session-bound exchange and export succeeded, demonstrating the required signed session claim was available for this flow. Fresh sign-in produced no reverification modal: older-session reverification, expiry, populated other scopes and key rotation remain open. The original fresh-auth artifact at that path was later superseded by the current-build rerun below; this dated 17-check result remains an execution record, not the current artifact. This is development verification, not production acceptance.

## Older-session export verified, 16 September

The replacement live check completed with 19 checks passed. After 660,149 milliseconds of real elapsed time, export opened Clerk's actual reverification modal. The supported development test OTP completed the challenge and a 3,570-byte JSON download contained the saved synthetic comparison. Signed-out approval returned 401; B's list and direct record lookup denied A's still-present comparison. Test comparison and Clerk identities were cleaned up. Convex profile/receipt/export metadata cleanup remains separate and is explicitly recorded in the artifact.

Evidence: docs/evidence/account-export-stale-session.json and account-export-stale-session-download.json. No clock, JWT claim or provider policy was altered to simulate age. Populated saved-loan/feedback export, cancellation/expiry browser cases, key rotation, full deletion and production acceptance remain open.

## Current-build export acceptance rerun, 2 October

The repaired browser verifier passed 14 checks in Chrome 154 / Playwright 1.62.1 after the development provider rate-limit window cleared. It authenticated two disposable development accounts through email OTP, downloaded and parsed a nonempty scoped JSON export, rejected a signed-out approval request with HTTP 401, confirmed account B had no account-A rows and could not read the foreign direct ID, and deleted the run-owned comparison. Both disposable Clerk users were deleted.

This is the latest current-build browser record. The 17-check fresh-auth and 19-check older-session sections above remain dated historical evidence, not a replacement for this run. Convex profile, receipt, export-session and provider records were not claimed as deleted because the verifier has no reviewed operation for them. Account deletion/recovery, retention enforcement and provider-side deletion remain open. Evidence: docs/evidence/account-export-browser.json and docs/evidence/account-export-browser-failed-2026-10-02T11-58-27-938Z.json.
