# TrueCost production launch checklist

Status: **NOT READY**
Prepared: 15 September 2026
Release decision owners: **Rajesh and Ritesh**

TrueCost may enter a pilot only after every applicable box has an owner, dated evidence, and reviewer approval. A blank field fails the gate. This plan does not approve deployment or claim legal or accessibility compliance.

Related plans: [PRD](./prd.md), [technical design](./technical-design.md), [analytics plan](./analytics-plan.md), [UI specification](./ui-spec.md), [product roadmap](./product-roadmap.md), and the [release runbook](./release-runbook.md).

## Current verification checkpoint: 17 September

These results are partial evidence and do not check off the release gates below:

- Latest full test checkpoint: 1,033 tests across 107 files passed on 17 September (run started 16:04:46 UK). The prior full run had one storage-test synchronization timeout; explicit IndexedDB-event synchronization fixed it without raising the timeout. Typecheck and the 19-route production build SV-yKxBL4b6i0Wn7cmd8h passed. This verifies local code, not a completed post-tax product, provider acceptance or release approval. See execution-log.md for scope and remaining gates.
- Email OTP: the user reported receipt, and root directly observed the signed-in hosted Account page on 17 September at 14:07 UK. This proves that hosted attempt, not production Clerk configuration or all failure paths.
- Signed-out local cleanup: the isolated two-tab browser harness proved durable epoch rejection and empty synthetic member stores after reload. Full-app/hosted and broader-browser acceptance remains open; see evidence/private-browser-two-tab-harness.md.
- Development account export: the dated historical notes record 17 fresh-auth checks, while the preserved [19 older-session record](./evidence/account-export-stale-session.json) includes actual Clerk reverification. The earlier fresh-auth artifact was superseded at the same path by the latest [14-check current-build rerun](./evidence/account-export-browser.json), which verified scoped export, signed-out rejection, account-B isolation and owned-comparison cleanup. Only the comparison scope contained data; Convex profile, receipt, export-session, provider deletion, other populated scopes and cancellation checks remain open.
- Interrupted synthetic-run cleanup: [server-confirmed comparison and Clerk cleanup](./evidence/interrupted-export-cleanup.json). This does not prove full Convex account-data deletion.
- Equal fee budget: DEC-013 has independent fixtures and a reviewed local dated three-route composer. Dated deduction, disposal-tax, gross-growth and ordinary-interest arithmetic are being integrated; DEC-014 still requires a complete reviewed post-tax model before release. These modules do not validate the old app recommendation.
- Public browser source maps are explicitly disabled in local Next configuration. The 17 September scan is historical; the current `ydMzVTyEiY_q6uNn7FXx1` scan also found zero `.map` files and zero `sourceMappingURL` markers under `public` and `.next/static` (evidence/local-source-map-check-2026-10-03.json). Hosted and deployed asset checks remain open. Production Clerk and domain switching were deferred by the user.
- The 320px comparison-table gutter and keyboard-scroll defects are corrected and rechecked: 20px margins on both sides, a 20rem two-offer table minimum for a reliable keyboard scroll range, no page overflow, full numeric text at both horizontal scroll extents, and valid semantic header associations. The fresh source-equivalent rerun passed 7/7 browser checks and 2/2 focused tests at build `ujIJXQDHA9Mwk2jE0jKnM`; the reviewed release manifest remains bound to `ydMzVTyEiY_q6uNn7FXx1`. Three-offer browser coverage and the broader accessibility gate remain open.

## Active launch brief

Updated 15 September 2026 with plan-product-launch. Proposed rollout remains a controlled pilot, now targeted at registered users in India by direct user decision. First complete synthetic development verification, then prepare the exact pilot candidate for approval. Public availability, announcements and invitations are separate actions; none has occurred through this execution.

D1/D2 are accepted. The user confirmed the existing `rvs006s-projects` Vercel paid plan as the authorized hosting target after upgrading it themselves. No additional purchase, add-on, or automatic overage is authorized; other services remain within the ₹0/free-plan budget. Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review. Support hours are Monday–Saturday, 9 AM–6 PM IST. The supplied support@trucost.com address is on hold because public DNS points to S&P Global infrastructure; see DEC-011. Tested incident coverage, any specialist incident/security reviewer and actual sign-offs remain open. Verify production regions and recovery entitlements within the applicable service-plan constraints.

Engineering owns build/test and recovery evidence; product owns pilot eligibility and outcomes; privacy/finance reviewers own the corresponding sign-offs; support owns incident coverage and twice-weekly feedback review. These are workstream assignments, not named-person approval. Communication copy must describe only the demonstrated candidate and keep unimplemented features out of launch claims.

No-go conditions include wrong finance output, foreign-account access, false save acknowledgement, stale writes resurrecting deleted data, prohibited analytics payloads, failed restore proof and missing human sign-off. A deadline does not waive these conditions. The tentative Demo Day date still requires confirmation; see demo-day.md. After a real pilot, review operational evidence daily and product outcomes only after the chosen observation windows have elapsed.

## Decision record and evidence format

Use this block for every checked item in the release PR or linked evidence register:

```text
Gate ID:
Owner role:
Actual person: TBD until assigned
Environment and exact version:
Evidence link or artifact:
Result and measured value:
Test date:
Reviewer role and actual person:
Exceptions, expiry, or follow-up:
```

- [ ] **GOV-01** Name product go/no-go, release, finance, security/privacy, accessibility, incident, support, and rollback owners. Independent reviewers approve finance and security evidence.
- [ ] **GOV-02** Record providers, region/data location, domain/DNS owner, pilot date/audience and service limits. Rajesh and Ritesh jointly own release approval. The existing `rvs006s-projects` Vercel paid plan is the user-confirmed hosting target; record its exact tier, entitlements and account/project evidence. No additional purchase, add-on, or automatic overage is authorized, and other services remain within the ₹0/free-plan budget. Production domain, provider entitlements and operating coverage still need evidence.
- [ ] **GOV-03** Record `[ ] GO`, `[ ] NO-GO`, or `[ ] PILOT ONLY`, signed and dated by product, engineering, security/privacy, finance, and support. Current decision: **NO-GO pending evidence**.

## Production foundations and credentials

- [ ] **CFG-01** Prepare separate production projects for Clerk, Convex, Mixpanel, and Sentry, creating them only under the applicable production authorization. Preserve the existing Vercel project and prove isolated preview/production settings. Record account/billing owner, plan, region/data location, support tier, quota alerts, and terms. Launch auth is Clerk email OTP only; phone sign-in is deferred.
- [ ] **CFG-02** Classify environment variables as public, server secret, deploy credential, or webhook secret. Use approved stores. Prove preview/production separation, no leakage to source/logs/bundles/evidence, and working rotation/revocation.
- [ ] **CFG-03** Verify production domain, TLS, redirects, canonical origin, Clerk origins/redirects, Convex issuer, webhook signature, Mixpanel token, Sentry environment, and email OTP delivery. Capture accepted/rejected origin tests and missing/malformed settings; production must not silently fall back to demo membership. **Open dependency:** the owners confirmed no suitable owned domain; Clerk production requires one with DNS access. See [assessment](free-plan-assessment.md).
- [ ] **CFG-04** Document least-privilege access and two-person recovery. Remove former collaborators/personal keys and require supported MFA.

## Data ownership, privacy, and security

- [ ] **SEC-01** With Accounts A/B, test every comparison, loan, feedback, access/export, and deletion read/write using own, direct foreign, and forged-owner IDs. B receives no A content, existence clue, or mutation. Client-generated reports use only the verified member's loaded snapshot. Convex derives ownership from verified Clerk identity.
- [ ] **SEC-02** Test privacy after expiry, account switch, refresh, history navigation, restart, and cross-tab sign-out. A verified active tab may use already-loaded private data offline. Reload locks private cache/outbox until the same account is verified online. A cold offline launch exposes only the guest calculator. Inspect Cache Storage, IndexedDB, local/session storage, restored pages, service-worker responses, and report URLs. The new worker has a four-asset public allowlist with local and partial real-browser evidence; integrated private-client and cold-reload checks remain open.
- [ ] **SEC-03** Queue an A save, let auth expire, reload, and prove the account-scoped queue stays locked until A is verified online, then submits once with its idempotency key. Confirmed sign-out or switch to B warns, then clears A's queue; late A callbacks are ignored and nothing replays under B. Retry, conflict, deletion, storage-full, and private-mode paths show honest status with no duplicate/crossover.
- [ ] **SEC-04** Before confirmed sign-out, warn about unsynced work and allow cancel. Confirmation clears all private cache, outbox, screen state, and report URLs. For record/account deletion, prove immediate access revocation, live cleanup within the approved limit, and tombstone/deletion replay prevents an old queued save or restored backup from resurrecting data.
- [ ] **SEC-05** Review auth returns, stale tokens, sessions, webhook replay/signatures, injection, rate/size limits, dependencies, headers, source maps, report content, malicious feedback, and support access. No critical/high release-path finding remains. Security owner: **TBD**.
- [ ] **PRV-01** Rajesh and Ritesh own privacy review for the India pilot. Record applicable jurisdictions, consent/lawful basis, controller/contact, subprocessors/transfers, access/export, deletion, incident notice and retention. Completed review remains a gate; assigning names is not a compliance claim.
- [ ] **PRV-02** Privacy/legal and provider owners approve the proposed schedule: comparisons/loans until deletion; feedback 12 months; Mixpanel events 90 days; scrubbed logs 30 days; locked cache/outbox discarded after 7 days with notice; access ends immediately and live app/provider cleanup completes within 7 days; backups expire within 30 days. Keep an opaque deletion ledger until affected backups expire plus 7 days, and replay it after restore. Record exceptions and update copy.

## Finance engine and report parity

- [ ] **FIN-01** Finance owner approves versioned Indian home-loan fixtures covering equal/unequal amounts and tenures, reducing/flat rates, flat/percentage fees, GST, other charges, financed/upfront premiums, zero fees, near-equal APRs, invalid cash flows, transfer/prepay break-even, and solver fallback. Expected values use an independent reviewed calculation.
- [ ] **FIN-02** Browser, saved/reopened snapshot, and report use identical unrounded inputs/version. EMI, repayment, interest, disbursal, fee/GST, APR, cost per lakh, ranking, and warnings match displayed precision. Independent-fixture APR tolerance is <=0.01 points; rupees follow documented Indian grouping and half-tie rounding.
- [ ] **FIN-03** Reports preserve calculation date/version, assumptions, warnings, and disclaimer. PDF pages have no clipped rows or missing glyphs on mobile and A4. Failure preserves the comparison; “download initiated” begins only at browser handoff.
- [ ] **FIN-04** Current setup no longer infers spread from 5.75% or substitutes today for a blank reset date. Missing and legacy contractual inputs require confirmation. The static benchmark history ends at **5.25% from 5 December 2025**. Sampled primary-source entries do not prove continuous coverage or freshness. Verify historical coverage, visible validity metadata, update ownership/cadence, stale thresholds and methodology approval. Without current evidence and an owner, disable benchmark-derived “your rate is stale” claims. This gate remains open.
- [ ] **FIN-05** Finance and legal reviewers approve plain educational wording. Claims state inputs and limits, point users to their sanction letter or a qualified professional, and avoid personalised financial, tax, or legal advice.

## Functional, PWA, and browser testing

Record exact browser/OS/build, device, network, mode, account, result, and defects. “Current/previous” mean stable versions on the test date.

| Gate | Required matrix | Pass criteria |
| --- | --- | --- |
| [ ] **PWA-01** | Chrome current/previous on Windows/macOS; Edge current/previous on Windows; Firefox current/previous on Windows/macOS; Safari current/previous on macOS | Guest result, auth/cancel/return, save/reopen, report, feedback, sign-out, deletion, Loan health, transfer, and prepayment work in a tab. |
| [ ] **PWA-02** | Android Chrome current/previous; iOS Safari current/previous | Repeat critical flows on a real phone or named device service at 320 CSS px and larger, including keyboard, rotation, download, weak network, and interrupted auth. |
| [ ] **PWA-03** | Installed mode separately where supported: Chrome/Edge desktop, Android Chrome, iOS Home Screen, and macOS Safari/Chrome | Install path, name, icon, scope, orientation, startup, deep links, auth return, and sign-out work. Record unsupported combinations. |
| [ ] **PWA-04** | Tab and installed modes after one online visit, then offline and reconnect | Anonymous calculator and public offline fallback load. Fresh auth requires connection without losing guest work. Member saves show “queued” until Convex acknowledgement; reconnect submits once. Shared navigation cache never serves private data. |
| [ ] **PWA-05** | Upgrade N to N+1 in an open tab and installed app | No blank screen, mixed assets, wrong-route fallback, or lost draft. Update behavior works; only obsolete TrueCost caches are removed, unrelated caches remain, and rollback to N passes. |

- [ ] **FUN-01** Exercise guest quota, cancelled/failed/expired auth, one-time intent resume, acknowledged/queued save, history, report, feedback deduplication, analytics failure, and existing finance routes. Click and keyboard-activate every control; no dead control remains.
- [ ] **FUN-02** From the release commit, run clean install, typecheck, full tests, production build, and diff check. The old isolated baseline passed 129 tests; upstream `b9e53c0` CI passed 137 tests, typecheck and build. Neither verifies the future Clerk/Convex implementation or replaces candidate acceptance evidence.

## Accessibility and performance

- [ ] **A11Y-01** Automated, keyboard, and screen-reader review covers each critical flow. Controls have names; focus is logical, visible, and unobscured; errors are associated/announced; structure is coherent; dialogs trap and restore focus.
- [ ] **A11Y-02** At 200% text size and 400% zoom, content and controls remain available. At 320 CSS px, ordinary content reflows without two-dimensional page scrolling; tables have a labelled scroll region or stacked view. Verify contrast of 4.5:1 for normal text and 3:1 for large text/UI indicators, targets, forced colours, reduced motion, and visible content without animation. Zero unresolved WCAG 2.2 A/AA failures pass.
- [ ] **PERF-01** Before pilot, run three lab trials on home, compare, results, and history with recorded mobile/desktop profiles. Median LCP <=2.5 s, CLS <=0.1, and TBT <=200 ms as a lab responsiveness proxy. Record cache, network/CPU, bundles, and exceptions.
- [ ] **PERF-02** During the pilot, collect consented `web_vital` events under the analytics plan, with pseudonymous identity only and no finance/contact/auth fields. Before wider release, mobile and desktop each meet LCP <=2.5 s, INP <=200 ms, and CLS <=0.1 at the 75th percentile. Approve a minimum sample before the pilot; insufficient data remains “unknown,” never “pass.”
- [ ] **PERF-03** On a recorded midrange Android device, a representative two/three-offer 20-year calculation completes at p95 <=200 ms over 30 runs with correct output; its PDF generates in <=5 s.
- [ ] **PERF-04** Across 50 seeded saves at 10 Mbps and 150 ms RTT, online acknowledgement is p95 <=3 s. Offline queue reload, retry, duplicate, auth-expiry, and conflict tests lose no acknowledged data.

## Monitoring, recovery, and support

- [ ] **OBS-01** Implement the proposed required baseline in Sentry before pilot: release/environment tags, source maps with restricted access, frontend and Convex error capture, health checks, and alerts for high error rate, auth failures, save/report failure, and deletion failure. Session replay remains off. Scrubbing tests prove no loan amounts, rates, fees, lender names, results, report/feedback text, email, phone, OTP, tokens, raw URLs, Clerk subject, or request bodies reach logs or alerts.
- [ ] **OBS-02** Assign on-call person, backup, destinations, coverage hours, and console access. During pilot, review errors daily. Trigger a synthetic alert and record receipt, acknowledgement, escalation, and closure. Critical alerts are acknowledged within 30 minutes during declared coverage; public launch requires an assigned coverage plan.
- [ ] **REC-01** Approve proposed **RPO 24 hours / RTO 4 hours** after verifying the selected Convex plan and measured restore duration. Convex periodic backups currently require a Pro plan; confirm entitlement, daily schedule, file inclusion, retention, access, and budget. Record that backups exclude application code, environment variables, and scheduled functions, which need separate versioned recovery material.
- [ ] **REC-02** In non-production, take a pre-restore snapshot, restore a representative backup, redeploy compatible code/config/schedules, and replay a current deletion ledger held outside the replaced database snapshot. Include an account deleted after the backup was taken; it must stay deleted. Validate counts/ownership and time recovery. Pass only within approved RPO/RTO with signed evidence.
- [ ] **INC-01** Exercise the support runbook: classify severity; acknowledge; preserve scrubbed evidence; use the narrowest kill switch; notify incident/security/privacy/finance owners; update users; verify recovery; review. Any wrong financial result, cross-account disclosure, deleted-data resurrection, or reproducible loss of an acknowledged save blocks expansion. Support never requests OTPs, credentials, or full financial records.

## Release, compatibility, and rollback

These runnable steps remain unchecked and may be executed only after explicit deployment approval.

- [ ] **REL-01** Freeze commit and calculation/schema versions. Link evidence, defects, expiring exceptions, migration rehearsal, provider checks, and synthetic smoke data. Confirm anonymous calculation with cloud integrations off.
- [ ] **REL-02** Test independent kill switches for cloud writes/outbox drain, history, report, feedback, Mixpanel, and Sentry. Their safe state preserves the anonymous comparison calculator and local guest work. Private Loan health, transfer, and prepayment remain authenticated; no switch bypasses private access control.
- [ ] **REL-03** Deploy backend changes first only when they are additive and accept both the current production frontend and candidate frontend. Prove both versions against the candidate backend, including old payloads and new optional fields. Run synthetic ownership and save/read/delete checks before any frontend exposure.
- [ ] **REL-04** Release frontend to the pilot boundary; test anonymous calculation, auth return, save, report parity, sign-out privacy, analytics allowlist, Sentry scrubbing, and PWA update. Record frontend/backend/schema/calculation versions, time, operator, and result.
- [ ] **REL-05** Roll back the frontend to the last known artifact when client errors or UX failures breach the agreed threshold, provided the live backend remains backward compatible. Disable the affected feature switch while deciding. Verify anonymous calculation and cached PWA update after rollback.
- [ ] **REL-06** Roll back backend code/config separately only after taking a backup and proving the prior backend can read the current schema/data. Use a forward fix for irreversible migrations. Restore data only for confirmed corruption, because restore replaces deployment data; preserve the pre-restore snapshot and reconcile writes since the selected recovery point.
- [ ] **REL-07** Close the pilot only after alert review, support review, deletion/retention check, and field-performance evidence. Product owner records wider-release GO or NO-GO with actual people, timestamps, links, and remaining risk.

## Primary references checked 15 September 2026

- [Convex Backup & Restore](https://docs.convex.dev/database/backup-restore): backup contents, plan requirement, retention, and destructive restore behavior.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), and [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): AA criteria, 200% text, 320 CSS px, and 400% zoom equivalence.
- [web.dev Web Vitals](https://web.dev/articles/vitals): LCP, INP, CLS, and 75th-percentile field thresholds.

Final release status: **NOT READY**. Rajesh and Ritesh are named joint owners; the applicable production evidence and signed release gates remain incomplete.

## Local candidate check, 16 September 18:38 UK

- Local production build Xu6azB_QdWTX4AHRLAw1h passed build/typechecking and page generation. It retains development Clerk/Convex configuration.
- Public source-map artifact scan and local HTTP probe passed; see evidence/local-source-map-check.json. Hosted verification is still pending.
- Latest full test checkpoint: 717 passed in 70 files. Subsequent provider/error-message edits require their affected checks before a frozen-candidate claim.
- DEC-014 requires a reviewed full post-tax model before the prepayment feature releases. Calendar helpers are locally tested; the tax model remains incomplete.

Release status remains NOT READY.

## Narrow comparison-table browser checkpoint: 2 October 2026

The current local candidate passed `scripts/check-results-table-browser.mjs` in Chrome 154 / Playwright 1.62.1 at 1280px and 320px. The run verified the semantic two-offer table, 3 column headers, 6 row headers, 12 complete numeric cells at both scroll extents, keyboard horizontal scrolling at 320px, exact 20px side gutters, no document overflow, and zero guest provider writes. Evidence: [results-table-browser.json](evidence/results-table-browser.json). This is a scoped accessibility/layout result; it does not check off A11Y-01/A11Y-02 or TASK-018.

## Superseding local build checkpoint: 17 September, 17:00 UK

Fresh-member analytics identity correction: full suite 1,034 tests across 107 files passed; 19-route production build rXZIz1n6RFg7wqRANFs-x and TypeScript passed. This supersedes earlier local test/build counts above only. Corrected app-to-provider member verification remains pending; all unchecked production gates remain unchecked. No deployment occurred.

## Updated local checkpoint: 17 September, 17:12 UK

1,037 tests across 107 files and production build61igxZXtteLa9GzAcIUt2 (19 routes, including TypeScript) passed. OTP send timeout recovery was observed in the native browser; see evidence/otp-send-timeout-browser.json. Corrected fresh-member analytics passed 15 live checks on its preceding analytics-enabled build; see evidence/member-analytics-browser-2026-09-17T16-11-26-414Z.json. These scoped checks leave production domain, full auth failure coverage, finance review and other unchecked release gates open.

## Superseding local verification checkpoint: 18 September 2026

- Full suite: 1,041 tests in 107 files passed with `npx vitest run --maxWorkers=2`. The default four-worker run had one scheduler-drain failure; all six deletion tests passed in isolation. This intermittent reliability issue remains recorded, not fixed or hidden.
- Normal `npm run build` passed TypeScript and 19-route generation. Build ID: `g0kkK7sEHUpgaauEitmhP`. Restored the normal analytics-disabled local artifact without changing the environment file; development Clerk/Convex configuration remains.
- Guest-to-member analytics: 10 live development checks passed; six events acknowledged and independently joined in the Mixpanel member activity feed. See `evidence/mixpanel-guest-join-observation.json` and its referenced browser run.
- No deployment, commit, push, or production authentication change. TASK-015 remains partial: next-guest-after-sign-out behavior, account switching, denominator reconciliation and provider lifecycle acceptance remain open. Production domain, reviewed post-tax model and other release gates remain open. Release status: NOT READY.

## Local withdrawal acceptance checkpoint: 18 September 2026

- Full suite passed: 1,046 tests / 107 files (`npx vitest run --maxWorkers=2`, 124.46 seconds). Corrected the test probe to label guest events as guest; affected provider/auth-save/browser-clear checks passed 45/45 after that test-only correction. Typecheck passed.
- Normal analytics-disabled build UwXv6ni5ABtDnDNDJjSKz passed TypeScript and all 19 routes. Environment file unchanged. No deployment.
- Browser withdrawal/logout/reload/guest-reuse check passed 11 checks on analytics-enabled build LQxx6bL8bDMTcotNllltl; evidence `evidence/member-analytics-browser-2026-09-18T09-17-19-872Z.json`.
- Tests cover acknowledged and failed remote withdrawal followed by guest remount, plus reported local write failures and successful retry. A complete reload while storage cannot persist remains unverified; the in-memory retry flag is not durable evidence.
- Ordinary logout without withdrawal, account switching, dashboard denominator reconciliation, provider retention/deletion, production domain and reviewed post-tax model remain open. The default-four-worker deletion scheduler failure was unresolved at this historical checkpoint; the current candidate's default `npm test` rerun passed and is recorded below. TASK-015 and the master goal remain incomplete. Release status: NOT READY.

### Final regression result for ordinary logout patch

Full two-worker run: 1,051 passed / 2 failed, 108 files, 164.93 seconds. Both failures were in account-deletion-providers.test.ts: the initial scheduler drain exhausted 10,000 timer pumps, and the following null-analytics-ID case remained clerk_pending rather than completed. An immediate isolated rerun passed all 8 tests in that file (3.92 seconds). This supports an intermittent scheduler/test-isolation concern, not a proven root cause or a clean full-suite claim. No deletion code, assertions, timers or dependencies were changed. Retain this as an unresolved release-verification item.

Logout-specific focused checks passed (41 tests including the actual AuthProvider integration). The ordinary-logout browser scenario passed all 11 checks. Account-switch/multi-tab tests and provider lifecycle acceptance remain open. TASK-015 and the master goal remain active and incomplete.

Normal local analytics-disabled build m7x_M1UwuU7XQ_VbKZYgU passed TypeScript and 19-route generation after the logout patch. No environment-file change or deployment. The latest full-suite failure above remains unresolved despite the isolated deletion tests passing.


## Superseding regression checkpoint: 18 September 2026

Deletion fixture module preloading passed both complete configurations: `npx vitest run --maxWorkers=2` passed 1,053 tests / 108 files in 126.27 seconds, then unchanged `npm test` (four workers) passed 1,053 / 108 in 70.17 seconds. `npx tsc --noEmit` passed afterward. No assertions, scheduler limits, product code or dependencies were relaxed. Prior intermittent failures remain documented; the evidence supports the cold-loader mitigation, not a deterministic root-cause proof. Watch for recurrence during subsequent normal verification; no extra repetition is required without new evidence.

Only two test fixtures changed in this slice. The normal analytics-disabled app build m7x_M1UwuU7XQ_VbKZYgU remains current. Vite config and jsdom navigation warnings persist without failing these runs. No deployment, commit or push. TASK-015 still needs account-switch/multi-tab, dashboard-denominator and provider-lifecycle acceptance. Production domain, reviewed post-tax model and the remaining release/demo gates are unchanged. Release status: NOT READY; master goal remains active.

## Latest regression checkpoint: 18 September 2026

Account-switch test additions passed: npm test 1,060/1,060 across 109 files; npx tsc --noEmit passed. No application change or rebuild in this slice. Real two-account browser/multi-tab analytics verification remains open, as do the other release gates. See [analytics acceptance evidence](analytics-acceptance.md). Release status remains NOT READY.

Same-browser online switch passed 13 intercepted development checks (see analytics-acceptance.md). A hard-navigation missing-event case remains open, alongside offline/multi-tab and other analytics gates. Normal build FdSSOSmC_f91KpjfR9Y8Y passed after restoring analytics-disabled configuration. Release remains NOT READY.

## 2 October 2026 local evidence update

The local candidate now has browser evidence for the ordinary member offline queue and a same-account second-tab deletion queue. `evidence/clerk-browser-smoke.json` records 61 passed checks, including queued comparison and quote saves, reconnect acknowledgement, cold offline privacy and confirmed sign-out clearing. `evidence/comparison-history-browser.json` records 21 passed checks, including pending deletion mirrored to a second tab and completed after reconnect, plus two-account history isolation.

The separate pending-transition browser run now holds one A completion at the intercepted analytics transport while tab 1 stays mounted through sign-out and switches to B. It does not cover a second-tab auth transition or stale callbacks. Dashboard reconciliation and provider-side retention/deletion remain open. The release status stays NOT READY.

Mixpanel access is currently blocked by project permission: the approved project URL opened a `Request Access` page. No request or login was submitted. Dashboard reconciliation, provider retention/deletion and release approval remain open.

- The earlier local baseline passed `npm test -- --maxWorkers=2` at 1,061/1,061 tests across 109 files and `npm run typecheck`; it remains tied to its recorded build. The historical yAPH candidate verification is recorded below; the current ydMz verification is in the release manifest.
- Local verification does not alter the release status. Mixpanel permission, provider reconciliation/retention, production configuration, privacy, recovery, finance review and publication approval remain open. Release status: NOT READY.

- Fresh candidate build `dE1J_eOSnyZbkXsr8CLUE` passed on 2 October with analytics disabled, offline shell `8ecaf70f4be9b1ec`, TypeScript and 19 generated pages. This is local evidence only; external release gates remain open and status stays NOT READY.

- Pending-transition evidence `evidence/member-analytics-browser-2026-10-02T09-39-43-046Z.json` passed 14 checks on enabled build `wABL4wbCIK_WI-WhFi7EN`: A's completion was held and discarded at confirmed sign-out, while B delivered only its own pair. The normal analytics-disabled build was restored as `ApHEKy-bT17LmBF_d8ydv`. Mixpanel ingestion, second-tab auth propagation, provider reconciliation/retention and release approval remain open.

- Hard-navigation timing evidence used enabled build `1nKiIy6xdlno5JOcComuK` and harness hash `857f7d6c72bfb79e3743631dd3f1bd049dd67188674a663e66b8fce7bc442e47`. The 2-second run `evidence/member-analytics-browser-2026-10-02T09-49-54-994Z.json` recorded the post-navigation preference request starting 836ms after calculation and its HTTP response marker 942ms after calculation, with zero events. The matched 5-second run `evidence/member-analytics-browser-2026-10-02T09-51-14-867Z.json` observed that response before calculation and delivered the expected A/B pairs. These markers are request/response callbacks, not parsed provider activation. The normal analytics-disabled build was restored as `NX0mAmH7jqxFCBi5_QIfM`. This is readiness evidence only; hard-navigation acceptance, Mixpanel access, provider reconciliation/retention and release approval remain open.

- Second-tab auth-transition evidence `evidence/member-analytics-browser-2026-10-02T10-14-31-722Z.json` passed 16 checks on enabled build `ixZzRSloataoxhJS76W4Z`: tab 2 signed out A, tab 1 observed the transition, held A analytics was discarded, and B delivered only its pair after opt-in. The harness reloaded tab 1 once after shared Clerk state settled. The latest normal analytics-disabled build is `ReTEk8KCoS93Or4lYAuV6`. Offline analytics transport, Mixpanel access, provider reconciliation/retention and release approval remain open.

- Offline analytics transport evidence `evidence/member-analytics-browser-2026-10-02T10-52-33-729Z.json` passed 13 checks on enabled build `r2-pg6buNZ5ovwGJZnVou`: Mixpanel transport alone was blocked while Clerk and Convex stayed available, A's queued start was discarded at confirmed sign-out, and B delivered only its own pair after opt-in. This closes the narrow provider-available transport-outage check. Device-level offline transport was covered by the later 15-check browser run below; Mixpanel access, provider reconciliation/retention and release approval remain open.

- Local provider lifecycle evidence evidence/provider-lifecycle-local-2026-10-02.json passed 69 focused tests across four files. It covers mounted analytics account-switch fencing/disposal, provider deletion retry/lease/poll state, and signed-out cleanup retry safety. Live dashboard reconciliation, provider retention/deletion, production configuration, and release approval remain open.

- Device offline analytics evidence evidence/member-analytics-browser-2026-10-02T11-12-19-553Z.json passed 15 checks: Account A's input stayed usable offline, zero analytics events were delivered while disconnected, and one queued start event delivered after reconnect. The same run covered A-to-B identity isolation and sign-out suppression. Live Mixpanel access, dashboard reconciliation, provider retention/deletion, production configuration, and release approval remain open.


## Landing browser checkpoint: 2 October 2026

The local analytics-disabled candidate `s6Rd0-6fq4J60XsjN5Kr5` passed `scripts/check-landing-browser.mjs` in Chrome 154 / Playwright 1.62.1. The 13-check run covered 1440px, 390px and 320px landing layouts, light/dark theme persistence, reduced-motion timing, keyboard sign-in and compare navigation, guest home return, no horizontal overflow, zero console errors and zero failed requests. Evidence: [landing-browser.json](evidence/landing-browser.json). This scoped check does not establish the full browser/PWA/accessibility matrix or release readiness.

## Guest offline PWA checkpoint: 2 October 2026

The isolated `scripts/check-offline-browser.mjs` run passed 13 checks in headless Chrome 154.0.8037.59 on offline version `8ecaf70f4be9b1ec`. It covered the public cache allowlist and legacy cleanup, stopped-server cold navigation, complete guest calculation, changed-input and auth/connectivity gates, offline reload, API/RSC exclusion, hidden legacy data, 320px reduced-motion layout, horizontal table scrolling, and uncaught-error absence. Evidence: [offline-browser-smoke.json](evidence/offline-browser-smoke.json). This is scoped guest/PWA evidence and does not check off PWA-04 or the broader release matrix.

- History, report and multi-tab refresh: the current candidate `s6Rd0-6fq4J60XsjN5Kr5` passed 24 checks in Chrome 154 / Playwright 1.62.1 with report mode enabled. Evidence: [comparison-history-browser.json](evidence/comparison-history-browser.json). Desktop PDF parity, a 390px warm-offline download, queued deletion mirrored to a second tab, warm/cold offline privacy locks, reconnect deletion, two-account isolation, foreign-ID rejection, keyboard layout and disposable cleanup passed. The installed-app upgrade, broader browser matrix, cold private report reload, hosted provider behavior and release gates remain open.

- Local MVP demo-flow refresh: current candidate `s6Rd0-6fq4J60XsjN5Kr5` passed 15 Chrome checks for guest result, development OTP intent, Convex save/list/get, history/detail, PDF parity, sign-out gating and owned comparison cleanup. Evidence: [clerk-browser-mvp-demo.json](evidence/clerk-browser-mvp-demo.json). Production email delivery, reviewer access, full video listening, final media assets and submission approvals remain open; the harness reports a possible minimal Convex profile residual.
- Current rebuilt candidate `HBKsiYtVfcMcoNQ26SNVk` also passed the full 61-check connected comparison/loan browser flow in Chrome 154, including offline reconnect, transfer quotes, cold offline privacy, responsive account/loan status, keyboard sign-out access, UI loan deletion and post-sign-out suppression. Evidence: [comparison-auth-browser.json](evidence/comparison-auth-browser.json). The first attempt exposed a harness-only reset-settle race and is preserved in [the failure summary](evidence/comparison-auth-browser-failed-2026-10-02T12-42-42.json); a temporary harness wait passed without product changes. Convex profile cleanup, provider retention/deletion, production configuration and release approval remain open.
- The same candidate passed the refreshed 24-check history/multi-tab run in Chrome 154, including desktop and 390px warm-offline reports, queued deletion mirrored to a second tab, warm/cold offline locks, reconnect deletion, two-account isolation, foreign-ID rejection and 320px keyboard access. Evidence: [comparison-history-browser.json](evidence/comparison-history-browser.json). Installed-app upgrade coverage, hosted provider behavior, provider retention/deletion and release approval remain open.
- The current candidate also passed the scoped provider-outage browser check: `scripts/check-guest-provider-outage.mjs` passed 5/5 with Clerk and Convex hosts blocked. Public comparison remained usable, private `/loan` and `/account` routes stayed locked, and no uncaught page errors occurred. Evidence: [guest-provider-outage-browser.json](evidence/guest-provider-outage-browser.json). This is local outage-boundary evidence; it does not close the full PWA matrix, hosted provider behavior, provider retention/deletion or release approval.
- The `2Bu3MZWREPtxsAbL9cmPp` checkpoint recovery flow passed 8 checks in Chrome 154: bounded save retry exhaustion, explicit same-request recovery, snapshot/request identity preservation, expired queued-save refusal and disposable cleanup. Evidence: [comparison-recovery-browser.json](evidence/comparison-recovery-browser.json). The first copied-harness attempt exposed a Reset settle race and is preserved separately; the corrected hydration wait was harness-only. Account deletion/recovery provider records and retention approval remain open.
- The source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` then passed eight Chrome 154 recovery checks with zero browser and cleanup errors. The immutable record is [comparison-recovery-browser-current-2026-10-04.json](evidence/comparison-recovery-browser-current-2026-10-04.json). The run used authorized disposable development-data mutation, including provider data creation and deletion; provider settings, hosted settings, production changes, deployment, commit, push and external submission were false. This does not close production recovery, provider retention/deletion, installed-app/device acceptance or release approval.
- The Chronicle editor route was rechecked in a signed-out browser session. It redirected to the share canvas again, with no editor toolbar or export control. Evidence: [chronicle-editor-access-probe-current-rerun-2026-10-04.json](evidence/chronicle-editor-access-probe-current-rerun-2026-10-04.json). No login, document, sharing, upload, export or submission action occurred; authenticated editor access remains required for PDF acceptance.
- Focused PWA/accessibility tests passed 10/10 across service-worker, stale-worker and results-table accessibility files. This supports the local cache and semantic-table slices; full screen-reader, contrast, zoom, device and installed-app upgrade acceptance remains open.
- Current candidate semantic-table evidence passed 2/2 in `tests/results-table-accessibility.test.tsx`, covering the labelled focusable scroll region, semantic headers, explicit cell associations and long lender names without truncation. Evidence: [accessibility-results-table-local-2026-10-03.json](evidence/accessibility-results-table-local-2026-10-03.json). This is focused jsdom evidence; full browser, screen-reader, contrast, zoom, forced-colors, device and installed-app acceptance remains open.

- Account-export rerun warning: the first current-build attempt is retained as [failure summary](evidence/account-export-browser-failed-2026-10-02T11-58-27-938Z.json). It reached export download checks but hit Clerk HTTP 429 and a Convex `Unauthorized` account-B probe before confirmed comparison cleanup.

- Account-export browser acceptance: after the harness repair and a provider-rate-limit-cleared rerun, 14 Chrome checks passed. The run verified fresh email OTP, scoped export contents, signed-out approval rejection, account-B isolation and run-owned comparison cleanup; both disposable Clerk users were deleted. Evidence: [account-export-browser.json](evidence/account-export-browser.json). Convex profiles, receipts, export metadata and provider-side deletion remain unverified, so TASK-014 and release status remain open.

## Open-tab service-worker upgrade and rollback checkpoint: 2 October 2026

The disposable `scripts/check-service-worker-upgrade-browser.mjs` harness passed 5 Chrome 154 checks against offline shell `8ecaf70f4be9b1ec`. It served an N+1 worker, confirmed complete assets, observed eventual removal of the prior owned cache while preserving an unrelated cache, reloaded the open tab, rolled back to N, and reloaded again. Evidence: [service-worker-upgrade-browser.json](evidence/service-worker-upgrade-browser.json).

This closes the open-tab upgrade and rollback slice. Installed-app upgrade/rollback, full accessibility, hosted provider behavior, production configuration and release approval remain open.

## Historical history boundary: 2 October 2026, 22:31 UTC

The restored ZJQ browser history run still times out before the second-tab `Deletion pending` assertion after an offline deletion is queued in the first tab. The focused local lifecycle suite passes 41 tests across workspace queueing, same-account tab refresh and mounted cleanup fencing; this is bounded local evidence, not full browser acceptance. Evidence: [current history run](evidence/comparison-history-browser.json) and [local lifecycle suite](evidence/history-lifecycle-local-2026-10-02.json). Full history/report, interrupted-save, installed-app/real-device and provider-side deletion/retention gates remain open.

## Chronicle share checkpoint: 2 October 2026

The signed-out Chronicle share URL opened in Chrome 154 and rendered the titled one-page canvas. Evidence: [chronicle-share-browser.json](evidence/chronicle-share-browser.json). Chronicle PDF export retrieval, editor permissions, full audio review, production configuration and submission approval remain open.

## Hosted development guest recheck: 2 October 2026

The signed-out development review URL `https://truecost-ebon.vercel.app/` rendered the landing page, guest home, `/compare`, and `/compare/results` in the Codex In-app Browser. The result showed the two synthetic offers, Effective APR, Cost per lakh, Monthly EMI, Total cost of borrowing, and the save/new-comparison/report action gates. Evidence: [hosted-development-guest-browser-2026-10-02.json](evidence/hosted-development-guest-browser-2026-10-02.json). This is a fresh development check only; it does not prove production configuration, email delivery, provider reconciliation, reviewer access or release approval.

## Hosted development performance sample: 2 October 2026

The read-only `scripts/check-hosted-performance.mjs` harness captured 36 samples: three trials across `/`, `/compare`, `/compare/results`, and `/comparisons` at 1440px, 390px, and 320px in Chromium 151 / Playwright 1.62.1. Aggregate medians were response end 375 ms, DOMContentLoaded 442 ms, load 643 ms, LCP 1,082 ms, CLS 0, and TBT 0 ms. Those values sit within the harness's diagnostic thresholds, but they are not a release sign-off. The direct guest `/compare/results` probe returned to `/` until guest comparison intent exists, and `/comparisons` returned to `/` because it is member-only. These are expected route-guard outcomes, so the result and history numbers are route probes rather than authenticated page proof. Evidence: [hosted-performance-sample-2026-10-02.json](evidence/hosted-performance-sample-2026-10-02.json). PERF-01, PERF-02, PERF-03 and TASK-018 remain open for authenticated flows, INP, a real device, controlled network, and field data.

An earlier local `npm run build` checkpoint completed on 2 October with BUILD_ID `yAPHNfIW8scb2GyyGdBIo`, 19 generated routes, TypeScript included, and offline shell `8ecaf70f4be9b1ec`. It is historical development evidence, not a production deployment or release approval.

Against that exact build, `scripts/check-landing-browser.mjs` passed 13 checks in the local Chrome harness at 1440px, 390px, and 320px, including reduced-motion timing, theme persistence, keyboard routes, no overflow, zero console errors, and zero failed requests. Evidence: [landing-browser.json](evidence/landing-browser.json). This remains a scoped landing check.

Against the same build, the refreshed `scripts/check-comparison-browser.mjs` run passed 11 checks in Chrome 154: guest two-offer entry, result persistence across reload, sign-in handoff for changed inputs, draft retention through cancellation and reload, 390px/320px layout and no page errors. Evidence: [comparison-browser-after.json](evidence/comparison-browser-after.json). This remains a guest and handoff slice; authenticated provider, installed-app and real-device acceptance remain open.

The same candidate passed the 15-check `TRUECOST_MVP_DEMO_CHECK=1` browser run: guest result, Clerk OTP handoff, Convex save/list/get, history/detail, stored-value PDF parity, sign-out gating and disposable cleanup. Evidence: [clerk-browser-mvp-demo.json](evidence/clerk-browser-mvp-demo.json). This is development-resource demo evidence only; production email delivery, reviewer access, Convex profile cleanup, media review and submission approval remain open.

That checkpoint's candidate boundary is recorded in [release-candidate-manifest-2026-10-02.json](evidence/release-candidate-manifest-2026-10-02.json). It kept the `yAPHNfIW8scb2GyyGdBIo` build separate from the earlier full 1,061-test baseline and listed the remaining no-go gates. The manifest's later current-candidate section supersedes it. No production or provider action was taken.

The manifest-era source check recorded 1,061/1,061 tests against its earlier build. The historical yAPH candidate verification is recorded below; the current ydMz verification is in the manifest's current-candidate section.

The default `npm test` run also passed 1,061/1,061 across 109 files in that earlier baseline. The historical yAPH refresh is recorded below; later current-candidate results are recorded in the manifest.

The deterministic `npm run build:offline` preflight also passed. The generated version, service-worker version and public manifest all remain `8ecaf70f4be9b1ec`, recorded under `offlineShellVerification` in the manifest.

The open-tab service-worker upgrade harness was rerun against that shell and passed 3/3 checks: complete N+1 assets, removal of the obsolete owned cache while preserving an unrelated cache, and a successful reload. The evidence remains scoped to an open tab; installed-app upgrade and rollback are still open.

That historical `yAPHNfIW8scb2GyyGdBIo` build also passed the guest comparison-table browser check at 1280px and 320px: 7/7 assertions covered semantic headers, complete numeric cells, keyboard horizontal scrolling, exact mobile gutters, no page overflow, and zero provider writes. Evidence: [results-table-browser.json](evidence/results-table-browser.json). This remains a scoped accessibility result.

That historical candidate's deployment-visible local artifact scan also passed: zero .map files and zero sourceMappingURL markers under public and .next/static. Evidence: [local-source-map-check-2026-10-02.json](evidence/local-source-map-check-2026-10-02.json). Internal build folders were excluded, and hosted or production asset verification remains open.

## Task status register: 2 October 2026

The complete TASK-001 through TASK-034 status register is [task-status-2026-10-02.json](evidence/task-status-2026-10-02.json). It distinguishes complete, partial, pending and deferred work and keeps every external action false. The register is evidence for handoff, not a release approval.

The exact release candidate's Mixpanel boundary was checked without sending data. Its analytics-disabled build correctly exposed no consent control, so the enabled harness stopped before provider traffic; this diagnostic is [recorded here](evidence/analytics-mixpanel-browser-2026-10-02T15-14-51-585Z.json). Enabled development evidence remains separate, and no provider action occurred.

The local demo artifact machine check passed: the one-pager PDF is one renderable page, and both 16:9 and 9:16 candidates fully decoded at 180.68 seconds. Evidence: [demo-artifact-machine-check-2026-10-02.json](evidence/demo-artifact-machine-check-2026-10-02.json). This does not close audio listening, caption review or submission approval.

## Current integrated development flow: 2 October 2026

The current `2Bu3MZWREPtxsAbL9cmPp` candidate passed 32 checks in the Clerk/Convex comparison browser flow in Chrome 154 / Playwright 1.62.1. Evidence: [comparison-auth-browser.json](evidence/comparison-auth-browser.json), checked at `2026-10-02T21:35:44.004Z`, with zero errors and zero cleanup errors. It covered two-account isolation, guest comparison, Clerk OTP, Convex save/list/get, offline queued save and reconnect, UI deletion, responsive account status and confirmed sign-out privacy. The disposable Clerk user was deleted; the harness cannot delete the Convex profile. This remains development evidence. Installed-app acceptance, provider retention/deletion, live Mixpanel reconciliation, production configuration and release approval remain open.

## Current candidate full verification refresh: 2 October 2026

The current `.next/BUILD_ID` is `2Bu3MZWREPtxsAbL9cmPp`. The candidate verification passed 1,059 tests across 111 files, `npm run typecheck`, and the 19-route production build. The release manifest and task register bind this result to the candidate. This does not close the provider, installed-app, production, human-review or submission gates; release status remains NO-GO.

- Provider lifecycle refresh: the current checkout passed 70 focused tests across analytics provider, account-switch, mounted cleanup and deletion orchestration files. Evidence: [provider-lifecycle-local-2026-10-02.json](evidence/provider-lifecycle-local-2026-10-02.json), checked at `2026-10-02T21:47:47.1733624Z`. This remains local evidence; live provider reconciliation, retention/deletion and production configuration remain open.

- Legacy device adoption browser refresh: the current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 15 disposable Chrome checks at `2026-10-03T00:36:13.105Z` in [legacy-device-adoption-browser.json](evidence/legacy-device-adoption-browser.json). The account-page flow seeded `truecost.loan.v1` only in the test context, required an explicit import, verified the Convex acknowledgement, required confirmation before clearing the device copy and deleted the imported account record. Full account-page, installed-app and broader lifecycle acceptance remain open.

- Offline and multi-tab history refresh: the current candidate passed 24 disposable Chrome checks in [comparison-history-browser.json](evidence/comparison-history-browser.json). Queued deletion mirrored to a second same-account tab, warm and cold offline states kept private history locked, reconnect removed the server record, and foreign read/delete plus 320px/390px layout checks passed. Interrupted save and the wider installed-app/real-device release matrix remain open.

## Current candidate boundary correction: 2 October 2026, 20:23 UTC

The later `npm run build` regenerated the local candidate ID as `RyrrGW1XSRsA5B94RZrd2`. The release manifest and task register now bind the current checkout to that ID. The matching 24-check history/report browser record at `2026-10-02T20:17:16.923Z` includes desktop and 390px warm-offline PDF parity, queued deletion mirroring, offline privacy locks, account isolation and cleanup. Earlier build IDs in this checklist remain historical evidence references. Release status remains NO-GO; no provider, deployment or external action occurred.

## Current candidate boundary correction: 2 October 2026, 20:34 UTC

The monitoring scrub slice regenerated the local candidate ID as `LTKX-eA3DPWpyth-XdVN1`. The matching 24-check history/report browser record at `2026-10-02T20:30:53.111Z` includes desktop and 390px warm-offline PDF parity, queued deletion mirroring, offline privacy locks, account isolation and cleanup. The local monitoring boundary passed two focused tests and typecheck; Sentry setup, alert delivery and production scrubbing remain open. Release status remains NO-GO; no provider, deployment or external action occurred.

## Current candidate hard-navigation diagnostics: 2 October 2026

The temporary diagnostics-only analytics build produced a zero-settle pass, a two-second readiness failure and a two-second repeat pass. The result tracks provider readiness relative to input and calculation timing; it does not make a two-second settle a product fix. The normal candidate was restored as `ZJQv_k9n1bWVBKPw5W-oR`. Evidence is recorded in `docs/analytics-acceptance.md`; hard-navigation acceptance and live provider gates remain open. Release status remains NO-GO.

## Current candidate rebuild: 2 October 2026, 22:11 UTC

The normal analytics-disabled candidate `ZJQv_k9n1bWVBKPw5W-oR` passed the 19-route production build. Its current Clerk/Convex browser flow passed 32 checks and its recovery flow passed 8 checks, with zero cleanup errors. The diagnostics-only build was not retained. Provider access, hard-navigation acceptance, production configuration and release approval remain open; release status remains NO-GO.

## Candidate history evidence correction: 2 October 2026, 20:49 UTC

Candidate `2Bu3MZWREPtxsAbL9cmPp` has a failed exact history/report rerun: 13 checks completed, then the offline deletion-pending assertion timed out twice. Keep the earlier LTKX pass as historical evidence only; installed-app, real-device, provider and release gates remain open.

The same `2Bu3MZWREPtxsAbL9cmPp` candidate then passed the corrected 32-check Clerk/Convex comparison flow, including offline save/reconnect, account isolation and confirmed sign-out privacy. Evidence: [comparison-auth-browser.json](evidence/comparison-auth-browser.json), checked at `2026-10-02T21:35:44.004Z`. The reset hydration wait was harness-only. Installed-app and real-device acceptance, live provider reconciliation, retention/deletion and release approval remain open.

A focused one-account probe against 2Bu3 passed warm-offline queueing and rendered `Deletion pending`; this narrows the remaining issue to the long two-account/report harness. It does not close the release gate.


## Current history browser fix: 2 October 2026, 22:51 UTC

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed the complete 24-check history browser flow, including same-account two-tab deletion propagation, cold offline locking, reconnect deletion and foreign-record rejection. The fix adds a metadata-only `storage` event fallback beside `BroadcastChannel`; private finance data remains in the private store. Integrated Clerk/Convex (32 checks), recovery (8 checks), provider-focused tests (70), the full suite (1,059), typecheck and the 19-route build also passed. Installed-app and real-device acceptance, provider retention/deletion, production configuration, Mixpanel reconciliation and release approval remain open. Release status remains NO-GO.

## Current candidate evidence boundary refresh: 3 October 2026

The exact current candidate is `ydMzVTyEiY_q6uNn7FXx1` at source revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2`. The release manifest is authoritative for its current checks: 1,059/1,059 tests across 111 files, typecheck, the 19-route build, 32 integrated Clerk/Convex browser checks, 24 history/report checks, 8 recovery checks, 13 guest offline checks, 5 open-tab service-worker upgrade/rollback checks and 7 responsive results-table checks. The fresh MVP capture and local redacted rehearsal cut are recorded in [demo-day.md](demo-day.md) and [the redaction metadata](evidence/demo-edits/demo-capture-current-ydMz-redaction.json).

Earlier landing, guest comparison, source-map and Supabase records remain useful historical development evidence. The current manifest also binds fresh landing, guest comparison, account-export, source-map and legacy-adoption checks to `ydMzVTyEiY_q6uNn7FXx1`; the older records must not be read as verification of the current candidate. Release status remains NO-GO because Mixpanel access/reconciliation, production configuration, recovery/deletion verification, installed-app/device acceptance, Chronicle export retrieval, Runway access, human media review and release approval remain open.

The full suite was rerun against `ydMzVTyEiY_q6uNn7FXx1` at `2026-10-03T00:05:26.1434435Z`: 1,059 tests passed across 111 files. Evidence: [current-full-suite-rerun-2026-10-03.json](evidence/current-full-suite-rerun-2026-10-03.json). This is verification evidence only and does not change the NO-GO decision.

The same candidate's landing browser check passed 13/13 at `2026-10-03T00:21:54.399Z`, and the current local source-map scan found zero `.map` files or `sourceMappingURL` markers under `public` and `.next/static`. Evidence: [landing-browser.json](evidence/landing-browser.json) and [local-source-map-check-2026-10-03.json](evidence/local-source-map-check-2026-10-03.json). Hosted and production asset checks remain open.

The candidate's guest comparison rerun then passed 11/11 at `2026-10-03T00:29:00.948Z`, covering the two-offer form, refresh parity, bounded sign-in handoff and 320px return view. Evidence: [comparison-browser-after.json](evidence/comparison-browser-after.json). Authenticated provider and device acceptance remain open.

### Current candidate privacy and scrubbing checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 26 focused privacy and error-scrubbing tests across four files. The checks cover sensitive-proof rejection, deletion-journal allowlisting, monitoring payload scrubbing and auth-provider cleanup errors. Evidence: [privacy-scrubbing-local-2026-10-03.json](evidence/privacy-scrubbing-local-2026-10-03.json). Production alert delivery, provider retention/deletion, security review and release approval remain open.

The current candidate history harness was rerun with report checks at `2026-10-03T00:55:32.776Z`: 24/24 Chrome 154 checks passed, including desktop PDF generation/download parity, 390px warm-offline PDF parity and containment, two-tab deletion propagation, cold-offline privacy locking, reconnect deletion, foreign-account isolation and cleanup. Evidence: [comparison-history-browser.json](evidence/comparison-history-browser.json). This is development-browser evidence; installed-app, real-device, provider retention/deletion, live Mixpanel reconciliation and production approval remain open.

The current candidate also passed the 5-check guest provider-outage browser rerun at `2026-10-03T00:59:34.201Z`: the guest comparison remained usable while eight Clerk/provider requests were blocked, and private `/loan` and `/account` routes stayed locked. Evidence: [guest-provider-outage-browser.json](evidence/guest-provider-outage-browser.json). The intercepted `ERR_FAILED` console messages are expected from the deliberate outage context; this does not prove member persistence or production provider behavior.

The read-only hosted development performance sample at `2026-10-03T00:43:29.396Z` captured 36 route/viewport samples with no harness errors. Medians were response end 336 ms, DOMContentLoaded 373 ms, load 523 ms, LCP 964 ms, CLS 0 and TBT 0 ms, within the probe's diagnostic lab thresholds. Evidence: [hosted-performance-sample-2026-10-02.json](evidence/hosted-performance-sample-2026-10-02.json). This is not production approval and does not cover authenticated/provider state, Mixpanel, real devices, controlled network, field data or release sign-off.


## Current candidate analytics preference checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 14 development preference and identity checks on Chrome 154: unknown and declined defaults, stable affirmative consent, distinct account UUIDs, forged-argument rejection, stale-revision fencing, withdrawal suppression and disposable Clerk cleanup. Evidence: [analytics-preference-dev-20261003T010425Z.json](evidence/analytics-preference-dev-20261003T010425Z.json). Two synthetic Convex preference rows remain because no reviewed public deletion operation exists. Mixpanel ingestion, dashboard reconciliation, provider retention/deletion, account-switch acceptance and production approval remain open.

## Current-candidate loan integration checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 56 disposable Chrome checks with the loan integration slice enabled: email OTP and invalid-code handling, account binding, loan and quote save/reload, offline quote recovery, cold-offline privacy, responsive account/loan status, keyboard sign-out, UI deletion and cleanup. Evidence: [clerk-browser-loan-20261003T011547Z.json](evidence/clerk-browser-loan-20261003T011547Z.json). Production email delivery, installed-app and real-device acceptance, provider cleanup, retention/deletion and release approval remain open.

### Current candidate static secret-boundary checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed a source boundary scan: no disallowed secret, private, deploy or key environment references were found in client-scoped code, while six secret references remained in server-only paths. Evidence: [secret-boundary-static-2026-10-03.json](evidence/secret-boundary-static-2026-10-03.json). Bundler output, deployment secrets, provider configuration, runtime headers and security owner review remain open.

## Current candidate local Mixpanel contract checkpoint: 3 October 2026

The current checkout passed 53 focused tests across five analytics files for adapter serialization, event allowlisting, configuration gating, provider consent lifecycle and integration behavior. Evidence: [mixpanel-contract-local-2026-10-03.json](evidence/mixpanel-contract-local-2026-10-03.json). This strengthens local integration evidence only; live ingestion, dashboard reconciliation, provider retention/deletion and release approval remain open. The release manifest now binds 114 task evidence references with no missing paths.

## Current candidate bundle secret-boundary checkpoint: 3 October 2026

The local `.next` output contained zero matches for the non-public secret values present in `.env.local`. Dependency-name references from bundled SDK/source text are reported separately. Evidence: [secret-boundary-build-2026-10-03.json](evidence/secret-boundary-build-2026-10-03.json). This closes the local bundle-value slice only; deployment secrets, runtime headers, provider configuration and security-owner review remain open.

## Fresh results-table keyboard-scroll rerun: 3 October 2026, 22:48 BST

The two-offer table now reserves a 20rem minimum width so the 320px labelled region has a meaningful horizontal scroll range after a responsive resize. Typecheck, focused semantic tests (2/2), the full suite (1,059/1,059 across 111 files), the 19-route build and the Chrome browser check (7/7) passed. Evidence: [accessibility-results-table-local-2026-10-03-rerun.json](evidence/accessibility-results-table-local-2026-10-03-rerun.json). This is a fresh local source-equivalent check; the release manifest remains bound to the reviewed `ydMzVTyEiY_q6uNn7FXx1` build and the full A11Y-01/A11Y-02 gate remains open.

## OfferGrid keyboard-scroll rerun: 3 October 2026, 23:05 UTC

The comparison input grid now exposes a labelled focusable region, reserves a 20rem two-offer content track, and handles ArrowLeft/ArrowRight/Home/End when the 320px viewport needs horizontal access. Typecheck, the focused comparison suite (20/20), the full suite (1,060/1,060 across 111 files), the 19-route build and a 10-check Chrome probe passed with zero page errors. Evidence: [offer-grid-browser-2026-10-04.json](evidence/offer-grid-browser-2026-10-04.json) and [local-rebuild-verification-2026-10-04.json](evidence/local-rebuild-verification-2026-10-04.json). This is source-equivalent local evidence; installed-app, assistive-technology, device, provider and release gates remain open, and the reviewed candidate binding remains `ydMzVTyEiY_q6uNn7FXx1`.

## One-pager local regeneration: 4 October 2026, 00:12 BST

The bundled Python build regenerated the designed TrueCost one-pager and rechecked the PDF assertion. It remains one page, renderable and contains the required borrower, comparison and public-release language. The rendered PNG was inspected at full output size with intact margins and no visible clipping. Evidence: [demo-artifact-machine-check-2026-10-04.json](evidence/demo-artifact-machine-check-2026-10-04.json). Chronicle export retrieval, editor permission and reviewer acceptance remain open.

## Task-register path audit: 4 October 2026, 00:15 BST

The 34-task register now resolves all 120 listed evidence references against the current checkout. Evidence: [task-register-file-audit-2026-10-04.json](evidence/task-register-file-audit-2026-10-04.json). This is a documentation path check; the NO-GO decision and its provider, production, human-review and submission gates remain unchanged.

## Local Mixpanel contract rerun: 4 October 2026, 00:19 BST

The focused analytics contract suite passed again: 53 tests across five files covering adapter serialization, event allowlisting, configuration, consent lifecycle and integration behavior. Evidence: [mixpanel-contract-local-rerun-2026-10-04.json](evidence/mixpanel-contract-local-rerun-2026-10-04.json). This remains local evidence only; provider ingestion, dashboard reconciliation, retention/deletion and production approval are open.

## Evidence-register rerun: 4 October 2026, 00:21 BST

The 34-task register now resolves all 123 listed evidence references, with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-rerun.json](evidence/task-register-file-audit-2026-10-04-rerun.json). This confirms local file paths only and does not close provider, production, human-review or submission gates.

## Three-offer keyboard-scroll rerun: 4 October 2026, 00:26 BST

The member add-offer path now has a focused regression covering the three-offer 30rem track and ArrowRight/Home/End movement. The focused comparison suite passed 21/21 and the full suite passed 1,061/1,061 across 111 files. Evidence: [offer-grid-three-offer-local-2026-10-04.json](evidence/offer-grid-three-offer-local-2026-10-04.json). Installed-app, assistive-technology, device and release gates remain open.

## Service-worker upgrade rerun: 4 October 2026, 00:28 BST

The local open-tab worker check passed all five checks: generated assets were complete after upgrade and rollback, unrelated cache content was preserved, and reloads remained controlled. Evidence: [service-worker-upgrade-browser-rerun-2026-10-04.json](evidence/service-worker-upgrade-browser-rerun-2026-10-04.json). Installed-app upgrade and rollback, device coverage and release approval remain open.

## Current-build verification rerun: 4 October 2026, 08:18 BST

The current checkout passed `npm run typecheck` and `npm run build`, generated 19 routes, and produced source-equivalent local build ID `llH6YCL2zRu1VEYvtRTd7`. Evidence: [current-build-rerun-2026-10-04.json](evidence/current-build-rerun-2026-10-04.json). The reviewed candidate binding remains `ydMzVTyEiY_q6uNn7FXx1`; this local check does not close provider, production, installed-app, human-review or release-approval gates, so release remains NO-GO.

## Hard-navigation current-candidate preflight: 4 October 2026, 08:37 BST

The normal candidate keeps `NEXT_PUBLIC_ANALYTICS_ENABLED=false`, so the enabled intercepted account-switch harness had no consent control to exercise and stopped before provider or Mixpanel requests. Evidence: [hard-navigation-current-candidate-preflight-2026-10-04.json](evidence/hard-navigation-current-candidate-preflight-2026-10-04.json). Enabled-build readiness probes remain diagnostic only; hard-navigation acceptance stays open.

## Evidence-register audit after hard-navigation preflight: 4 October 2026, 08:42 BST

The 34-task register now resolves 124 evidence references with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final.json](evidence/task-register-file-audit-2026-10-04-final.json). This path check does not close provider, production, human-review or submission gates; release remains NO-GO.

## Current-build secret-boundary rerun: 4 October 2026, 08:52 BST

The source-equivalent current `.next` output contained zero matches for the non-public environment values checked locally. Evidence: [secret-boundary-build-rerun-2026-10-04.json](evidence/secret-boundary-build-rerun-2026-10-04.json). This does not verify deployment settings, runtime headers, provider state or security-owner approval.

## Evidence-register audit after secret-boundary rerun: 4 October 2026, 08:54 BST

The 34-task register now resolves 125 evidence references with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final2.json](evidence/task-register-file-audit-2026-10-04-final2.json). This local path check does not change the NO-GO release decision.

## Local response-header boundary: 4 October 2026

The local Next response policy now applies `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a deny-by-default `Permissions-Policy` to application and offline routes. A built-server probe returned all three policies on the root, offline shell, service worker and hashed offline asset while preserving route-specific cache directives. Evidence: [security-headers-local-rerun-2026-10-04.json](evidence/security-headers-local-rerun-2026-10-04.json). Hosted delivery, CSP/HSTS/frame policy review, operator alerting and security-owner approval remain open; the release remains NO-GO.

## Source-equivalent offline and multi-tab rerun: 4 October 2026

The current source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed all 24 Chrome 154 history checks, including warm and cold offline privacy locks, second-tab deletion propagation, reconnect deletion, report parity at desktop and 390px, foreign-account isolation and keyboard-reachable history controls. Evidence: [comparison-history-browser.json](evidence/comparison-history-browser.json). This strengthens local development evidence only; interrupted-save, installed-app/device coverage, provider retention/deletion and release approval remain open.

## Source-equivalent loan browser rerun: 4 October 2026

The current source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed 56 Chrome 154 loan-flow checks covering email OTP, account binding, loan and transfer-quote save/reload, warm and cold offline recovery, responsive account and loan status, keyboard sign-out access, UI deletion and disposable cleanup. Evidence: [clerk-browser-loan-current-2026-10-04.json](evidence/clerk-browser-loan-current-2026-10-04.json). Production email delivery, provider retention/deletion, installed-app/device acceptance and release approval remain open, so release remains NO-GO.

## Evidence-register audit after loan browser rerun: 4 October 2026

The 34-task register now resolves all 128 listed evidence references, with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final3.json](evidence/task-register-file-audit-2026-10-04-final3.json). This confirms local file paths only and does not close provider, production, human-review or submission gates.

## Local abuse-limit and monitoring boundary: 4 October 2026

The focused local security boundary suite passed 39 tests across six files for server-enforced comparison, feedback and export limits, monitoring scrubbing, sink-failure isolation and response headers. Evidence: [security-abuse-limits-local-2026-10-04.json](evidence/security-abuse-limits-local-2026-10-04.json). Operator alert receipt, hosted header delivery, provider quotas and release switches remain open; release remains NO-GO.

## Evidence-register audit after abuse-limit boundary: 4 October 2026

The 34-task register now resolves all 129 listed evidence references, with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final4.json](evidence/task-register-file-audit-2026-10-04-final4.json). This confirms local file paths only and does not close provider, production, human-review or submission gates.

## Hosted development OTP revalidation: 4 October 2026, 01:24 BST

The approved development endpoint `https://truecost-ebon.vercel.app/` at deployment `dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7` passed 12 current Chrome 154 checks with authorized disposable development-data mutation for Clerk SDK readiness, invalid and accepted synthetic OTP handling, account provisioning, explicit sign-out and disposable cleanup. Evidence: [clerk-browser-hosted-current-2026-10-04.json](evidence/clerk-browser-hosted-current-2026-10-04.json). The harness created and deleted a disposable Clerk identity and provisioned development account data; no hosted settings changed. This does not establish source-candidate parity, comparison save/history/PDF behavior, production inbox delivery, provider reconciliation or release approval; release remains NO-GO.

## Evidence-register audit after hosted revalidation: 4 October 2026

The 34-task register now resolves all 130 listed evidence references, with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final5.json](evidence/task-register-file-audit-2026-10-04-final5.json). This confirms local file paths only and does not close provider, production, human-review or submission gates.

## Current provider lifecycle local rerun: 4 October 2026, 01:32 BST

The current checkout and build `1iwP4oc_H3NlGLD2I7W_j` passed 70 tests across four provider and account-lifecycle files. Evidence: [provider lifecycle current rerun](evidence/provider-lifecycle-local-current-2026-10-04.json). This confirms local mounted analytics account-switch fencing and disposal, durable provider deletion claim/retry/lease/poll transitions, and signed-out cleanup retry safety. Live Mixpanel ingestion, dashboard reconciliation, provider-side retention/deletion and production approval remain open.

The 34-task register now resolves all 131 listed evidence references, with zero missing paths. Evidence: [task-register-file-audit-2026-10-04-final6.json](evidence/task-register-file-audit-2026-10-04-final6.json). Release remains NO-GO.

## 4 October 2026 account-export rerun

The current local source-equivalent build '1iwP4oc_H3NlGLD2I7W_j' has fresh 14-check account-export evidence, including A/B isolation, scoped export and signed-out rejection. The verifier deleted both disposable Clerk identities and the run-owned comparison. Convex profiles, receipts, export-session metadata, provider retention and production configuration remain unverified. Release decision remains NO-GO pending the open gates in the candidate manifest.

## 4 October 2026 current browser UI checkpoint

Fresh read-only browser evidence passes 13 landing checks and 7 guest-results checks against build '1iwP4oc_H3NlGLD2I7W_j'. The run covers desktop and mobile layout, theme and reduced-motion paths, semantic results headers, numeric completeness, keyboard scrolling and no provider writes. Full authenticated, installed-app, real-device, production and visual-owner review gates remain open.

## Current local suite checkpoint: 4 October 2026, 01:57 BST

The source-equivalent checkout at revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2` and build 1iwP4oc_H3NlGLD2I7W_j passed `npm test -- --maxWorkers=2`: 112 files and 1,063 tests in 61.48 seconds. The command exited 0; the two expected JSDOM unsupported-navigation diagnostics did not produce test failures. This covers local unit, UI and Convex tests only. Production provider configuration, hosted ingestion, installed-app/device acceptance, human review and signed release approval remain open, so release status stays NO-GO. Evidence: [current-full-suite-rerun-2026-10-04.json](evidence/current-full-suite-rerun-2026-10-04.json).

## Current-build demo assembly: 4 October 2026, 02:23 BST

Fresh landscape and portrait candidates were assembled from the current redacted product capture with the accepted 180.683-second narration and burned captions. FFmpeg reports 180.68 seconds and null decode exit 0 for both outputs; contact sheets show the comparison, saved result, history and report states, with the authentication interval held away from view. Evidence: [assembly record](evidence/demo-edits/truecost-current-1iwP4oc_H3NlGLD2I7W_j-assembly.json). Full human playback/listening, normal-playback caption review, reviewer access and final acceptance remain open, so TASK-029 and release stay NO-GO.

## Current MVP demo flow checkpoint: 4 October 2026, 02:04 BST

The current source-equivalent build 1iwP4oc_H3NlGLD2I7W_j passed 17/17 disposable Chrome checks for the guest comparison, email OTP return, Convex acknowledgement/list/get, history/detail, PDF parity, sign-out privacy and owned cleanup. The raw capture is unshareable; its local redacted rehearsal is 85.84 seconds, so it remains a rehearsal slice rather than the final 180-240 second film. Evidence: [current MVP checks](evidence/clerk-browser-mvp-demo-current-2026-10-04.json) and [redaction metadata](evidence/demo-edits/demo-capture-current-1iwP4oc_H3NlGLD2I7W_j-redaction.json). Full playback/listening, reviewer access, final assembly and production release remain open.

## Hosted security-header observation: 4 October 2026

The approved hosted development origin returned HTTP 200 and HSTS, but omitted the three policy headers present in the local Next configuration: `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. The deployment is not proven source-equivalent to the current checkout, so this remains an open hosted configuration gap. Evidence: [hosted-security-headers-current-2026-10-04.json](evidence/hosted-security-headers-current-2026-10-04.json). Production header delivery, CSP/frame policy review, operator alert receipt, provider quotas and release switches remain open; release remains NO-GO.

## Current landing rerun: 4 October 2026, 03:48 BST

The current source-equivalent local build `1iwP4oc_H3NlGLD2I7W_j` passed 13 read-only landing checks across desktop light, theme persistence, keyboard destinations, 320px reduced motion and 390px dark responsive contexts. Browser, console and request-failure counts were zero. Evidence: [landing-browser-current-rerun-2026-10-04.json](evidence/landing-browser-current-rerun-2026-10-04.json). This closes the recorded local landing slice while full visual-owner, security, accessibility, authenticated, installed-app, real-device and production acceptance remain open. The manifest path audit reports 70 paths and the task register audit reports 157 references, all present. Release remains NO-GO.

## Current results-table rerun: 4 October 2026, 03:56 BST

The source-equivalent local build `1iwP4oc_H3NlGLD2I7W_j` passed seven read-only guest results checks at 1280px and 320px. Semantic table associations, numeric completeness, keyboard scrolling, page containment and zero provider writes all passed. Evidence: [results-table-browser-current-rerun-2026-10-04.json](evidence/results-table-browser-current-rerun-2026-10-04.json). Authenticated, installed-app, real-device, provider and production acceptance remain open. The manifest path audit reports 71 paths and the task register audit reports 158 references, all present. Release remains NO-GO.

## Normal source-equivalent build and Mixpanel contract reruns: 4 October 2026, 04:02 BST

The normal analytics-disabled local build `R-YV2Ykfq677oTDdfRFCj` passed 13 landing checks and seven guest results checks. The explicitly enabled development build `-L66mtneUM2GHq_Pbd9zp` passed six intercepted Mixpanel consent and payload checks with no provider requests leaving localhost. Evidence: [normal landing](evidence/landing-browser-normal-rerun-2026-10-04.json), [normal results](evidence/results-table-browser-normal-rerun-2026-10-04.json) and [intercepted Mixpanel](evidence/analytics-mixpanel-browser-2026-10-04T03-00-26-605Z.json). Live Mixpanel ingestion, dashboard reconciliation, retention/deletion and production acceptance remain open. The manifest path audit reports 74 paths and the task register audit reports 164 references, all present. Release remains NO-GO.

## Current normal-build demo capture and assembly: 4 October 2026, 04:23 BST

The normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 17/17 disposable Chrome MVP checks. A fresh raw 88.56-second capture was redacted over the authentication interval and assembled with the accepted narration and burned captions into current 16:9 and 9:16 local candidates at 180.68 seconds. FFmpeg null decode and black-frame checks passed for both outputs, and sampled contact sheets were inspected. Full human playback/listening, reviewer access, Chronicle export retrieval and final submission approval remain open. Evidence: `evidence/clerk-browser-mvp-demo.json`, `evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-assembly.json` and `evidence/demo-assembly-machine-check-R-YV2Ykfq677oTDdfRFCj.json`. Release remains NO-GO.

The refreshed register binds this checkpoint with 76 manifest paths and 175 task evidence references, all present. Release remains NO-GO while human media review, authenticated Chronicle export, Runway access and production approval remain open.

The post-assembly reconciliation at 03:23:15.166Z binds `task-register-file-audit-2026-10-04-final29.json` and the current 76-path audit. The browser evidence records authorized disposable development and provider-data mutations only; provider settings, hosted settings, production, deployment, commit, push and submission remain false.

## Current normal-build history and offline rerun: 4 October 2026, 04:37 BST

The normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 24 history/offline checks covering report parity, second-tab deletion mirroring, warm/cold offline privacy, reconnect deletion, foreign-account isolation and narrow history controls. Run-owned comparisons and disposable Clerk identities were cleared. Evidence: [comparison history browser](evidence/comparison-history-browser.json). The current manifest binds this R-YV2 evidence; the task register now resolves 175 references and the path audit 76 paths with zero missing entries. Interrupted-save, provider-side retention/deletion, installed-app/real-device, production and release-approval gates remain open.

## Mixpanel dashboard access recheck: 4 October 2026, 04:52 BST

A read-only Chrome probe of the approved TrueCost Development project URL redirected to Mixpanel's `Request Access` page and reported that permission or login is required. No request form was submitted and no project or provider setting changed. Evidence: [current Mixpanel dashboard access](evidence/mixpanel-dashboard-access-current-2026-10-04.json). TASK-015 remains partial until a permitted project member session can verify live ingestion and dashboard reconciliation. The refreshed audits resolve 176 task references and 77 manifest paths with zero missing entries; release remains NO-GO.

## Runway guest access probe: 4 October 2026, 03:58 UTC

The read-only Runway probe reached the guest tool navigation. This records navigation access only. Account access, credits, rights, approved exports and reviewer acceptance remain open, and no credit or generation action was used. Evidence: `evidence/runway-access-current-2026-10-04.json`. Release remains NO-GO.

## Hard-navigation readiness timing diagnostic: 4 October 2026, 04:13 BST

The explicitly enabled development build `M5BZqNi5kuPRtReRpBP0Q` reproduced a timing pattern consistent with an analytics readiness race in both zero-settle and 2,000 ms-settle intercepted account-switch runs. Account B lost both events in the zero-settle run. It lost only `comparison_started` in the 2,000 ms run although a preference read completed 35 ms before calculation. The raw runs do not record each tracker's attempted-or-skipped decision, so root cause remains open. Evidence: [hard-navigation diagnostic](evidence/hard-navigation-diagnostic-current-2026-10-04.json). No unconsented event was buffered, no calculation was delayed and no navigation workaround was introduced. Authorized disposable development and provider-data mutations occurred; provider settings remained unchanged. Hard-navigation acceptance, live Mixpanel ingestion, dashboard reconciliation and production approval remain open. Release remains NO-GO.

## Hard-navigation caller-decision diagnostic: 4 October 2026, 04:35 BST

The diagnostics-only build `I6LLUZppRvjau-wvpU4Xm` added opt-in User Timing marks at the analytics caller boundary. The zero-settle run recorded input and comparison completion skipped while the store was loading, with provider acceptance committed after calculation and zero A events. The matched 2,000 ms run recorded accepted context before input/calculation, queued both A and B pairs and passed 13 checks. Evidence: [caller-decision summary](evidence/hard-navigation-diagnostic-track-decision-current-2026-10-04.json) and its two raw records. This supports an event-level readiness race as the current explanation, while product acceptance remains open. No buffering, calculation delay or navigation workaround was introduced; Mixpanel stayed intercepted and provider settings stayed unchanged. Authorized disposable development/provider-data mutations occurred, and disposable Clerk identities were deleted. Release remains NO-GO.

## Current checkout build after diagnostics instrumentation: 4 October 2026, 04:40 BST

The normal analytics-disabled environment was restored after the diagnostic run. `npm run build` passed with 19 generated routes and produced `bm38SzfSfXwstgpYCARC4`; evidence is [the latest current-build rerun](evidence/current-build-rerun-2026-10-04-latest.json). No provider setting, deployment, commit, push or external submission occurred. Provider, production, human-review and signed release gates remain open, so release remains NO-GO.

## External gate handoff packet: 4 October 2026, 06:15 BST

The local candidate and evidence chain are ready for the following owner actions. Each item must produce the named evidence before its task can move to complete.

| Owner action | Required evidence | Current boundary |
| --- | --- | --- |
| Mixpanel project member grants read access to the configured development project and runs the synthetic consented A/B checks | Ingestion records, event payload inspection, funnel/dashboard counts, consent coverage, identity reset and deletion confirmation | Read-only probe reached Mixpanel Request Access; no request was submitted. |
| Rajesh/Ritesh verify production Vercel, Clerk, Convex, domain, monitoring, backup and recovery settings | Versioned configuration checklist, rollback proof, RPO/RTO timing, alert receipt and deletion replay | No production settings, deployment or provider mutation has been performed. |
| Chronicle owner grants editor access and retrieves the actual PDF export | Export file, one-page/page-count check and reviewer acceptance | Signed-out editor route redirects to share view; local PDF is only a preparation artifact. |
| Runway owner confirms account, credits, rights and approved export scope | Account/rights record plus exported supporting assets | Guest tools are visible; no generation, credit use or export occurred. |
| Presenter and release owners watch the complete demo and approve it | Playback/listening checklist, caption readability check, reviewer access and joint go/no-go decision | Local 180.68-second masters pass machine checks; human review is open. |
| Submission owner confirms destination, deadline and package owner | Written destination/owner record and authorized submission receipt | No package has been submitted. |
| Finance/privacy/support owners approve methodology, policy and public trust content | Signed review record, approved public wording and support owner/contact | TASK-017 remains partial pending independent review and approval. |
| Security/accessibility owner completes the full matrix | Security-header/CSP/frame review, alert receipt, screen-reader/contrast/zoom results, installed-app/PWA upgrade and real-device performance records | Local slices pass; hosted headers, full accessibility, installed-app and device evidence remain open. |
| Pilot owner runs the controlled pilot and records outcomes | Participant protocol, dated outcome dataset and wider-release decision | TASK-021 and TASK-022 have no pilot evidence. |
| Deployment owner validates the public URL and candidate parity | Public URL check, source/build identity, deployment freeze record and rollback target | TASK-024 and TASK-027 remain open; the hosted deployment is not proven equivalent to the current candidate. |

No access request, login, provider setting, production change, credit use or submission was made while preparing this packet.
