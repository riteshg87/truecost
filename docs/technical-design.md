# TrueCost production technical design

## Status and scope

**Status: implementation design under the active goal; production publishing unapproved.** Updated 15 September 2026. D1 behavior and D2 email OTP are accepted in [product decisions](product-decisions.md). The minimal identity foundation is synced to the approved development database; real sign-in integration, retention/recovery targets and the sensitive-action bridge still need verification. Supabase is unused/test scaffolding; Clerk, Convex and consented Mixpanel are the target integrations, with calculations remaining in the browser.

Proposed release behaviour is as follows: a guest compares exactly two offers and reads the complete result. Saving, downloading, a changed-input recalculation, or a new comparison requires authentication. A member compares two or three offers. Sorting, expanding, and reopening the unchanged guest result remain free. Clerk email OTP only is now confirmed; phone sign-in is deferred. The PDF is built in the browser from a comparison snapshot; the MVP stores no report object.

## System boundaries

```text
Browser: finance engine, validation, draft/result, PDF rendering, IndexedDB outbox
   | Clerk session token                         | allowlisted events only
   v                                             v
Convex React client -> authenticated functions   Mixpanel
                         | owner checks
                         v
                    Convex records
Clerk webhooks -> verified Convex HTTP endpoint -> profile/deletion reconciliation
```

Clerk establishes identity. Convex validates the Clerk JWT and owns authorization. UI guards are presentation. Every public function obtains `ctx.auth.getUserIdentity()` and derives the owner from verified `tokenIdentifier`; none accepts a browser-supplied owner. `tokenIdentifier` combines issuer and subject. [Convex auth in functions](https://docs.convex.dev/auth/functions-auth)

Use `ClerkProvider` outside `ConvexProviderWithClerk`. The application may show member state only after `useConvexAuth()` confirms that Convex has fetched and validated the token. [Convex and Clerk for Next.js](https://docs.convex.dev/auth/clerk)

## Identity and profile lifecycle

`ensureCurrentUser` runs after Convex authentication and inside each first write. It finds `users.by_authKey` or inserts a minimal profile in the same transaction. Provisioning is idempotent and independent of webhook timing. Clerk says webhooks are asynchronous and cannot gate onboarding. [Clerk webhook overview](https://clerk.com/docs/guides/development/webhooks/overview)

All private functions also require an active application user, not merely a valid JWT. Provisioning and delayed webhooks must never reactivate a deleting/deleted owner. Keep the deletion block until provider revocation and the approved recovery window are complete.

The Clerk webhook endpoint verifies the Svix signature before parsing or acting on the payload, deduplicates Clerk event IDs, and reconciles profile updates and deletions. It never grants ownership. Concurrent profile creation uses an indexed lookup followed by insert in one Convex mutation. Convex indexes do not declare uniqueness constraints; query `.unique()` rejects unexpected duplicate rows. Convex OCC and serializable transactions cause a racing mutation to retry and then see the inserted row. [Convex OCC and atomicity](https://docs.convex.dev/database/advanced/occ)

Store no email or phone in Convex unless a later support requirement and privacy review approve it. `users` needs only `authKey`, Clerk subject for deletion coordination, timestamps, status, and a random analytics ID.

## Data model and contracts

All public functions define Convex runtime validators for arguments and returns. Reuse one strict validator for `Offer`, derived values, warnings, loan payloads, and context enums. Reject unknown fields, non-finite numbers, oversized strings, more than three offers, and snapshots whose input/result IDs disagree. Suggested limits are proposals: lender/title 120 characters, fee label 80, feedback comment 1,000, and 50 records per page. Server-enforced per-owner write/export limits return a typed retry time and never discard the local payload; pilot volume must set the numbers.

| Table | Required fields | Indexes |
| --- | --- | --- |
| `users` | `authKey`, `clerkSubject`, `status: active/deleting/deleted`, `analyticsId`, `createdAt`, `updatedAt` | `by_authKey`, `by_clerkSubject` |
| `comparisons` | `ownerId`, `requestId`, `snapshotVersion`, `calculationVersion`, `resultId`, `offers[2..3]`, complete derived result, `source`, `createdAt`, optional `title` | `by_owner_createdAt`, `by_owner_requestId` |
| `savedLoans` | `ownerId`, loan/quote payload, `revision`, `updatedAt`, optional `deletedAt` | `by_owner` |
| `feedback` | `ownerId`, `requestId`, `feature`, `contextId`, `contextVersion`, `answer`, optional `comment`, `createdAt` | `by_owner_createdAt`, `by_owner_context` |
| `operationReceipts` | `ownerId`, `requestId`, `kind`, `payloadHash`, `resourceId`, `status`, `createdAt`, `expiresAt` | `by_owner_requestId`, `by_expiry` |
| `recordTombstones` | `ownerId`, `entityKind`, `entityKey`, `revision`, `deletedAt`, `expiresAt`; no deleted payload | `by_owner_entity`, `by_expiry` |
| `webhookReceipts` | `eventId`, `eventType`, `processedAt` | `by_eventId`, `by_processedAt` |
| `adminGrants` | `authKey`, `active`, `grantedAt`, `grantedBy`; writable only by internal administration | `by_authKey` |
| `exportSessions` | `ownerId`, `tokenHash`, `expiresAt`, `consumedGrantId`, `createdAt` | `by_tokenHash`, `by_expiry` |
| `deletionJobs` | `ownerId`, `clerkSubject`, `status`, step states, attempts, `requestedAt`, `nextAttemptAt`, optional `completedAt/lastError` | `by_owner`, `by_status_nextAttempt` |
| `auditEvents` | pseudonymous owner reference, actor type, action, outcome, timestamp, request/job ID; no finance content | `by_owner_createdAt`, `by_createdAt` |

A comparison snapshot is immutable after insert. It contains normalized inputs and the exact derived result displayed, plus `snapshotVersion` and `calculationVersion`; reopening does not silently recalculate it. A future “recalculate with current engine” creates a new result and comparison. This preserves auditability without making Convex a second finance engine.

History and feedback use owner/time indexes and cursor pagination, never `.collect()` over an account. The server caps pages at 50. A server-owned `adminGrants` row authorizes the bounded `admin.readFeedbackPage` mutation, which reads one page and writes its audit event atomically. There is no browser API for granting admin access. Members have no read-all function.

The saved loan remains separate and mutable. `updateSavedLoan(expectedRevision, payload, requestId)` reads the caller's row and succeeds only when `expectedRevision` matches; otherwise it returns a typed conflict with the latest revision. Create starts at revision 1. Individual comparison and loan deletion write an opaque tombstone before purge; save mutations check it, so stale offline work cannot resurrect a record. Tombstones follow the deletion-evidence retention below. The UI asks the person to keep the device or server copy on conflict; clock-based last-write-wins is retired.

## Idempotency, offline work, and account isolation

Each user action creates one cryptographically random `requestId`, retained for all retries and reloads. A write mutation atomically checks `operationReceipts.by_owner_requestId`. The same kind and payload hash returns the original result; a reused ID with different content is rejected. If absent, the mutation writes the domain record and receipt together. This lookup-plus-insert pattern is the uniqueness mechanism. Receipts and tombstones remain through the backup ceiling plus seven days.

Convex retries deterministic transaction conflicts, but that retry is not a durable application queue. Account saves use an IndexedDB outbox with `{requestId, kind, payload, payloadHash, originatingAuthKeyHash, createdAt, attempts}`. Queue only while a tab has a Convex-verified member session; that tab may keep queueing if connectivity drops. Sending pauses on auth expiry. After reload, private data stays locked until the same account is verified online; a stored account ID cannot make it available. Items older than the seven-day replay window pause with notice and require explicit discard or a fresh confirmed submission. Automatic local deletion awaits D3 retention approval. Retry recoverable failures with bounded backoff and jitter. Validation, authorization, and revision conflicts require user resolution. “Queued on this device” changes to “Saved to your account” only after acknowledgement.

Every async operation captures an `authEpoch` and account hash. Sign-in, sign-out, or account change increments the epoch and aborts fetches. Late callbacks update UI or storage only when both values still match, preventing shared-device account crossover.

Private mutation transport must also keep its authentication bound to that
captured session. A shared client can retain a queued request across an account
change; a guard checked only before calling it cannot prove which credentials
will be used later. The planned adapter obtains a token for the captured Clerk
subject/session, checks its `sub` and `sid` for consistency, then uses a dedicated
HTTP client whose token is not subsequently replaced. Convex still verifies the
signature and derives ownership. Client-side claim decoding supplies only a
consistency check, never authorization. A stale operation may finish for its
original account, but cannot be sent with another account's credentials or
publish its result into the new session.

The auth intent record contains a random nonce, stable request ID, action, result snapshot ID, edited draft reference where needed, expiry, and `pending/claimed/completed` state. Internal actions distinguish `save`, `download`, `new_comparison` and `recalculate_existing_draft`; the last two share only the analytics category `compare_again`. The initiating tab claims the intent for the first Convex-verified account. Save retries consult the same receipt; Download presents an explicit Continue action if browser activation expired. New starts a fresh two-offer draft; Recalculate computes the preserved edited draft. Completed state suppresses repeats. An abandoned claim can be recovered after its lease expires, using the same request ID; a claimed flag alone must not strand work after a crash. Cancellation leaves the result readable. Expired/malformed intent does not spend another guest allowance.

Before logout, warn when unsynced work exists: Stay cancels logout; confirmed sign-out discards every former-member outbox item, cache, and private copy on that device. Then clear in-memory queries, report blobs, and Mixpanel identity. Cross-tab logout broadcasts the new auth epoch. Only unassigned guest or legacy device data may survive. The actual current keys, `truecost.loan.v1` and `truecost.compare.v1`, are never assigned automatically to the first signer. After sign-in, offer Import to this account, Keep on this device, and Remove. Import is idempotent; only acknowledgement permits marking it imported or offering local removal. Browser locking is an application privacy control, not encryption against someone with operating-system or developer-tools access to the same profile.

## PWA cache and report handling

Replace the service worker's “all same-origin GET” strategy with a build-generated allowlist. Precache a dedicated public, data-free offline calculator shell plus its versioned finance JS/CSS, icons, fonts, and manifest, so the guest calculator cold-loads after one online visit. Exclude ordinary navigation HTML, `/account`, API/Convex/Clerk responses, report blobs, authenticated React payloads, and URLs with finance data. Offline history comes only from account-partitioned IndexedDB.

PDF generation runs on demand in the browser from the immutable current or fetched snapshot, then hands a Blob to the browser download API and releases its object URL. A currently verified tab may generate from an already-loaded snapshot offline when report assets are cached; after reload, online verification is required before private snapshots are available. No PDF bytes or report object go to Convex Storage or Mixpanel. This avoids bearer file URLs that remain reusable until the file is deleted; Convex recommends an authenticated HTTP action when every access needs authorization. [Convex file serving security](https://docs.convex.dev/file-storage/serve-files)

## Analytics, export, deletion, and recovery

Mixpanel uses an allowlist wrapper for the PRD events. It rejects unknown properties and finance values, lender names, free text, contact details, tokens, URLs, and Clerk IDs. Autocapture and session recording remain off. `comparison_saved` fires only after Convex acknowledgement and is deduplicated by request ID. Consent state gates all events; logout resets identity. Proposed Sentry monitoring records release, environment, opaque request/job ID, and allowlisted error code only; request bodies, finance content, session replay, and user contact data are disabled.

**Account export, local implementation under review:** Clerk reverification precedes export and deletion. A browser cannot mint a grant or assert that reverification happened. The protected Next.js route verifies recency and signs a short-lived proof. A regular authenticated Convex action verifies that proof and invokes internal grant issuance; Convex validates the caller's token. Bind the proof to the verified owner, Clerk session, operation, environment audience, expiry and single-use nonce. No browser or Next.js request receives a Convex deployment-admin credential. `beginExport` atomically consumes the grant and creates a ten-minute session. Owner/session-checked, bounded read-only mutations retrieve each page with a fresh expiry check. A monotonic owner revision and finalization fence reject concurrent exported-data changes. The browser assembles versioned `truecost-export.json` with comparisons, saved loan, feedback and dismissals, excluding tokens, analytics IDs, receipts and internal lifecycle data. Live provider/browser acceptance remains required.

Provider guidance rechecked on 16 September: [Convex's Clerk integration](https://docs.convex.dev/auth/clerk)
excludes the changing `fva` claim from its identity object. Do not infer recent
verification from Convex membership or a browser assertion. Clerk documents a
server `has({ reverification: 'strict' })` check and the client reverification
flow in its [sensitive-action guide](https://clerk.com/docs/guides/secure/reverification).
The signed-grant bridge and local replay tests now exist. The installed Clerk
client hook has local modal/retry and cancellation tests. These do not establish
actual development email reverification, JWT session claims or provider acceptance.

Account deletion is a durable, resumable workflow. The request first sets `users.status=deleting`, creates a job, denies all private reads/writes immediately, and clears local private data. Scheduled internal work purges comparisons, saved loan and tombstones, feedback, outbox receipts, and Mixpanel profile/events where supported; it deletes the Clerk identity last. Each step is idempotent, records outcome without finance content, and retries from its last completed step. Clerk-originated deletion webhooks create the same job. Proposed targets are immediate access removal and live-system deletion within seven days.

Active comparisons and loans remain until deletion. Feedback expires after 12 months; Mixpanel events after 90 days; scrubbed error logs after 30 days. Locked local private cache/outbox expires after seven days with a notice. Minimal deletion/retry evidence contains opaque IDs and status only, and remains until every affected backup expires plus a seven-day recovery margin. **Proposal:** backups contain deleted data for no more than 30 days; the provider and any exported-copy process must prove this before launch. Current Convex documentation states manual/daily backups are retained 7 days and weekly backups 14 days, and notes that configuration and environment variables are excluded. [Convex Backup and Restore](https://docs.convex.dev/database/backup-restore) A restore must replay the deletion ledger before reopening access, so deleted records do not reappear.

**Proposed recovery objectives:** RPO 24 hours and RTO 4 hours. Verify them with a timed restore drill, including code/config restoration and deletion replay, before approval. They are targets, not current guarantees.

The deletion ledger used for recovery must survive replacement of the application database. Select and test an access-controlled recovery copy outside the restored snapshot, with the same retention ceiling, before launch. Replaying the old ledger embedded in an old backup cannot remove deletions accepted after that backup. Keep the restored system closed until the current ledger has been applied and ownership checked.

## Configuration and release gates

No values belong in source control. Hosting public configuration: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_MIXPANEL_TOKEN`, approved Mixpanel host, and proposed `NEXT_PUBLIC_SENTRY_DSN`. Hosting server/build configuration: `CLERK_SECRET_KEY`, Clerk route settings, and proposed `SENTRY_AUTH_TOKEN`. Convex: `CLERK_JWT_ISSUER_DOMAIN`, Clerk deletion secret, webhook signing secret when hosted there, and Mixpanel deletion credentials. Provider consoles hold integrations, approved retention, access, scrub, and alert rules. Development, preview, and production use separate projects. The current reference is on Vercel; eligible commercial hosting under the ₹0 budget remains a release decision.

Release requires: finance fixture parity; validator and ownership tests with two users; direct-ID denial; concurrent profile and request dedup tests; reload/offline outbox tests; auth-intent once-only tests; account-switch late-callback tests; saved-loan revision conflicts and tombstone tests; local import choices; service-worker cache inspection; PDF figure parity and generation target; pagination limits; webhook signature/replay tests; analytics and error payload allowlists; export completeness; deletion retry/restore drill; save performance; supported-browser/PWA upgrade checks; and production email OTP delivery with implicit demo fallback disabled.

Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review. Specialist security/QA review and operating coverage remain open. The monthly service ceiling is ₹0/free plans. No suitable owned domain is available for Clerk production. Verify provider entitlements and recovery within that constraint; see [free-plan assessment](free-plan-assessment.md). SMS is outside this release. Applicable legal requirements, production regions, retention approval, vendor review and feedback-administrator access remain unresolved. These are release gates, along with PDF dependency review, calculation-version responsibility and measured backup/recovery proof.

### PDF implementation preflight, 16 September 2026

TASK-012 will generate selectable-text PDFs locally from validated immutable snapshots, with no new finance calculation and no report upload. Prefer a lazy-loaded document renderer with pagination rather than drawing screenshots into a PDF. React-pdf is the current candidate because its browser API provides a Blob and a separate download action; selection is conditional on the installed version supporting React 19 and passing the report fixtures. Source: https://react-pdf.org/docs/v4/advanced/on-the-fly-rendering.

Bundle static licensed TTF or WOFF fonts with verified rupee glyph coverage. Do not reuse a variable WOFF2 web font without proving support: the renderer documentation specifies TTF/WOFF and warns against variable fonts. Font availability and glyph shaping must be verified in generated output, including user-entered lender names. Source: https://react-pdf.org/docs/v4/fonts.

Keep a readable HTML/print fallback, explicit generation/error/ready states, and a fresh Download gesture after generation. Revoke the Blob URL on snapshot replacement, account/session invalidation, sign-out, deletion and unmount; discard late generation results. Report code and public font assets may be cached for warm verified offline use, but financial document bytes must not enter service-worker storage. Verify text/figure parity, page breaks and p95 generation time before accepting the library or the task. No PDF dependency has been installed by this preflight.
