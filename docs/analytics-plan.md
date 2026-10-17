# TrueCost analytics and measurement plan

Current evidence and remaining checks: [Analytics acceptance](analytics-acceptance.md).

Status: Partial development verification, 18 September 2026. Fresh-member comparison, save, feedback and PDF flow passed 15 live development checks. Consented guest-to-member joining passed 10 live checks, with six acknowledged events independently visible together in the Mixpanel member activity feed. These synthetic checks establish tested behavior, not product traction. Shared-device/account transitions, complete consent lifecycle, denominator reconciliation and provider retention/deletion remain open. Implements PRD FR-09, FR-13, FR-14, FR-20, FR-21 and NFR-02. [PRD](prd.md) governs scope; [launch checklist](launch-checklist.md) records evidence.

Implementation is explicitly tracked as P0 **TASK-015: Mixpanel analytics** in the [roadmap](product-roadmap.md). Tracking remains disabled in the hosted review app and normal local configuration; live delivery was tested in the dedicated development configuration. Complete the remaining consent lifecycle, account-transition, denominator and provider-lifecycle checks before reporting this task complete.

## Decisions the data should support

Determine whether guests reach a useful result, whether account creation preserves that result, and whether saving, reports and feedback work. Product conversion rates help prioritize improvements; they do not prove financial accuracy or privacy. Use seeded tests and operational evidence for those obligations.

Product owns definitions and dashboard review. Engineering owns the tracking wrapper, identity and delivery tests. Privacy approves consent, residency and retention. Rajesh and Ritesh are the joint review owners; recorded ownership does not establish completed review.

## Consent and identity contract

Proposed policy: analytics is optional and off until affirmative opt-in. Show equally accessible Accept and Decline choices and an Account privacy setting to withdraw. Do not send an analytics event describing a refusal. Keep a minimal local preference/version without creating a tracking identifier before consent. Account functions must work when declined, blocked or unavailable.

After opt-in, create a random analytics-only anonymous identity. When Convex verifies the signed-in user, obtain a server-issued random analytics account ID and join only that visitor's consented activity to it. Never hash an email or use a Clerk subject as the analytics ID. Anonymous consent cannot silently authorize tracking a different member on a shared device; reset the context and apply that member's preference. Do not replay activity performed before consent.

On logout, account switch, consent withdrawal or deletion: stop sending, clear pending analytics batches and account properties, reset identity, then restore the applicable opted-out state. Consent withdrawal removes pending events; account deletion also requests deletion of historical identifiable events/profiles using the provider's supported process. Track deletion acknowledgement in the operational job, not in Mixpanel. An identity reset alone does not delete historical events.

Implementation must explicitly disable autocapture, automatic pageviews, heatmaps and session replay. Disable IP-derived geolocation and remove SDK-added URLs/referrers, campaign parameters and other unapproved properties. Verify the actual network payload, including SDK defaults. Choose the endpoint matching the approved project region. The [Mixpanel JavaScript documentation](https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript) describes opt-out, identity reset, default-property controls and regional configuration. The [privacy documentation](https://docs.mixpanel.com/docs/privacy/protecting-user-data) informs the provider review.

Proposed event retention is 90 days. Confirm provider plan settings and full event/profile deletion coverage before real-user tracking. No profile enrichment, advertising integrations or cross-product tracking in this release.

## Allowed event envelope

Use one wrapper with runtime validation. Unknown events/properties are rejected rather than spread from component objects. The same rule applies to queued or server-originated events.

| Property | Allowed value |
| --- | --- |
| `event_version` | Integer, initially 1 |
| `environment` | `development`, `preview`, `production` |
| `release` | Application release identifier |
| `auth_state` | `guest`, `member` at event time |
| `feature` | `comparison`, `loan_health` |
| `route_name` | Fixed enum such as `compare_results`, never a URL |
| `session_id`, `draft_id`, `result_id`, `flow_id`, `request_id` | Random analytics correlation tokens; no database IDs, loan content or user-entered strings |
| `event_id` | Stable random event identity reused on delivery retry; map to the SDK ingestion deduplication field |
| `occurred_at` | Event time; retain original occurrence time across delivery retries |

Each event permits only relevant correlation fields. Member identity is supplied by the controlled identity layer, not by arbitrary callers. SDK transport metadata must also be audited; an allowlist on custom properties alone is insufficient.

Never send principal, income, rate, tenure, fees, tax, lender, input hashes, result values, report contents, comments, email, phone, OTP, auth tokens, Clerk IDs, record IDs, query strings or raw exception messages. Only enum error codes are permitted: `network`, `auth_required`, `validation`, `conflict`, `limited`, `storage`, `unknown`.

## Event contracts

All fields below are additional to the restricted envelope. Counts deduplicate by business identity as well as delivery identity. Renders, route revisits and retries do not create new business events.

| Event | Trigger and extra fields | Count/deduplication rule |
| --- | --- | --- |
| `comparison_started` | First meaningful input edit in a draft | Once per draft; blank renders excluded |
| `comparison_completed` | Successful calculation with at least two valid offers; `offer_count`: 2 or 3, `calculation_version` | Once per result. Changed inputs create a new result; sorting/opening does not |
| `auth_prompt_viewed` | User sees the action gate; `action`: `save`, `download`, `compare_again`; for compare-again, `mode`: `new` or `recalculate` | Once per result/action/mode/session; the passive invitation is not a gate impression |
| `auth_completed` | App receives verified member context after auth; `action`: gate action or `direct`, `method`: `email` only for this launch | Once per auth flow; token refresh excluded |
| `auth_intent_resumed` | Intended action reaches its defined outcome; `action`, compare-again `mode`, `status`: `succeeded` or `failed`, optional enum `error_code` | Once per flow/action/status. Save success means server acknowledgement; download success means report ready; mode `new` means fresh draft ready; mode `recalculate` means preserved edited draft calculated |
| `comparison_save_status` | `stage`: `attempted`, `queued`, `failed`; optional enum `error_code` | Once per request/stage. Retries keep the same request ID |
| `comparison_saved` | Convex acknowledges the snapshot write; `path`: `immediate` or `queued` | Once per request, including recovery of an earlier successful write |
| `report_generation_status` | `stage`: `requested`, `generated`, `failed`; `source`: `current`, `saved`; optional enum `error_code` | Once per request/stage. Generated means file is ready, not that it reached disk |
| `report_download_initiated` | A user action hands the ready file to the browser | Once per download request; cannot measure completed disk save |
| `feedback_submitted` | Server acknowledges Yes/No; `answer`: `yes`, `no`, `context_version` | Once per feedback submission; no comment or comment-presence property |
| `web_vital` | Finalized browser measurement; `metric`: `LCP`, `INP`, `CLS`, `value`: finite non-negative performance value, `metric_id`: random measurement ID, `device_class`: `mobile`, `desktop` | One final value per metric ID. Units: milliseconds for LCP/INP, unitless CLS. No interaction text, DOM selector or finance data |

The extra `auth_intent_resumed` event closes a measurement gap in v0.1: an authentication success by itself cannot prove the requested action resumed. If a queued save succeeds in a later session, retain its original flow token only while consent remains valid.

Delivery is best-effort, bounded and never blocks the product. A proposed analytics-only queue expires after 24 hours and drops on consent withdrawal/account switch. An expired/missing event is missing evidence, not proof the product operation failed. SDK deduplication does not replace application deduplication. Use separate test and production projects where possible; filter environment regardless.

## Metrics and dashboard

Proposed reporting: weekly cohorts in UTC, with daily pilot reliability review. Show raw numerator/denominator, consent coverage and observation window with every percentage. Distinguish zero events from an unconfigured/broken pipeline. Numeric conversion targets await D6; do not invent a passing conversion rate.

| Measure | Exact working definition |
| --- | --- |
| Guest completion | Guest drafts with a completed result within 24 hours of first start / guest started drafts with a full 24-hour observation window |
| Value-to-auth | Gated consented guest flows with `auth_completed` within 30 minutes / consented gated flows, deduplicated by result/action/mode/session |
| Intent recovery | Successful `auth_intent_resumed` / gated `auth_completed`, by action. Report <=5-minute recovery separately from <=24-hour deferred saves |
| Confirmed saves | Unique acknowledged request IDs / attempted request IDs, with a full 24-hour window; split immediate/queued paths. Pending requests remain visible |
| Report generation | Generated request IDs / requested request IDs within 5 minutes; show browser handoff / generated separately |
| Feedback usefulness | Yes / (Yes + No), by feature; show submission count and disclose self-selection |
| D7 repeat comparison | Consented members with another completed calculation from 168 through less than 192 hours after their first completed calculation performed as a member / eligible members whose full window elapsed |
| Financial/privacy guardrails | Zero known incorrect outputs in approved fixtures, cross-account disclosures, or prohibited analytics properties; determined by tests/incidents, not conversion events |

A guest calculation subsequently saved after sign-in does not become an authenticated calculation retroactively for D7. Track its successful intent separately. History-only return visits are outside this initial retention definition. Deleted or withdrawn identities must not be retained solely to preserve cohort counts.

Dashboard panels: first-result funnel, auth return by action, save status including pending, report generation/handoff, feedback split and mature D7 cohorts. Product reviews these twice weekly during the pilot. Delivery gaps and consent selection bias accompany conclusions.

Field performance uses the same consent gate with pseudonymous identity only. Compute p75 per metric, mobile/desktop and release over the approved pilot observation period; report sample count and browser support. Sessions without a valid measurement are excluded and counted as missing. Review LCP/INP/CLS collection semantics against the maintained Web Vitals library during implementation. TBT is a lab responsiveness proxy and must never be labelled field INP.

## Execution review: definitions and instrumentation

Reviewed 15 September 2026 with define-product-metrics and plan-product-instrumentation. The pilot audience is registered users in India. Rajesh and Ritesh own privacy review; outcome targets, console access and operating coverage remain open. These definitions are implementable contracts, not measured results.

The primary value signal is a valid comparison result delivered to a borrower. Completed-calculation events are a proxy for delivery, not proof that the borrower understood the recommendation. The diagnostic sequence is guest completion -> gated auth -> resumed action -> acknowledged save/report; feedback and repeat comparison provide later learning.

All product-funnel denominators use consented eligible activity. The proportion of all visitors who consent cannot be calculated from the consented stream alone. Report overall consent coverage as unknown unless an approved independent, privacy-safe denominator exists; never add nonconsensual tracking to manufacture it.

For version 1, event names and enum properties are closed sets. Correlation IDs must be opaque random UUIDs; reject user-provided labels and database IDs. Integer versions/counts must be finite and in the documented range. Optional properties are omitted, not null; unknown keys are rejected. Performance values remain the explicit numeric exception and may never carry financial measures. Fix launch auth method to email.

Use occurrence time for cohort membership and retain the original event ID/time on retry. Close a reporting window only after its full observation period; identify late/missing data separately. Synthetic acceptance fixtures must include duplicates, retry, cancellation, direct sign-in, queued acknowledgement, opt-out and account switch, with independently counted expected results.

Investigate missing/duplicate events before interpreting conversion changes. Any forbidden payload or cross-account identity join disables tracking until corrected and verified. Do not set a conversion-based ship gate without D6 baseline and target approval. Review event schemas with their metric dependency; incompatible changes increment event_version, update fixtures and name the version in dashboards before old events are retired.

Implementation owner: assigned Luna executor with root review. Product/privacy approvers and support owners: Rajesh and Ritesh; review completion and coverage details remain open. SDK and dashboard verification remains TASK-015 and all acceptance boxes below remain open.

## Error monitoring is a separate channel

Sentry is proposed for errors and release health. Product events stay in Mixpanel; operational alerts must work even when analytics is declined. Privacy must approve a minimal diagnostic policy. Include release, environment and allowlisted error category; scrub request data, URL parameters, breadcrumbs, console data, user metadata and exception strings. Disable replay. Restrict source-map upload credentials and access. Use a synthetic error to verify scrubbing and alert routing before release. No full session or loan payload is needed to diagnose a failed save.

## Acceptance evidence

Implementation preflight, 16 September 2026: the official JavaScript SDK guide
documents default tracking as enabled, `opt_out_tracking_by_default`,
`ip: false`, `property_blacklist`, and region-specific API hosts including India.
The adapter must explicitly configure these controls and inspect the actual
outbound payload; merely validating caller-supplied properties is insufficient.
Defer SDK initialization until consent so it cannot create an identifier first.
Region availability in documentation does not select or authorize a project
region. Keep tracking disabled until the actual project and endpoint are verified.
Source: [Mixpanel JavaScript SDK](https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript).

- [ ] Clean browser with no consent produces zero analytics requests, identifiers or replay data.
- [ ] Accept enables only allowlisted events; decline and withdrawal leave all product actions functional.
- [ ] Guest A signs in as A, signs out, and B signs in: no merged B activity or retained A properties.
- [ ] Sort, refresh, double click, offline retry and auth token refresh do not inflate business counts.
- [ ] Queueing alone never emits `comparison_saved`; recovery from a lost acknowledgement emits it once.
- [ ] Downloads distinguish generation and handoff; popup-blocked flows show a fresh Download action.
- [ ] Inject synthetic lender names, email, OTP and feedback markers; inspect transport and provider UI to confirm none appear.
- [ ] Test account deletion against event and profile storage, including merged anonymous identity; retain acknowledgement evidence outside analytics.
- [ ] Seed a known funnel with duplicate and missing events; independently compute denominators and compare dashboard results.
- [ ] Verify test/production separation, regional endpoint, 90-day retention feasibility and a documented tracking-disable switch.

These are unchecked requirements. Evidence owner, build, date and results belong in the launch checklist.

## Implementation preflight, 16 September 2026

Current [JavaScript guidance](https://docs.mixpanel.com/docs/tracking-methods/sdks/javascript) confirms separate switches for autocapture, pageviews, replay and heatmaps, regional API hosts, `ip: false` and default-property suppression. TrueCost must also disable marketing capture. The documentation's broad tracking example conflicts with this product's restricted event policy; do not copy it as initialization code.

Inspect the exact installed SDK version before coding. The [API reference](https://github.com/mixpanel/mixpanel-js/blob/master/doc/readme.io/javascript-full-api-reference.md) documents `track_marketing`, `skip_first_touch_marketing`, persistence controls and opt-out options. In particular, `opt_out_tracking` defaults `delete_user` to true: ordinary withdrawal should pass false and clear local persistence, while the separate account-deletion workflow proves historical deletion. An opt-out call alone cannot establish complete historical event deletion.

The [simplified identity model](https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified) merges device and member activity. Our implementation must preserve a consented guest-to-member join only for the same intended session; a shared-device account change clears the former identity first. Use a separate opaque analytics account ID. Dashboard identity propagation may take time, so immediate event ingestion and later funnel reconciliation need separate evidence.

Current next slice: verify live development ingestion, member/report event delivery, identity transitions and dashboard reconciliation. Guest consent browser interception passed six checks on 16 September (docs/evidence/analytics-mixpanel-browser-2026-09-16T13-42-59-635Z.json); it proves the observed outbound contract, not provider ingestion. Load and initialize the SDK only after applicable opt-in. Verify the complete outbound envelope after SDK augmentation. TrueCost Development (project 4064154) was created with user approval on the Free plan, using US storage, Asia/Kolkata reporting timezone and Simplified ID Merge. Its development token is stored only in ignored local configuration; NEXT_PUBLIC_ANALYTICS_ENABLED remains false. The SDK adapter has live guest-ingestion evidence dated 16 September below; member, report and feedback ingestion remain unverified. See mixpanel-development-setup.md. Production region and retention feasibility remain unresolved. TASK-015 stays open.


## Instrumentation integration points reviewed against source

The consent provider precedes CompareProvider in the root layout so a guest-to-member comparison-provider remount does not itself destroy the authorized analytics flow. It must still invalidate tracking immediately when identity changes or the private grant is lost.

| Product operation | Source boundary and required event meaning |
| --- | --- |
| First meaningful offer edit | lib/store.tsx changeDraft/updateOffer. Emit comparison_started once for an edited draft, never on hydration or a blank render. |
| Successful comparison | calculate after the new result is made available. Reopening an unchanged snapshot does not emit comparison_completed again. Accepting consent after an existing result must not backfill its earlier calculation. |
| Guest action gate | requireSignIn after the preservation step succeeds and the gate is actually shown. A failed preparation or passive sign-in invitation is not auth_prompt_viewed. |
| Saving | queueSave records attempted/queued; only a matching server-acknowledged workspace job emits comparison_saved. A restored completed job is not automatically a new save event. |
| Resumed sign-in action | resumeIntent currently completes the product handoff after queueing a save. Analytics must wait for its actual server receipt before reporting successful auth_intent_resumed. New/recalculate outcomes have their own defined success boundaries. |
| Reports | The browser has an explicit Generate → Download flow with snapshot and private-grant lifecycle guards. The report hook now emits requested/generated/failed and download-initiated events using analytics-only attempt IDs. Consent epochs and identity/snapshot checks suppress stale outcomes. Root's focused local report/analytics rerun passed 49 checks on 16 September. Actual outbound payload inspection and Mixpanel ingestion remain unverified; existing PDF evidence does not prove delivery. |

All correlation values sent to analytics are newly issued analytics-only random tokens. Business record IDs may be used only as internal lookup keys, never copied into payloads. Keep retry correlation stable for the same consented operation, with bounded storage/lifetime and explicit clearing on withdrawal or account changes. Cross-reload save recovery and same-flow auth joining require integration evidence; in-memory deduplication alone does not prove them.


## Live development delivery, 16 September 2026
The live browser run at14:26:57UTC passed six checks on local build Cdz2kcm1ZyavMSJ_0JpMe. Both comparison_started and comparison_completed received HTTP200 with provider acknowledgement1. Root independently inspected the TrueCost Development Events UI: exactly two matching events, one opaque device identity, environment development, offer_count2. City, country and OS fields were not set. Stored event properties contain analytics-only correlation values; Mixpanel enriches events with API endpoint/timestamps, event size and raw User Agent. This provider enrichment is separate from the validated outbound allowlist and must be covered in the privacy inventory.
Evidence: evidence/analytics-mixpanel-browser-2026-09-16T14-26-57-220Z.json. No-consent, declined and withdrawn calculations remained usable with zero analytics requests. This verifies guest comparison ingestion only. Member identity joining, save/report/feedback delivery, retention/deletion and dashboard denominator reconciliation remain open. Hosted analytics is still disabled.

## Internal synthetic funnel report
Created within the existing Free project: TrueCost Development - Synthetic verification only, board11529933. URL https://mixpanel.com/project/4064154/view/4560599/app/boards#id=11529933 . Funnel comparison_started -> comparison_completed, unique users, Today, one-day conversion window. The observed synthetic sample reconciles one starting identity and one completing identity (100%, n=1), not a product outcome or pilot conversion claim. Saved within the free five-reports allowance; no upgrade or public sharing. Duplicate/missing-event denominator tests and member funnel reports remain open.

## Feedback instrumentation, 17 September 2026

FeedbackPrompt now emits feedback_submitted only after a submitted/replayed server acknowledgement for a submission begun under accepted consent. A consent epoch and current context/transport check suppress stale callbacks. The payload contains Yes/No, context version and a fresh analytics-only result token; comments and business context IDs are excluded. Collector failure cannot turn acknowledged feedback into a product error. Current comparison results use compare_results, saved comparisons use comparison_detail, and Loan health uses loan.

Nine mounted analytics tests cover the explicit event envelope with a private comment entered, current/saved route labels, failure/dismissal, consent changes, account/context replacement, consent accepted after submission, replay retry and collector failure. Parent full suite passed 1,033 tests across 107 files at 16:04 on 17 September, with separate typecheck passing. These are local integration checks. Actual feedback/save/report delivery to Mixpanel and dashboard reconciliation remain open; normal local and hosted analytics remain disabled.
## Verified member delivery, 17 September 2026

Supersedes earlier statements above that member/save/report/feedback delivery is unverified. The live local development run `evidence/member-analytics-browser-2026-09-17T15-36-25-275Z.json` passed nine checks on build `Nn0k7X9QwMzFnIrEDsKnb`. All nine comparison/save/feedback/report events received HTTP 200 and acknowledgement 1. No additional events were sent after explicit withdrawal or confirmed sign-out in this sequence. Actual saved PDF values matched stored lender, EMI and repayment values.

Mixpanel Events independently displayed 18 individual rows from the two live synthetic runs, with one opaque device identity per run and both feedback events present. This establishes development ingestion for these paths. It does not establish guest/member identity joining, shared-device isolation, correct funnel denominators or provider retention/deletion. Synthetic residual records remain; hosted analytics remains disabled. TASK-015 stays open.

## Member identity discrepancy, 17 September 2026

Read-only expansion of the latest report_download_initiated event in Mixpanel showed auth_state=member and environment=development, but canonical Distinct ID was device-prefixed and the All Properties view did not expose User ID. Outbound evidence records $user_id as present. The adapter currently uses the member analytics ID as device ID when there is no guest identity. These observations do not establish the cause: the official Simplified ID Merge guide allows up to 24 hours for mapping propagation outside the activity feed. Do not treat event ingestion or the member auth_state label as proof of correct identity resolution.

Next verification: capture sanitized equality/correlation assertions from the actual outbound member flow, then inspect its user activity identity and project merge mode. Preserve raw IDs only in memory. Do not change the adapter or project configuration based solely on this observation.

Primary reference checked: https://docs.mixpanel.com/docs/tracking-methods/id-management/identifying-users-simplified (canonical distinct ID and mapping propagation sections).

## TASK-015 provider identity cause isolated, 17 September 2026

The two probe events appeared after ingestion delay. Parent expanded both in Mixpanel Events and independently matched their visible IDs to the hashes captured before transmission. Equal device/user IDs produced a device-prefixed canonical Distinct ID with no User ID property. Distinct IDs produced the expected canonical member ID and visible User ID. The sanitized observation is `evidence/mixpanel-identity-probe-observation.json`.

This reproduces the adapter's fresh-member fallback defect: when there is no consented guest ID, it currently assigns the member ID to both roles. Luna is assigned only the adapter and its tests to create a separate cryptographic device UUID per transport lifetime while retaining valid supplied guest IDs. Until the fix and its runtime acceptance pass, member identity resolution remains a failed acceptance gate despite successful event delivery. Existing synthetic rows are diagnostic history, not pilot metrics.

## Fresh-member identity fix and checkpoint

The adapter now uses a separate random device UUID when a member has no guest identity. Valid guest-join IDs are preserved. The real SDK regression verifies serialized values and lifetime stability. Full suite: 1,034 tests/107 files passed; normal 19-route production build rXZIz1n6RFg7wqRANFs-x passed with TypeScript on 17 September. Corrected application-to-provider browser verification is still pending. Prior delivery evidence must not be relabelled as verification of this newer build.

## TASK-015 corrected member flow passed, 17 September 2026

Live run `evidence/member-analytics-browser-2026-09-17T16-11-26-414Z.json` passed 15 checks on build WYUufvWqH9Q6HoWNK__v_. All nine events were acknowledged. Member IDs stayed equal across the comparison/save/feedback and reloaded history/report flow; two device IDs were observed, each distinct from the member and stable within its page lifetime. Insert IDs were unique; draft/save/report correlations and exact stage counts passed. Saved PDF parity, withdrawal suppression and confirmed-signout suppression passed. Run-owned comparisons and synthetic Clerk account/sessions were deleted; provider/feedback/profile residual cleanup remains unverified.

This completes this bounded fresh-member flow verification, not TASK-015 overall. Consented guest-to-member joining, shared-device switching, denominator cases and retention/deletion still require evidence. Hosted analytics remains disabled.

### Remaining consent transition: next guest after sign-out

Explicitly test that an old accepted guest preference cannot revive tracking after a member withdraws and later returns to guest use. A quiet one-second sign-out observation is not sufficient. This remains part of TASK-015 acceptance, alongside shared-device account switching and provider retention/deletion.

## Guest-to-member analytics verification: 18 September 2026

The authorized Clerk development testing-token flow passed 10 browser checks on local analytics-enabled build GSAY4j5K9ehRo4tBrd1C0. Six synthetic events received HTTP 200/body 1 acknowledgements. Mixpanel's member profile activity feed independently contained all six guest and member events. Evidence: `evidence/member-analytics-browser-2026-09-17T17-14-58-817Z.json` and `evidence/mixpanel-guest-join-observation.json`.

Fixes preserve the validated guest identity and save-action attribution through consent and Clerk reload/hydration, and suppress tracking while authentication is unresolved. Withdrawal and confirmed sign-out suppression passed for this sequence. This does not establish the next guest interaction after sign-out, shared-device/account switching, dashboard denominator reconciliation, or provider retention/deletion. TASK-015 stays open. Synthetic comparison and Clerk-user cleanup does not prove removal of profile/feedback/analytics records. No production authentication settings or deployment changed.

### Withdrawal followed by guest reuse: verified locally, 18 September 2026

The extended development browser harness passed 11 checks on build LQxx6bL8bDMTcotNllltl. After member withdrawal and confirmed logout, it re-entered guest mode, hard reloaded, reopened the original result, and attempted an edited-input recalculation. The recalculation correctly required sign-in; zero additional analytics requests occurred without re-consent. Evidence: `evidence/member-analytics-browser-2026-09-18T09-17-19-872Z.json`. Mixpanel was intercepted in this run; Clerk/Convex development authentication and cleanup were real. This checks suppression, not new provider ingestion.

The initial extended run timed out at landing-page guest entry. Adding the same Clerk-loaded wait used by the initial authentication flow made the next run pass; no navigation implementation changed. That observation supports a harness timing explanation, not a general landing-page reliability claim. Ordinary accepted-member logout without withdrawal, account switching, storage-unavailable reload behavior, denominator reconciliation and provider retention/deletion remain unverified. TASK-015 stays open.

### Ordinary logout without withdrawal: browser verified, 18 September 2026

Evidence `evidence/member-analytics-browser-2026-09-18T09-41-43-554Z.json`: all 11 checks passed on analytics-enabled local build w03OYdGRzIW1De6QUDKUx. The member still had accepted consent immediately before confirmed logout. After returning as guest and hard reloading, reopening the original result and attempting edited-input recalculation sent zero new analytics requests. Recalculation correctly required sign-in. Mixpanel was intercepted; Clerk/Convex development authentication was real. Run-owned comparisons and the disposable Clerk user/sessions were deleted; profile/feedback/analytics residual removal is not established.

Actual AuthProvider tests cover delayed successful logout and rejected logout. Storage tests cover retaining declined preference, preserving a retry marker when accepted preference cannot be removed, and fallback revocation when marker writes fail. Temporary scope loss does not count as confirmed logout. Account switching, multi-tab provider behavior, all-storage-unavailable reload, dashboard denominators and provider lifecycle acceptance remain open. No production change, deployment, commit or push.

### Two-account evidence reference correction

The successful historical development preference check is `evidence/analytics-preference-dev-prior-20260916T094620Z.json` (14/14). Parent inspected the checks: unknown/declined defaults, distinct server UUIDs for two accounts, validator rejection of forged owner/identifier arguments, concurrent revision conflict handling, withdrawal suppression and disposable Clerk cleanup. The generic `evidence/analytics-preference-dev.json` instead records a failed three-check attempt and must not be cited as backend acceptance. This is historical backend evidence, not a current same-browser account-switch or multi-tab pass. The current mounted-provider matrix remains separately pending.

## 2 October 2026 local acceptance refresh

The current analytics acceptance register now records the hard-navigation consent-readiness measurement, second-tab auth transition, device-offline transport and 70-test provider lifecycle slices. The current candidate keeps analytics disabled; enabled development checks remain separate. Live Mixpanel member ingestion, dashboard reconciliation, provider retention/deletion and production configuration remain open. See [analytics-acceptance.md](analytics-acceptance.md), [provider lifecycle evidence](evidence/provider-lifecycle-local-2026-10-02.json), and the [release manifest](evidence/release-candidate-manifest-2026-10-02.json).
