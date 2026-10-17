# TASK-014: account deletion implementation handoff

Status: implementation pending, 16 September 2026. This continues the accepted account-lifecycle scope after export review. It does not authorize production changes or deletion of real accounts.

## Required behavior

The signed-in owner confirms deletion and completes the same server-verified recent-authentication flow used by export. Consume an account_delete grant atomically with the deletion request. Set the owner to deleting and persist a retryable job before returning an acknowledgement. Every private read, write, export and profile-provisioning path must then deny access, including requests using a still-valid Clerk token.

Use one job per owner and a stable request ID. Repeated requests, lost responses and duplicate Clerk deletion webhooks must recover the same work. A delayed profile event must never reactivate the owner. Browser cleanup must stop analytics and clear private caches, outboxes, drafts and download URLs in all open tabs. A failed local cleanup needs an explicit retry state; do not report completion from an optimistic click.

## Server stages

1. Persist the minimum recovery record and mark access blocked. Keep the Clerk subject and any existing analytics deletion identifier available only to internal worker functions.
2. Purge owner data in bounded batches: comparisons, saved loan, feedback and dismissals, operation/comparison receipts and tombstones, rate-limit rows, export sessions and sensitive grants. Include analytics preferences after copying the identifier needed for provider deletion into the job.
3. Request Mixpanel event/profile deletion when an identifier exists. Store the provider tracking ID and poll to an explicit success response. Missing credentials, timeouts, rate limits and failure responses leave the job pending with a scrubbed status code. Do not interpret request acceptance as completed deletion.
4. Delete the Clerk identity last. Handle an already-deleted identity idempotently. Preserve the application access block throughout provider failures and retries.
5. Mark completed only when every required stage is confirmed. Retain minimal recovery evidence under an approved retention policy; never retain financial payloads in jobs or logs.

Use authenticated internal actions for provider calls and deterministic mutations for job transitions. Claim work with a bounded lease and attempt token so late responses cannot overwrite a newer attempt. Retries must use bounded backoff and a durable scheduler. Credential values and provider response bodies must not enter evidence or user-visible errors.

## Provider and recovery dependencies

- Clerk supports programmatic user deletion and signed user.deleted webhooks. Verify signatures before acting, bound request size, deduplicate event IDs and reconcile through the same job. Sources: [Clerk user management](https://clerk.com/docs/guides/users/managing), [webhook verification](https://clerk.com/docs/reference/backend/verify-webhook).
- Mixpanel deletion covers events and profiles and can take up to 30 days. DEC-012 is pending; do not promise seven-day all-provider deletion. Its privacy API uses a separate bearer credential, not the public ingestion token alone. [Mixpanel privacy API](https://docs.mixpanel.com/reference/gdpr-api).
- A restored application snapshot can predate an accepted deletion. The recovery ledger therefore needs a current, access-controlled copy outside the snapshot being restored. Keep restored access closed until that copy is replayed. A local simulation proves algorithm behavior only; provider recovery and durable external-copy verification remain TASK-019 gates.
- Only synthetic development-account deletion is in the current implementation/test scope. Do not configure production secrets, webhooks or DNS during this slice.

## Acceptance evidence

Prove immediate denial with an already-issued token, foreign-owner/grant/session rejection, double submission, lost response, concurrent writes and export invalidation. Exercise more than one purge batch, a provider timeout after request acceptance, duplicate/out-of-order webhooks, lease expiry, late worker completion and recovery after process interruption. Verify that stale offline writes cannot recreate data and that restored data stays inaccessible until deletion replay completes.

Check the actual account UI with synthetic development users, including cancelled reverification, failed local cleanup, cross-tab sign-out/deletion and truthful pending versus completed states. Run provider cleanup only for explicitly identified disposable accounts and record acknowledgement without credentials. No test or mocked provider response alone closes TASK-014 or the production recovery gate.

## Reviewed foundation checkpoint, 16 September

The local foundation now consumes a session-bound deletion grant, marks the owner deleting atomically, and purges owner records in batches of at most 100. Retry claims use a durable increasing attempt number rather than a timestamp. Root inspected the implementation and reran deletion plus privacy grant/approval suites: 23 tests passed across four files. The lease test directly exercises reclaim and stale-token rejection; it does not establish recovery of a deployed scheduler after interruption. The job intentionally stops at providers_pending, with account access still blocked. TASK-014 remains incomplete.

## Next integration contract

Provider transport adapters must distinguish a deletion request accepted by Mixpanel from a SUCCESS response for that exact tracking ID. Save the tracking ID before polling. A POST timeout is ambiguous: record that uncertainty and reconcile it rather than recording completion. Provider response bodies, bearer tokens and request URLs containing project tokens must not be copied to logs or public status. Missing credentials leave a durable pending status. Clerk deletion follows confirmed analytics deletion (or an evidence-backed no-analytics-data case); a generic HTTP 404 must not be mistaken for confirmed identity deletion.

Before exposing account deletion in the UI, add a minimal owner-authorized status endpoint that remains readable when the profile is deleting, without restoring general private access. It must derive ownership from verified identity and return only request state, sanitized error category and timestamps. Persist the stable request/grant binding across a lost response; repeating the same request must recover the job. Do not request a new grant after the original deletion has blocked profile access.

The account UI must distinguish loan-record removal from account deletion. After explicit account confirmation, complete strict reverification, stop analytics, submit the stable deletion request, and clear browser copies, queued changes and object URLs on acknowledged deletion. Cross-tab notification must invalidate access in other tabs. If local cleanup fails, show a retry state and continue to deny private access; provider processing proceeds from its durable job independently. The current profile query rejects deleting accounts, so the deletion status surface cannot depend on active-profile provisioning or disappear behind a generic sign-in redirect.

Keep provider completion, local cleanup and signed-out state separate. A successful server request cannot truthfully show Account deleted while provider cleanup or local data removal is pending. Browser acceptance must include a lost request response, account switch during reverification, another open tab, offline retry and a local-storage failure. Provider adapters under construction are not connected to the scheduler or live accounts yet.

## Browser integration review, 17 September

The existing account page offers loan-record deletion, not account deletion. Reusing its sign-out cleanup after requestDeletion acknowledges is unsafe as an implementation assumption: lib/loanStore.tsx discardPrivateData and lib/store.tsx discardPrivateData both require the still-current private-session grant. The server immediately marks the owner deleting, which invalidates that grant. The callbacks can then report locked before clearing device copies. RouteGuard also keys private page contents by that grant, so local component state can disappear while deletion is pending.

Implement account-deletion progress outside the member-only component lifetime. Retain a session-bound stable request/grant binding until the acceptance outcome is known; a network error after submission is an unknown outcome, not a rejection. Browser cleanup needs an explicitly confirmed, captured account partition operation that can remove only that former account's records after its access grant is revoked. It must not unlock data, accept a caller-selected foreign account, send queued writes, or clear a newly signed-in account. Include a storage-failure retry, an account switch during cleanup and a second-tab test. Existing sign-out methods must retain their current guards.

The present broadcast path clears the loan draft only after successful loan discard. A deletion signal must also invalidate live offline grants and comparison/report/analytics state, with a storage-event fallback where BroadcastChannel is unavailable. None of those behaviors is established by the current transport test suite.

## Runtime placement checkpoint, 17 September

The root layout nests AnalyticsProvider, CompareProvider, LoanProvider, then RouteGuard. CompareProvider itself renders a keyed ScopedCompareProvider and passes all descendants through it. Therefore placing deletion progress merely above RouteGuard still loses it when the private grant changes. Keep the deletion runtime above CompareProvider, within the configured authentication/analytics context. Capture store cleanup capabilities below that boundary before submitting, then hand them to the longer-lived runtime. Do not remove the existing comparison remount guard.

Mounted auth signal coverage now verifies that matching deletion removes membership, stale profile updates cannot restore it, and a later account B remains usable. See evidence/deletion-signal-fallback-review.md. Reload recovery and the complete deletion screen remain separate acceptance requirements.
