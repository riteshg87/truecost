# TrueCost production release PRD

## Status

- **Status:** Execution v1.3; D1 launch defaults, Clerk email OTP, ₹0 free-plan budget and joint owners accepted. The master goal is active. Remaining privacy, operational, finance and pilot decisions do not constitute release approval.
- **Prepared:** 15 September 2026.
- **Product:** TrueCost, an Indian home-loan comparison and loan-health PWA.
- **Evidence:** The local Next.js 16.3.4, React 19.2.8, and TypeScript app has comparison, Loan health, rate, transfer, prepayment, auth, and account routes. Records use browser storage. Supabase is confirmed unused/test; fresh Clerk and Convex must preserve device data.
- **Product references supplied by the team:** [live app](https://truecost-lac.vercel.app/) and [source repository](https://github.com/riteshg87/truecost).
- **Requirements source:** Direction supplied on 15 September 2026. Research, revenue, schedule, and targets are unknown.

**Fact** means observed; **Assumption** needs validation; **Proposal** needs approval.

Production readiness requires implementation and recorded evidence against the release gates. The user started the master goal on 15 September 2026, authorizing its local implementation, verification, reviewed custom-skill installation and fresh Clerk/Convex development setup. Production publishing, commits, pushes, purchases and other external actions retain their applicable approval boundaries. See [execution decisions](product-decisions.md).

The [Codex master goal](CODEX-GOAL.md) is now active. Production readiness precedes Demo Day preparation. Clerk email OTP is approved; phone authentication is deferred. The pilot audience is registered users in India. The monthly service budget is ₹0 on free plans. Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review; completed reviews and production details remain open.

## Shipping package

| Document | Purpose |
| --- | --- |
| [Technical design](technical-design.md) | Clerk/Convex boundaries, data contracts, sync, deletion and environments |
| [UI behavior specification](ui-spec.md) | Screen states, authentication return, reports and accessible interactions |
| [Analytics plan](analytics-plan.md) | Mixpanel events, consent, identity, privacy and metric definitions |
| [Implementation roadmap](product-roadmap.md) | Ordered tasks, dependencies, verification and phase boundaries |
| [Launch checklist](launch-checklist.md) | Evidence, accountable owners, go/no-go checks and operations |
| [Workflow and commands](WORKFLOW.md) | Prompts and terminal commands, with authorization boundaries |

This PRD is the product contract. Supporting documents supply detail; contradictions must be resolved here before implementation. Named joint owners are recorded in product-decisions.md; production account details and actual sign-offs remain open.

## Problem and audience

TrueCost compares the real cost of home-loan offers before account creation. Results live mainly in the current browser. There is no durable comparison history, report workflow, or lightweight usefulness signal.

**Assumption:** The primary audience is an Indian mobile borrower comparing two home loans, sometimes with weak connectivity. A secondary audience uses Loan health for rate, transfer, or prepayment decisions. Research has not validated either segment.

The first result should remain readable while the user decides whether saving it or continuing is worth creating an account.

## Goals

1. Let a guest complete one useful comparison of two valid loan offers and see the full result.
2. Invite sign-in on the full result, then require it only to save, compare again, or download a report.
3. Resume the intended action after authentication without losing the comparison.
4. Give members durable, private comparison history and downloadable reports.
5. Collect optional, contextual feedback after a comparison result or Loan health suggestion.
6. Preserve the browser finance engine, Loan health, and prepayment tools.

## Non-goals for this release

- Insurance or term-cover features.
- Paid plans, subscriptions, or a revenue model.
- Live lender quotes, lender integrations, commissions, or product sales.
- OCR, document upload, or automatic extraction from sanction letters.
- Replacing the calculation engine with server-side finance calculations.
- Sending loan amounts, rates, fees, lender names, results, comments, or other finance content to Mixpanel.
- A separate term-insurance product remains deferred. Insurance premiums already included in loan cost calculations remain supported.

Basic error monitoring and alerting are required for production. Sentry is the proposed service, subject to configuration and budget review.

## Accepted D1 launch behavior

The user accepted D1 on 15 September 2026: one guest comparison per browser, sign-in for another/changed-input recalculation, up to three member offers, PDFs, optional feedback, explicit device-data import, private-data locking after offline reload and discarding queued work only after confirmed sign-out. The table retains the concrete implementation specification; privacy retention and operational targets below remain separate proposals.

| Decision | Proposed default | Consequence |
| --- | --- | --- |
| Guest allowance | One successful comparison of two offers per browser profile | A soft gate, bypassable by clearing storage; no fingerprinting |
| Member comparison | Two or three offers | Preserves the existing three-offer capability |
| New comparison | Open a fresh two-offer draft after auth; copying the previous inputs is a separate explicit action | The prior result remains intact |
| Changed-input recalculation | After auth, calculate the preserved edited draft | Never replace the user's edited inputs with blank offers |
| Authentication, confirmed | Clerk email OTP only for launch | Phone sign-in deferred by explicit user decision |
| Reports | Client-generated PDF from an immutable snapshot | No server report storage; include a print fallback |
| Feedback | Inline after the member result or suggestion, once per version | Optional Yes/No, optional comment, dismissible |
| Local data adoption | Offer explicit import of the selected device record after sign-in | Never silently attach a shared-device record to an account |
| Private offline work | Queue while an already-authenticated tab remains active; lock private data on reload until identity is verified | Guest calculator stays available offline after assets have been cached |
| Session exit | Warn about queued work; preserve it if the user stays, discard it locally if they confirm sign-out | No private record or outbox remains available to the next device user |

Fresh authentication, cloud history retrieval, account export and account deletion require connectivity. A current verified member tab may generate a PDF from an already-loaded snapshot offline if the report assets are cached. A cold offline launch offers the guest calculator; it does not unlock private records using a locally stored account ID.

## Outcome scenarios

- **First value:** Given two valid offers, when guest calculation succeeds, then the full result and a non-blocking sign-in invitation appear together.
- **Invalid attempt:** Given invalid input, when calculation is attempted, then validation appears and the allowance remains unused.
- **Save intent:** Given a visible guest result, when Save is chosen and auth succeeds, then that result is restored and saved once.
- **Cancelled auth:** Given an auth prompt, when auth is cancelled or fails, then the result remains available.
- **Offline save:** Given a member loses connectivity, when they save, then TrueCost shows a queued state and confirms account storage only after server acknowledgement.
- **Private history:** Given two members, when either requests the other's record, then access is denied.
- **Feedback:** Given a new member result, when feedback is dismissed or submitted, then it does not block work or reappear for that version.

Browser storage remembers the guest allowance; clearing it or using private browsing bypasses this soft gate. **Proposal:** Sorting, expanding, and reopening the unchanged first result remain free. Changed-input recalculation is another comparison and requires authentication.

## Functional requirements

### P0: required for the first release

**FR-01: First guest comparison**  
A guest can compare two home-loan offers without authenticating. Completion requires two valid offers and a successful result. Errors, abandonment, and pre-result refreshes do not count. The full verdict, table, notices, and breakdown remain visible with a dismissible sign-in invitation.

**FR-02: Guest action gate**  
After the first result, Save, Download, changed-input recalculation, and New comparison require authentication. The prompt names the intended outcome. Cancelling preserves the result. Browser storage remembers the allowance across ordinary visits. Sorting, expanding, and reopening the unchanged result stay available. Members are exempt.

**FR-03: Authentication and return**  
The approved identity service and launch method are Clerk email OTP. Phone sign-in is deferred. The upstream Supabase/demo UI is an implementation baseline, not the production identity solution.

Acceptance: successful auth restores the comparison and resumes the intended action once; refresh does not repeat it. Failed, expired, or cancelled auth preserves local work. Production membership requires a verified Clerk identity; on-screen demo codes and local demo sessions cannot grant it. Missing provider settings leave private operations unavailable, with guest comparison still usable.

**FR-04: Saved comparison history**  
Members can save and reopen comparisons. A saved comparison is a separate record from the existing saved loan used by Loan health.

Acceptance: each record is an immutable input/result snapshot with calculation version and creation time. Convex enforces ownership on every operation. Opening it reproduces the snapshot, including after an engine update. The UI claims account storage only after server acknowledgement. Repeated clicks, retries and reload recovery create one record for one save request. History is newest-first and paginated; an old snapshot is never silently recalculated.

**FR-05: Offline-safe save**  
Comparison work survives weak or missing connectivity.

Acceptance: browser calculation continues. A member can queue an account-scoped, idempotent save that survives an accidental refresh. The UI distinguishes local queueing from account storage. A reloaded queue is locked until the same account is verified online. No outbox item or late network response can cross accounts. Auth expiry pauses sending. Recoverable errors retry with bounded backoff; invalid input, denied access and revision conflicts need explicit resolution. Storage-full/private-mode failures must not claim local persistence. Fresh offline auth fails clearly without losing the guest comparison.

**FR-06: Downloadable report**  
A member can download a report for the current or saved comparison.

Acceptance: the proposed PDF uses the on-screen snapshot and includes offers, assumptions, effective APR, cost comparison, warnings, calculation date/version, and an estimate disclaimer. Currency glyphs, page breaks and long lender names must remain readable on the supported phones. Download starts through a fresh user action after asynchronous auth/generation if the browser requires it. Failure preserves the comparison and offers Retry or Print. Browser download initiation is observable; completion to disk is not. The report does not claim lender approval, a guaranteed saving or a regulatory certification.

**FR-07: Optional feedback**  
Signed-in members may give feedback after a successful comparison and/or a Loan health suggestion.

Acceptance: members see a dismissible yes/no question with an optional comment of at most 1,000 characters. It never blocks work, includes feature/result/version context without finance values, and appears at most once per result or suggestion version. Guests do not see it. Server acknowledgement determines submission; failure retains the draft for retry. Text is rendered safely and kept out of analytics. Prompt users not to include account numbers or other sensitive details.

**FR-08: Existing behavior preserved**  
Loan health, rate checks, transfer analysis, prepayment analysis, comparison calculations, and local persistence continue to work.

Acceptance: existing finance fixtures do not change without a reviewed finance decision. Saved comparisons never overwrite the saved loan. Supabase test code transitions to Clerk and Convex without server import; device data remains available for explicit adoption. Member-only Loan health/rate/transfer/prepayment access remains the intended configured policy. Legacy local-only loan data can be exported or adopted without silently discarding it. New production auth configuration fails closed for private operations, while the guest calculator remains usable.

**FR-09: Product analytics**  
Mixpanel measures the agreed funnel using the event definitions below.

Acceptance: test events prove the triggers, identity transitions and deduplication rules. Only acknowledged writes count as saved comparisons. Analytics failure does not block product use. Financial values, contact details, OTPs and feedback text are excluded; autocapture and session recording remain off.

**FR-13: Error monitoring and operational visibility**  
Promoted from the earlier P1 recommendation to a production requirement. Capture scrubbed application errors, failed background jobs and failed saves, tagged by release/environment and a non-financial error code. Disable session replay and request-body capture. Alert the assigned operator and prove delivery with a synthetic failure. Analytics and error-monitoring failures must not stop calculation or saving.

**FR-14: Account lifecycle and data controls**  
Members can request a machine-readable JSON export of their saved comparisons, saved loan and feedback. Verify ownership and recent authentication for export/deletion; include schema versions and timestamps. Account deletion requires a clear confirmation, revokes application access immediately on accepted request and runs a resumable cleanup across Clerk, Convex and analytics. Show completion only after required live-system deletions are acknowledged. A support path covers provider outages. See the proposed retention policy below.

**FR-15: Record deletion and conflict recovery**  
Members can delete individual comparisons and their saved loan independently. Confirm destructive actions. Offline deletion is shown as pending, not complete, and hides the record locally. Server deletion prevents older queued saves from resurrecting it. Concurrent edits to a saved loan show a conflict with choices to keep the cloud version or explicitly resubmit the local version; no silent last-writer-wins. Immutable comparison snapshots need no merge.

**FR-16: Shared-device isolation**  
Sign-out clears private screen state, query caches, account-scoped storage, queued operations and temporary report URLs on that device. Explain unsynced work before confirming sign-out. Cross-tab sign-out and account switching invalidate stale callbacks. No cached authenticated page may reveal the prior member's information. A guest result is adopted only through an explicit Save action; importing a legacy saved loan needs a separate choice.

**FR-17: Financial accuracy and provenance**  
Every calculation snapshot records normalized inputs, assumptions, engine version and calculation time. A finance reviewer checks independent reference examples covering reducing/flat rates, zero interest, month/year tenure, upfront/financed insurance, fees/GST, rounding, invalid cash flows and transfer/prepay break-even behavior. Screen and PDF values match exactly at displayed precision. Define rounding and input bounds before coding new contracts; preserve internal precision. Missing APR is explained, never displayed as zero.

Benchmark and tax assumptions need a source, effective date, last review date and assigned reviewer. Verify current authoritative material before release; do not label a bundled historical rate as today's rate without evidence. If a benchmark is stale or unavailable, disclose that and suppress the dependent recommendation, while keeping user-entered calculations available. The current benchmark table ends in December 2025 and setup contains a hardcoded fallback; both need review. No current rate is asserted by this PRD.

**FR-18: PWA installation, caching and updates**  
Provide a working manifest, icons, public offline fallback and tested update behavior. Cache only approved public static resources. Auth/session endpoints, private navigation responses, data APIs and account exports must be excluded. Retire old caches without wiping unrelated origins' caches. Preserve drafts before applying an update; verify upgrades from the current service worker. Explain unavailable offline actions without a blank screen or endless spinner.

**FR-19: Trust, help and legal content**  
Publish accurate privacy, terms, calculation-methodology and support pages before launch. Existing copy that says financial data never leaves the device must describe the new explicit account-saving behavior. State estimates, assumptions and lender-verification limitations near results and in reports. Assign a legal/privacy reviewer to decide applicable jurisdictions, notices, user rights and vendor terms. Documentation is not a compliance certification.

**FR-20: Abuse and cost controls**  
Validate all write payloads and bound comment size, snapshot size, query pages and save/export rates. Define retryable limit errors that preserve local work. Apply provider auth abuse controls and server-enforced write/export throttling; record the chosen limits after pilot volume testing. Alert on unexpected usage and agree provider spending limits before production. The guest allowance is a product rule, not protection against backend abuse.

**FR-21: Feedback review and support operations**  
An assigned product/support role reviews feedback at least twice a week during the pilot. Review happens through a least-privilege internal path, not a public list-all-feedback endpoint. Record issue category, owner and disposition. Support uses pseudonymous references and never asks users to send OTPs or full loan documents for routine troubleshooting.

**FR-22: Safe release and recovery**  
Separate development, preview and production identity, databases, keys and analytics. Prove backup restoration, frontend/backend compatibility and a rollback procedure before public launch. Feature controls can disable new account writes, reports or analytics independently while preserving the guest result. Every release records its version, checks, approver and recovery evidence.

### P1: follow after the core flow is stable

**FR-10:** Rename saved comparisons and add search or alternative sort orders; newest-first listing is P0.  
**FR-11:** Add a direct Download shortcut to the history list without opening the saved-result view. FR-06 already requires downloading from the opened saved comparison; that capability remains P0.  
**FR-12:** Let members remove individual feedback submissions if product policy requires it; account deletion already includes feedback.

## Conceptual data model

- **User:** Clerk subject ID, created time, and minimal account metadata needed by the product.
- **Comparison:** ID, owner ID, created time, optional title, calculation version, source context, and status.
- **Comparison snapshot:** Normalized offer inputs plus derived comparison result. This is distinct from the mutable comparison currently in browser storage.
- **Saved loan:** Existing Loan health record, owned and versioned separately from comparisons.
- **Feedback:** ID, owner ID, feature context, result or suggestion ID, yes/no answer, optional comment, creation time, and deduplication key.
- **Outbox item:** Local account ID, operation type, payload, idempotency key, created time, retry state, and last error.
- **Guest allowance:** Browser-local completion marker and schema version. It is a convenience control, not a security boundary.

## Retention and deletion policy targets

DEC-009 accepts these implementation targets on 16 September: saved loans/comparisons until deletion, feedback 12 months, analytics 90 days, error logs 30 days and live account cleanup within 7 days. Provider capability, jurisdiction and contract review remain release gates. Local stale-cache expiry, backup retention and deletion-ledger retention below remain proposals; they were not included in that decision.

| Data | Implementation target / proposed action where noted |
| --- | --- |
| Saved comparisons and saved loan | Until the member deletes them or closes the account |
| Feedback text | 12 months, then delete or produce a truly anonymous aggregate; account deletion applies sooner |
| Mixpanel events | 90 days; confirm event/profile deletion coverage and chosen project capability |
| Scrubbed error logs | 30 days; never include loan content |
| Local private cache/outbox | Clear on confirmed sign-out/deletion; lock on auth expiry; discard locked stale work after 7 days with notice |
| Guest work | On device until cleared; explain browser eviction and provide explicit reset |
| Account deletion | Access blocked when accepted; complete live-system cleanup within 7 days; escalate failures before that deadline |
| Backups | Proposed: at most 30 days; no routine access to deleted data and replay deletion records before a restore serves users |
| Deletion/retry evidence | Proposed: minimal opaque identifiers and status, no payload; retain until all affected backups expire plus a 7-day recovery margin |

An external file already downloaded by the user cannot be recalled by TrueCost. Provider-managed identity/security records and required legal retention must be disclosed separately if they differ from these proposals. If a selected plan cannot enforce a duration, change the plan or get an explicit policy revision before launch.

## Analytics and event definitions

Mixpanel receives only these events when consent permits; core functions work without analytics.

1. `comparison_started`: first meaningful edit in a new comparison. Deduplicate by pseudonymous visitor plus draft ID.
2. `comparison_completed`: first successful result for a draft and calculation version. A changed-input recalculation uses a new result ID.
3. `auth_prompt_viewed`: gate shown, with action `save`, `download`, or `compare_again`. Deduplicate by result ID and action per session.
4. `auth_completed`: successful auth, with entry action and method category only.
5. `comparison_save_status`: stage `attempted`, `queued`, or `failed`, deduplicated by request ID and stage. A retry keeps the same request ID and does not create a new attempt.
6. `comparison_saved`: Convex acknowledges the write. Emit once per request ID. This is the only event counted as a confirmed account save.
7. `report_generation_status`: stage `requested`, `generated`, or `failed`, deduplicated by request ID and stage. Generated means the report file is available to hand to the browser.
8. `report_download_initiated`: the download is handed to the browser, once per request ID. It does not prove the user saved a file to disk.
9. `feedback_submitted`: yes/no answer and feature context after server acknowledgement, deduplicated by feedback key. Comments stay in Convex.
10. `auth_intent_resumed`: success/failure of the original gated action. Save success means server acknowledgement; download success means report ready. For `compare_again`, include mode `new` (fresh draft ready) or `recalculate` (preserved edited draft successfully calculated). Deduplicate by auth flow/action/status. This measures recovery separately from authentication success.
11. `web_vital`: finalized LCP, INP or CLS measurement for consented field-performance checks, with metric ID, unit-correct value and device class. No interaction text or DOM/finance content.

Exclude finance fields, lender, results, report content, free text, email, phone, OTPs, tokens, raw URLs, and raw auth identifiers. With consent, pre-auth events join to a server-issued pseudonymous analytics ID, never the Clerk subject. Reset analytics identity on logout. Tracking starts only after optional opt-in, with equally accessible decline and withdrawal. Do not replay pre-consent activity. The [analytics plan](analytics-plan.md) defines event contracts, consent, identity and metric windows.

## Trust, access, offline behavior, and deletion

Auth prompts explain the immediate benefit and never imply accounts improve calculations. Clerk authenticates; Convex authorizes every record operation. Client route guards are presentation only.

Local data is account-scoped, locked when identity is unverified, and cleared on confirmed sign-out. Comparison deletion removes server, cache, outbox, and app-managed temporary report copies; downloaded files on the user's device are outside the app's control. Saved-loan deletion stays separate. Failed provider cleanup remains a visible pending operation with an operator, not a false success message.

## UI states

Cover guest allowance available/used; completed result; each gate; auth pending/failed/cancelled/complete; restored result; history empty/loading/populated/failed; save queued/acknowledged/failed; download generating/ready/failed; feedback dismissed/submitted/failed; sign-out; and deletion.

Controls are keyboard accessible, labelled, readable at mobile zoom, and honest about sync state. Content is visible without animation.

## Quality and verification

All targets below are proposed release requirements, not measured results. QA records device/browser versions, network conditions, build version and evidence. A failed P0 check blocks release until fixed or the affected feature is explicitly removed from launch scope.

| ID | Requirement and acceptance evidence |
| --- | --- |
| NFR-01 | Target WCAG 2.2 AA: full keyboard and screen-reader core flows, visible focus, labelled errors, contrast of 4.5:1 for normal text and 3:1 for large text/UI indicators, 200% text resize and 320 CSS-pixel reflow checks. No essential content depends on motion; reduced-motion mode works. Test comparison-table alternatives for small screens. |
| NFR-02 | Target p75 LCP <=2.5 s, INP <=200 ms and CLS <=0.1 on mobile and desktop. Before field data exists, record representative lab loads and scripted interactions; never present lab scores as field evidence. Measure field results during pilot and document sample coverage. |
| NFR-03 | Representative two/three-offer calculation completes within 200 ms at p95 over 30 runs on the recorded midrange Android test device, with a 20-year example; financial outputs must remain correct. PDF generation target <=5 s for that fixture. |
| NFR-04 | Online save acknowledgement p95 <=3 s across 50 seeded requests on recorded 10 Mbps/150 ms-RTT conditions. Offline queue survives reload; retry, duplicate, auth-expiry and conflict scenarios pass without data loss or crossover. |
| NFR-05 | Current and previous major stable Chrome/Edge/Firefox and macOS Safari; Android Chrome and iOS Safari. Verify installed PWA mode where supported, plus fresh install, ordinary tab use and upgrade from the current service worker. Record exact tested versions in release evidence. |
| NFR-06 | No unresolved critical/high security finding in authentication, ownership, private caching, input handling or dependencies on the release path. Test two accounts, forged owner IDs, stale tokens, direct IDs, malicious feedback strings and repeated requests. |
| NFR-07 | Proposed recovery point <=24 h of data and recovery time <=4 h. Demonstrate restore in an isolated environment, including schema/code/config compatibility and deletion replay. Confirm plan support before adopting these targets. |
| NFR-08 | During pilot, review errors daily. Any incorrect financial result, cross-account disclosure, deleted-data resurrection or reproducible loss of an acknowledged save blocks expansion and triggers incident handling. Operational owner acknowledges critical alerts within 30 minutes during declared coverage. Public launch requires an assigned coverage plan. |

Accessibility and field-performance criteria refer to [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Core Web Vitals](https://web.dev/articles/vitals). The chosen numerical app/recovery targets are team proposals, not vendor guarantees.

- Unit-test quota counting, intent resumption, event deduplication, outbox isolation, and ownership.
- Integration-test result visibility, gates, auth recovery, server acknowledgement, offline recovery, deletion, and feedback.
- Preserve finance fixtures and confirm no calculation drift.
- Test authorization with two accounts and direct record-ID attempts.
- Match report figures to the snapshot; test Indian currency, print layout, and mobile download handoff.
- Test controls by pointer and keyboard, then run type checking, all tests, and a clean production build.

## Dependencies, rollout, and risks

**Dependencies:** Clerk methods, Convex ownership, Mixpanel consent, report format, and preserved device data.

**Proposal:** Verify in preview with synthetic data, then invite a controlled pilot only after privacy/security and financial P0 gates pass. Review reliability, support and consented funnel data before wider release. Pilot size, dates and success thresholds are unapproved. Rollback keeps browser calculation and the first result usable, and must not reopen obsolete Supabase auth or erase records.

Roles needed: product decision owner, engineering/release owner, QA reviewer, finance-methodology reviewer, privacy/legal reviewer, and support/on-call owner. One person may hold several roles, but each gate needs an actual named person and evidence. A role name alone is not sign-off. Provider accounts, regions, production domain/email, budget, privacy text and restore evidence remain launch dependencies.

Risks are lost auth intent, false save acknowledgement, cross-account access, analytics leakage, record confusion, and soft-gate abuse. Ownership tests, account-scoped storage, explicit sync states, and analytics allowlists are launch conditions.

## Success metrics

Definitions can be implemented now; product outcome targets are TBD until baseline data and a decision window exist. The [analytics plan](analytics-plan.md) supplies the exact cohort windows, exclusions and consent coverage for the summaries below. NFR quality targets above are separate proposed release gates.

- **Guest completion:** completed guest drafts / started guest drafts.
- **Value-to-auth:** gated guests who authenticate / unique gated guests.
- **Intent recovery:** resumed actions completed / successful gated authentications.
- **Save success:** unique `comparison_saved` request IDs / unique attempted save request IDs, split by immediate and queued paths.
- **Report generation:** generated / requested report request IDs. Report browser handoff separately; disk saves are unobservable.
- **Feedback usefulness:** yes / yes-or-no submissions by feature.
- **D7 repeat comparison:** consented members completing another comparison 168 to 192 hours after their first authenticated completed comparison / eligible members in that first-comparison cohort. Only include cohorts with the full observation window. This proposed definition measures repeated comparison value; history-only visits require a separate future measure.
- **Guardrails:** zero blocked analytics fields and zero cross-account access or sync.

## Open questions

### Required decisions before the affected build phase or release

1. **D1, resolved by user:** Launch defaults accepted as recorded above and in product-decisions.md. Implement and verify them without requesting the same approval again.
2. **D2, resolved by user:** Clerk email OTP only; phone sign-in deferred. Engineering still must verify real delivery, auth return and production configuration.
3. **D3, Privacy + Product, before real-user pilot:** Audience is registered users in India. Rajesh and Ritesh own privacy review; approve notices, consent, retention, account export/deletion and vendor terms/regions. Audience and owner selection do not establish compliance.
4. **D4, Release owner, before affected setup/public launch:** Rajesh and Ritesh own release/support and the monthly service budget is ₹0/free plans only. Confirm production domain/support address, accounts, coverage and access rights. Fresh development Clerk/Convex setup is authorized. Prove recovery targets within free-plan entitlements or raise the concrete gap before release.
5. **D5, Finance reviewer, before result release:** Rajesh and Ritesh review and approve the methodology, current sources, freshness rule and regression fixtures. Disable any unsupported current-rate claim until resolved.
6. **D6, Product, before pilot invitation:** Set pilot cohort, date, baseline window and numeric outcome targets. Research evidence is currently absent; operational P0 gates apply regardless of conversion targets.

The implementation roadmap may proceed under accepted D1/D2 and the invoked goal. Production remains blocked until the [launch gates](launch-checklist.md) have real evidence and sign-off.

## Assumption register

| ID | Assumption | How to resolve |
| --- | --- | --- |
| A1 | The core guest is an Indian mobile borrower comparing two home loans. | Interview and observe target borrowers. |
| A2 | One successful pair comparison is enough value before the gate. | Measure the funnel and test comprehension. |
| A3 | A browser-local quota is an acceptable first control. | Product and abuse-risk decision. |
| A4 | Client-generated PDF is the expected report format. | Approve format and bounded offline policy, test on phones. |
| A5 | Optional yes/no feedback after a result is acceptable. | Usability test timing and fatigue. |

## Evidence ledger

| ID | Type | Evidence and use |
| --- | --- | --- |
| E1 | Fact | Repository inspection confirms framework versions, finance flows, browser storage, and optional Supabase code. |
| E2 | Requirement and direction | The user supplied guest comparison, post-result sign-in/sign-up for saving/further comparisons/reports, and member feedback requirements. The user requested Clerk, Convex and Mixpanel planning and confirmed Supabase is unused/test, so no server-data import is needed. |
| E3 | Implementation contract with open release decisions | The active goal authorizes local implementation of preserved auth intent, history, snapshots, accepted recalculation/PDF behavior, outbox and consented instrumentation. Retention durations, production regions, recovery targets and rollout still require the recorded owner decisions and acceptance evidence. |
| E4 | Historical planning constraint | The earlier documentation pass excluded implementation and external changes. The active goal now authorizes local implementation and fresh development setup; insurance, paid plans, live quotes, OCR and invented evidence remain excluded from this release. Explicit device-data adoption is required; Supabase server import is unnecessary. |
| E5 | Historical | Earlier repository readiness checks passed 129 tests, type checking, and build in an isolated install; not rerun for this document. |
| E6 | Gap | Research, baseline, revenue, deadline and approved product outcome targets are absent. Retention and quality targets have proposed values in v1.0 but remain unapproved. |
| E7 | Historical requirement | The user requested additions needed to ship a production-ready app. v1.0 added lifecycle, sync recovery, finance provenance, PWA, operations, privacy, quality and release acceptance requirements during a documentation-only pass. Implementation is now authorized through the active goal. |
| E8 | Fact | The current service worker broadly caches successful same-origin GET responses; the account screen still describes device-only comparisons. Both need changes before the proposed private cloud features launch. |
| E9 | Verified upstream | Main `b9e53c0` adds email-only UI and disclosed on-device demo OTP; `557dcb1` renames features. CI passed 137 tests, typecheck and build. The local checkout remains at `2cf936a` until TASK-001; production auth and the planned integrations remain incomplete. |
| E10 | Confirmed user decisions | Production readiness before Demo Day; Clerk email OTP only; the goal is now active for local work and fresh development Clerk/Convex setup, with production publishing separately approved. Requested models: Astra xhigh and Luna high execution. |
| E11 | Direct user answers, 15 September 2026 | D1 launch defaults accepted; pilot audience is registered users in India; budget discussions use INR, with numeric ceiling and named sign-off owners still open. See product-decisions.md. |
| E12 | Subsequent direct user answers, 15 September 2026 | Monthly services limited to ₹0/free plans. Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review. This resolves E11's missing names/budget, not the actual review or publication gates. |

## Revision review

v1.0 addresses the production gaps identified in the prior PRD review. FR-13 is now P0; FR-14 through FR-22 and NFR-01 through NFR-08 define the additional acceptance work. P1 enhancements remain deferred. Unknown provider/legal/product decisions are release gates rather than invented approvals. Completion evidence belongs in the launch checklist, not in unchecked statements in this PRD.
