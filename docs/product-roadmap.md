# TrueCost production implementation roadmap

Status: Execution v1.5, 15 September 2026. The user started the master goal and accepted D1. Production readiness takes priority over Demo Day. There are 22 production tasks and 12 Demo Day/support tasks; completion requires acceptance evidence. Pilot audience: registered users in India. Other services remain on free plans; the user separately approved the existing paid Vercel plan (DEC-010). Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review; completed reviews remain open. Local implementation and fresh development Clerk/Convex setup are authorized; production publishing retains separate approval. See [decisions](product-decisions.md) and [execution log](execution-log.md).

Read [PRD](prd.md), [technical design](technical-design.md), [UI behavior](ui-spec.md), [analytics plan](analytics-plan.md) and [launch checklist](launch-checklist.md) together. Terminal commands and copyable approval prompts are in [WORKFLOW.md](WORKFLOW.md).

## Current priority and verified baseline

**16 September demo ordering update:** Rajesh confirmed 15:30 UK today for the MVP demo. The immediate path is guest comparison → email sign-in/signup → save → history/detail → PDF, with a fresh local build and exact-flow browser evidence. Loan health feedback, live analytics and production gates follow this checkpoint. This changes execution order, not the full goal or publication approvals.

The active goal prioritizes **production readiness before demo work**, **Clerk email OTP only**, and **local work plus fresh development Clerk/Convex setup**. Phone sign-in is deferred. Requested orchestration: **gpt-6-astra / xhigh**; verified worker dispatch: **gpt-5.6-luna / high**. The runtime does not expose a main-model selector. See the [goal prompt](CODEX-GOAL.md), [execution log](execution-log.md) and [skill sequence](SKILL-SEQUENCE.md).

| Evidence | Verified status |
| --- | --- |
| Local checkout | `codex/truecost-production` at `b9e53c0`; upstream integrated and local `AGENTS.md`/`docs/` preserved |
| Latest inspected upstream | `b9e53c00219f778294a904e9b3175a9bb5bb26c2` |
| Naming update | `557dcb1`: Compare Loan Offers, Loan Health Monitor, Understand Your Policy; insurance remains unavailable |
| Authentication update | `b9e53c0`: email-only entry, disclosed on-device demo OTP fallback, enforced member access for Loan health/prepayment |
| Upstream verification | [CI run](https://github.com/riteshg87/truecost/actions/runs/35011561798): 137 tests in 10 files, typecheck and production build passed |
| Last integrated checkpoint | 474/474 tests in 40 files and production build passed on 16 September. BUILD_ID `2ptyOcKPxF0W0l8fJL_3V`; history routes and durable deletion are included. [History browser evidence](evidence/comparison-history-browser.json). The prior loan checkpoint remains in [historical integration evidence](evidence/private-integration-build-2026-09-16.json) |
| Deployment | Vercel commit status reports completion; this does not replace live browser verification |
| Development foundations | Clerk custom email flow has mounted-test coverage; Convex profiles/saved loans passed two-account provider checks. Public offline assets passed local and partial browser checks. Three finance corrections have focused evidence |
| Development browser checkpoint | Earlier comparison build: 11/11 guest checks plus 61/61 connected checks, covering OTP restart/return, comparison save/read/delete, member three offers, comparison/loan offline recovery, 320/390px layout and confirmed sign-out. [Browser report](comparison-auth-browser-verification.md). Prior failed attempts remain archived, with possible synthetic orphan records awaiting cleanup |
| Still pending | Full shared-device/cross-tab acceptance, real email delivery, comparison history and remaining intent acceptance, PDF, feedback, Mixpanel, sensitive account actions, operational and release checks |

The upstream baseline used an on-screen demo code that proved no email ownership.
Local auth now uses Clerk with explicit configuration checks and no demo member
fallback. The old Supabase client, schema and packages are retired locally; the
remaining TASK-007/008 gaps are account-safe lifecycle acceptance and server
acknowledgement before deleting the original device copy. The reference
deployment has not received this working tree. Development-provider and
mounted-test evidence does not establish production authentication or release
readiness. The bounded loan browser flow above has now passed; the wider
acceptance gaps remain explicit.

Execution order: TASK-001 establishes the latest local baseline; TASK-002 records remaining decisions; TASK-003/004 prepare contracts/design; continue production phases in dependency order. Keep phase review checkpoints, but the submitted goal prompt permits continuing approved local/dev work without asking for repeated phase approvals. Ask only about missing product decisions, paid commitments, destructive effects or production/external actions outside that authorization.

## Execution horizons

| Horizon | Outcome and tasks | Evidence/dependencies |
| --- | --- | --- |
| Now | Reproducible source baseline, accepted decisions, selected skill setup and versioned contracts: TASK-001/002/003 | Fresh source/checks; D1/D2 accepted; provider assumptions proved before binding lifecycle contracts |
| Next | Implement the guest-to-member flow and production protections: TASK-004 through TASK-020 | Accepted contracts, actual account access, per-slice tests, browser evidence and integrated release checks |
| Later | Controlled pilot, wider release and final submission: TASK-021 through TASK-034 | Named human owners, financial/privacy approval, measured recovery, media/export access and applicable publishing approval |

Root owns acceptance; Luna executes bounded work. Limit active implementation to one dependency-ready slice until shared contracts exist. Review this horizon after each accepted slice and when provider/finance evidence changes. Unknown product outcomes stay unknown; maintenance, privacy and recovery are required work, not optional polish. Independent demo drafting may proceed during an external production dependency.

## Demo Day deadline retained

Complete the [Demo Day tasks TASK-023 through TASK-034](#demo-day-deliverables) against the [submission brief](demo-day.md): one-page problem-selection rationale, deployed product link and a 3-4 minute pitch/demo video. Chronicle and Runway support these deliverables through TASK-033/034; follow dependencies rather than treating their appended IDs as later execution dates. A deck or PRD is optional. Submissions are due **before Wednesday 8 PM IST**, with the playback/feedback session at **10 PM IST**. Working date: **16 September 2026, tentative**; the copied announcement's “day after tomorrow” wording needs confirmation.

Production readiness now takes precedence over this presentation work. Retain the date as a constraint, flag any forecast conflict, and ask the user to choose a reduced demonstration if needed; do not silently cut production gates to meet it. Demonstrate verified behavior and state unfinished features honestly. The organizer's deadline is not evidence that the app is ready.

## Release boundary

The first production release includes a useful guest comparison, Clerk accounts, owned Convex records, saving/history, client PDF, optional member feedback, consented Mixpanel, privacy controls, error monitoring and tested recovery. Preserve the existing Loan health/prepay engine and loan-premium calculations. Term insurance, payments, live quotes, OCR, history search/rename and a dedicated operations dashboard are deferred.

Documents use existing paths where known and label proposed modules explicitly. Confirm the current file structure and installed Next.js guidance before each phase. Inspect working changes; do not replace unrelated work. Tests must target behavior and trust boundaries, not merely mirror implementation.

## Phase 1: Baseline, contracts and release decisions

This is the first implementation slice of the active goal. It prepares a reproducible local build and testable contracts; fresh development setup follows under the recorded authorization.

- [x] **TASK-001**: Integrate the latest upstream work safely and establish the local baseline.
  Files: `package.json`, `package-lock.json`, `.nvmrc`, `README.md`; preserve versions unless a justified compatibility/security change is approved.
Evidence: [baseline-verification.md](baseline-verification.md). Fast-forwarded from `2cf936a` to `b9e53c0` on `codex/truecost-production`, preserved existing work, installed the lockfile, and passed typecheck, all 137 tests and production build. Root reviewed the README diff and corrected its overbroad demo-auth claim. No source/dependency-version changes, commits or pushes.

- [ ] **TASK-002**: Resolve remaining product defaults and assign decision owners.
  Files: `docs/prd.md`, `docs/technical-design.md`, `docs/ui-spec.md`.
  Notes: D1 launch defaults and D2 email OTP are accepted. The pilot audience is registered users in India. Monthly service budget is ₹0/free plans; Rajesh and Ritesh jointly own release approval, privacy, support and methodology review. Production regions, retention, domain, coverage, actual reviews and D6 pilot details remain open. Do not ask for the accepted defaults, names or budget again.

- [ ] **TASK-003**: Define snapshot, intent, owner, request, revision and error contracts.
  Files: existing `lib/finance/types.ts`, `lib/store.tsx`, `lib/loanStore.tsx`; proposed `lib/contracts/`, contract tests.
  Notes: FR-01/04/05/14/15/17. Add behavior tests for snapshots, duplicate request identity, stale revision rejection and safe destinations. Prove the proposed recent-authentication grant bridge for sensitive account actions using current provider guidance before committing to it. Preserve the finance engine. Agree payload limits and version handling before backend work; any real provider test requires development-cloud authorization.
  Progress: TASK-003A pure snapshot/intent helpers accepted after root review and fixes, with 150/150 full tests and final root typecheck passing. See [contract evidence](contracts-verification.md). Owner, server receipt/revision and recent-authentication work remain open.

- [ ] **TASK-004**: Review the visual references and finish implementation-ready screen specifications.
  Files: `docs/ui-spec.md`; proposed `docs/design.md`, `docs/design.html`; reference files in Downloads are read-only inputs.
  Notes: Cover every loading/error/offline/account state and obtain visual review. Match the user's design rules and asset licences. No application redesign is bundled into the baseline task.
  Progress: reference inspection and user-confirmed teal/table direction are recorded; design.md and design.html exist. Original and duplicate Revolut references match exactly. Full browser acceptance remains open in [design verification](design-verification.md).

Exit evidence: clean baseline checks, reviewed contracts/specs, documented decisions and a small diff. Astra reviews the phase before dispatching the next; routine review is not a new user-approval gate under the submitted goal.

## Phase 2: Identity, ownership and safe persistence

Depends on the relevant Phase 1 contracts; D1/D2 are resolved. The active goal authorizes fresh Clerk/Convex development setup and disposable test data. Confirm account/project identity and obtain user login interaction only where needed; do not repeat scope approval. Production resources, paid upgrades and provider mutations retain their approval boundaries.

- [ ] **TASK-005**: Integrate Clerk and explicit access states.
  Files: `app/layout.tsx`, `app/signin/page.tsx`, `app/verify/page.tsx`, `lib/auth/provider.tsx`, `lib/auth/access.ts`, `components/RouteGuard.tsx`; proposed provider/config modules and placeholder `.env.example`.
  Notes: FR-03/08/16. Implement real Clerk email OTP; phone is deferred. The upstream demo sign-in is partial UI progress only. Distinguish identity loading, verified member, guest and unavailable provider. Private operations fail closed; production must never grant membership through an on-screen code or local session. Use static supported public configuration access. Test allowed internal redirects, cancellation, expiry, missing/malformed keys and a production-build configuration check.
  Progress: TASK-005A SDK/config and TASK-005B local provider/email-code UI foundations are accepted. Mounted tests cover guest sign-in/sign-up, cancellation, account mismatch, retries and StrictMode. Root's integration checkpoint passed 212 tests and the production build. On 17 September the user confirmed email receipt, and root directly observed the authenticated hosted Account page showing the intended signed-in account. Integrated private-client/browser failure paths and production Clerk configuration remain open. See [auth flow evidence](clerk-flow-verification.md) and [identity foundation evidence](identity-foundation-verification.md).

- [ ] **TASK-006**: Implement owned Convex records and idempotent lifecycle functions.
  Files: proposed `convex/schema.ts`, `convex/auth.config.ts`, comparison/loan/profile/lifecycle modules and tests.
  Notes: FR-04/14/15/20. Runtime validation, owner-derived queries, bounded pages and atomic request deduplication. Test two-account direct-ID attacks, forged owners, repeated requests, expired auth and provisioning/webhook races. Actual dev-backend checks follow cloud authorization.
  Progress: TASK-006A profiles, TASK-006B saved loans and TASK-006C immutable comparisons are accepted through development verification. Saved loans passed 28 real-provider assertions; comparisons passed 34, using two Clerk-signed synthetic accounts against approved `dutiful-fly-37`. Owner isolation, duplicate requests, pagination and deletion replay passed; temporary sessions were revoked and created financial payloads removed. See [comparison evidence](comparison-backend-verification.md), [saved-loan evidence](saved-loan-backend-verification.md) and [identity evidence](identity-foundation-verification.md). Account lifecycle, private client integration, browser authentication and retention remain open.

- [ ] **TASK-007**: Replace global private storage with account-bound state and durable outbox.
  Files: `lib/loanStore.tsx`, `lib/sync/loanSync.ts`; proposed local storage/outbox adapter and integration tests.
  Notes: FR-05/15/16. Reload locks until the same member is verified; logout clears after warning. Test offline saves, quota failures, late callbacks, cross-tab account switches, retry limits, conflicts and deletion resurrection. Every loan-edit path must persist revision/state accurately.
  Progress: TASK-007A/B/C loan storage, sync controller and session-bound adapter have integrated React and development-browser evidence; see [sync evidence](private-sync-verification.md), [transport evidence](private-transport-verification.md) and [UI evidence](loan-ui-verification.md). Comparison global storage is now replaced by immutable public results, private account/tab partitions and a bounded receipt-backed outbox. The comparison workspace/transport suites pass 31 focused checks, including concurrent claims, lease recovery, retry/expiry limits and stale discard protection. See [comparison integration evidence](comparison-integration-verification.md). Explicit legacy adoption, paused-job recovery, full cross-tab/cold-offline and lifecycle acceptance remain open.

- [ ] **TASK-008**: Retire the Supabase test path and offer explicit legacy device-data adoption.
  Files: `lib/auth/provider.tsx`, `lib/loanStore.tsx`, `app/account/page.tsx`, dependency/config references.
  Notes: FR-08/16/19. No Supabase server import or mutation. Remove the implicit demo-membership fallback from production and prevent a legacy demo session from becoming a trusted Clerk identity. Preserve actual local loan data until explicit adoption/clear choice; duplicate import is safe. Replace inaccurate privacy and “Synced” copy. Remove obsolete packages only after replacement checks pass.
  Progress: The verified-member account page now offers import, keep, or confirmed removal for the older `truecost.loan.v1` device record. Import uses the existing account-bound outbox, keeps the original key while queued, and offers removal only after the matching acknowledgement. Account-bound adoption metadata now restores the pending or acknowledged removal state after reload, stays isolated per profile, stores a digest instead of financial values, and is bound to the original device payload before removal. The unused Supabase modules, schema and packages are removed; the local source scan, 1,055-test suite, typecheck and 19-route build pass. Evidence: [legacy device adoption](evidence/legacy-device-adoption-local-2026-10-02.json), [authenticated browser adoption](evidence/legacy-device-adoption-browser.json) and [Supabase retirement](evidence/supabase-retirement-local-2026-10-02.json). The disposable browser run imported only after explicit choice, verified the Convex acknowledgement, confirmed device-copy removal and deleted the imported account record. Full account-page, installed-app and broader lifecycle acceptance remain open.

- [ ] **TASK-009**: Harden service-worker caching before any private connected preview.
  Files: `public/sw.js`, `components/ServiceWorker.tsx`, `app/manifest.ts`; proposed browser tests.
  Notes: FR-18. Public-static allowlist; no auth/private APIs, exports or authenticated HTML cached. Test upgrade from the current cache, sign-out/reload and two accounts before demonstrating cloud history.
  Progress: TASK-009A has 16 focused tests and the latest isolated Chrome run passed 13 checks, including server-stopped navigation/calculation, unchanged result reload, action gates, cache exclusions and mobile table scrolling. Evidence: [offline browser smoke](evidence/offline-browser-smoke.json). Root inspected desktop/mobile captures. Integrated private-client gating, sign-out, full browser restart and two-account app checks remain open. See [offline evidence](offline-calculator-verification.md).

Exit evidence: verified development identity and ownership, account-isolated offline recovery, no private cache leaks, preserved device data. A mocked backend alone cannot satisfy this exit.

## Phase 3: Complete the guest-to-member value flow

Depends on Phase 2. These tasks produce the first connected end-to-end demo.

- [ ] **TASK-010**: Implement guest completion and action gates with resumable intent.
  Files: `app/compare/page.tsx`, `app/compare/results/page.tsx`, `lib/store.tsx`; proposed intent module/tests.
  Notes: FR-01/02/03. Full first result remains visible; invalid attempts do not consume quota. Save/download/new/changed-input intents survive auth and resume once. Test fresh routes, Back, refresh and multi-tab auth.
  Progress: Two-offer first-result persistence, changed-input/New/Save gates, durable edited-draft handoff, explicit cancellation, member three-offer support and account-scoped save return are implemented. The mounted comparison provider suite covers 14 cases; the guest browser path passes 11 checks. Four further auth/public-form regressions protect startup and OTP restart without weakening private account isolation. Connected development evidence and remaining limits are linked in [comparison verification](comparison-integration-verification.md). Download/PDF and the full interrupted/multi-tab matrix remain open; this task is not complete.

- [ ] **TASK-011**: Add immutable saved comparison history and deletion.
  Files: proposed `app/comparisons/page.tsx`, `app/comparisons/[id]/page.tsx`; results components and Convex comparison functions.
  Notes: FR-04/15. Paginated newest-first history, honest queued/confirmed states, safe missing records. Opening a historical snapshot after an engine change reproduces the original figures. Current saved loan remains separate.
  Progress: Member history routes, snapshot-only rendering and durable account-bound deletion are implemented. The current candidate passed 24 development-browser checks with desktop and 390px warm-offline PDF parity, two-account isolation, 320/390px history lists, queued deletion mirrored to a second tab, warm/cold offline locks, keyboard cancellation/focus return and verified cleanup. Twelve mounted UI tests pass. Installed-app upgrades, the broader PWA matrix, cold private report reload, hosted provider behavior and remaining release acceptance are open. See [implementation handoff](history-implementation-slice.md).

- [ ] **TASK-012**: Generate PDF/print reports from snapshots.
  Files: proposed `lib/reports/`, report components; `app/compare/results/page.tsx` and saved result view.
  Notes: FR-06/17. Choose compatible library after licence/size review. Prove exact displayed-value parity, Indian currency, long labels, three offers, page breaks, offline-loaded assets, mobile download activation and retry. No cloud report object storage in this slice.
  Progress: Snapshot-only report core and bundled fonts are implemented with seven passing focused tests. Root visually checked the two-page three-offer sample after correcting missing basic Latin font coverage; fees, versions, figures and disclaimer were present. See [core evidence](pdf-core-verification.md). Current and saved member report controls, guest-auth report return, print fallback and Blob cleanup are implemented locally. Ten lifecycle tests pass, including expired download/print denial, immediate fallback hiding and out-of-order rendering. The current candidate's 24-check history/report browser run verified desktop PDF download, stored lender and EMI/repayment parity, and a 390px warm-offline download. See [integration evidence](report-integration.md). Cold private report reload, mobile print/download and measured device performance remain open. TASK-012 is not complete.

- [ ] **TASK-013**: Add optional comparison and Loan health feedback.
  Progress: TASK-013A owner-derived backend reviewed locally; 11 focused tests passed on 16 September. Context uniqueness, retries, quota recovery and account isolation are covered. TASK-013B prompt/transport implementation is underway. Live-provider verification, route integration and admin/export/deletion support remain open; this task is not complete.
  Files: proposed feedback component/module, `app/compare/results/page.tsx`, `app/loan/page.tsx`, Convex feedback functions.
  Notes: FR-07/21. Once per result/version, optional comment, safe rendering, honest acknowledgement, retry deduplication. Test guests excluded and no blocking of primary actions.

Exit evidence: guest result -> sign-in -> exactly one save -> reopen -> matching report, plus member feedback. Demo success and failure paths on a phone and desktop.

## Phase 4: Privacy, measurement and product trust

Depends on Phase 3. No real-user pilot until this phase and the relevant Phase 5 gates pass.

- [ ] **TASK-014**: Implement account export, account deletion and retention jobs.
  Files: `app/account/page.tsx`; proposed Convex lifecycle/export/retention modules and tests.
  Notes: FR-14/15/16. D3 required. Recently authenticated owner-only JSON export; bounded/paginated retrieval; resumable cross-provider deletion, immediate access block and backup deletion replay. Exercise duplicate/out-of-order webhooks, provider outage and restored backup scenarios.
  Progress: Owner/session-bound paginated export is development-deployed. Historical fresh-auth and older-session records contain 17 and 19 checks; the latest current-build browser acceptance is the separate 14-check rerun recorded below. Signed-out rejection and cross-account direct lookup denial passed. Local cancellation and error-redaction regressions passed on 17 September; live cancellation and populated saved-loan/feedback export remain open. Account-wide deletion has a reviewed local access-block/purge foundation and provider transport checks. Durable provider orchestration and captured-account browser cleanup have passed local review and focused tests. The stable deletion request coordinator now supports same-session replay after private access is revoked; mounted auth tests cover account-scoped deletion signals. Account UI and same-session reload recovery are implemented locally, including stable request replay, receipt-bound removal and cleanup retry; the integrated checkpoint passed 865 tests, followed by passing typecheck, production build and 24 focused mounted-provider tests after UI fixes. Cross-tab persistent cleanup and same-page signed-out retry now have local modeled coverage, including bounded storage opens, stale-writer rejection and account B preservation. An explicit signed-out browser-wide cleanup entry is now integrated locally, preserving guest work and requiring confirmation. The 17 September checkpoint passed 902 tests across 94 files and a production build; actual-browser confirmation, Escape cancellation and focus restoration passed without deleting data. Subsequent analytics cleanup and ordinary grant-expiry fixes passed 54 affected tests, then an integrated 912-test/95-file suite and production build on 17 September. An isolated actual-browser two-tab harness subsequently verified both stores clear, notice receipt, stale-writer rejection and empty storage after reload with synthetic data; see [browser evidence](evidence/private-browser-two-tab-harness.md). Full-app Clerk/React destructive/multi-tab acceptance remains open; ongoing finance-model work is outside that privacy checkpoint. Signed-out reload cleanup completion, actual browser multi-tab deletion, live provider deletion and restored-backup replay remain incomplete. These local checks do not establish hosted deletion acceptance. See [deletion acceptance plan](account-deletion-acceptance-plan.md). No production acceptance is claimed.

- [ ] **TASK-015**: Implement Mixpanel analytics with consent and validate the dashboard (P0).
  Files: proposed `lib/analytics/`, consent controls, event wrapper tests; hooks at documented result/auth/save/report/feedback transitions.
  Notes: FR-09. Follow `docs/analytics-plan.md`; confirm the authorized Mixpanel project, region, retention and environment separation before SDK setup. Instrument comparison completion, auth and resumed intent, acknowledged saves, report generation/download initiation, and member feedback using the existing event contract. Consent defaults off; use the exact payload allowlist, identity reset and no sensitive SDK default properties. Keep autocapture/session recording off. Compare a seeded funnel to dashboard counts, test opt-out/account switching/deletion and blocked-provider behavior. Do not use consented analytics as a complete count of all users.
  Progress: The eleven-event validator, configuration gate, consent/identity controller, SDK adapter and preference backend have 44 passing focused tests. Fourteen actual development-provider preference checks passed; see [backend evidence](analytics-backend-verification.md). They establish bounded contract and backend behavior, not end-to-end analytics acceptance. The user-approved TrueCost Development project (4064154) is created on the Free plan with US storage and Asia/Kolkata timezone; see [setup evidence](mixpanel-development-setup.md). Later guest verification delivered comparison_started and comparison_completed to the development provider with HTTP200/body1 acknowledgements. The internal synthetic-only board11529933 shows one starting and one completing test identity. This proves the guest sample only, not member funnels or user outcomes. Feedback acknowledgement instrumentation was added on 17 September with opaque analytics IDs, consent/account lifecycle guards and nine mounted analytics tests. The parent full suite passed 1,033 tests across 107 files, typecheck and build. Member/save/report/feedback delivery passed the dated live development check below. Account transitions, canonical member identity resolution, retention/deletion and complete dashboard acceptance remain open. Tracking remains disabled in the hosted review and normal local configuration; the verification used an explicitly enabled local process. See analytics-plan.md for dated evidence.

- [ ] **TASK-016**: Add scrubbed errors, operational alerts and abuse/cost limits.
  Files: proposed monitoring configuration, error boundaries, server throttles and release feature controls.
  Notes: FR-13/20/22. Verify a synthetic error reaches the assigned operator without finance/identity payloads. Test provider outages, retryable limits and switches that preserve calculation. Confirm budget thresholds with D4; no paid purchase implied.
  Progress: Nested Clerk errors map to bounded, stable messages. Root reproduced and fixed raw exception text in account export and PDF generation; 16 export and 22 report tests passed after the respective fixes. See [error-boundary evidence](evidence/account-export-error-boundary.md). These local checks do not establish operator alert delivery or operational acceptance.

- [ ] **TASK-017**: Publish reviewed help, methodology, privacy and terms content locally.
  Files: proposed public pages; `app/account/page.tsx`; `lib/health/repo.ts`, `app/loan/setup/page.tsx`, finance/health/prepay fixtures if approved corrections are needed.
  Notes: FR-17/19/21. D3/D5 required. Source/effective-date policy and independent financial examples; suppress unsupported current-rate recommendations. Document support route and feedback review ownership. A disclaimer does not replace correct calculations.
  Progress: FIN-BUG-01/04/05 are corrected locally: the June 2025 repo entry is 5.50%, reset timing uses calendar anniversaries, and prepayment retains a partial final-payment remainder. Root passed 25 health and 35 prepayment tests. Hard-coded spread, benchmark freshness, fee budgets, tax treatment, public explanations and human review remain open in [finance findings](finance-review-findings.md).
  Later checkpoint, 17 September: the accepted equal-extra-budget fee treatment has local reference fixtures. DEC-014 requires a complete reviewed post-tax model before release. A dated, tax-neutral loan schedule now passes 11 focused tests, but is not integrated into the tax recommendation. [Schedule evidence](evidence/prepay-dated-schedule-review.md) and [model contract](evidence/prepay-tax-model-contract.md) describe the remaining work; the earlier fee-budget item is superseded by its accepted implementation. The normalized input contract now has 15 passing focused tests covering dates, capacity coverage, asset facts and equal-budget consistency; complete structure still reports financial support as unsupported. Independent dated arithmetic fixtures are recorded in [ledger fixtures](evidence/prepay-ledger-independent-fixtures.md). Dated deduction and investment tax-event arithmetic passed root review and a combined 34 focused tests with the input contract. Gross investment growth preserves dated contribution lots. Equal-budget funding, three dated scenarios, accrual arithmetic and disposal-route composition have local regression coverage. The 17 September 14:27 full checkpoint passed 977 tests in 103 files and typecheck; it does not establish financial review or current production-build acceptance. Annual ordinary-income assessment, its normalized context adapter, and annual interest accrual passed 54 focused tests in four files at 15:12 on 17 September, including raw and statutory-rounding bracket-crossing reference values. The malformed-grid rejection fix passed focused disposal-route tests. Annual deduction-benefit integration now uses the shared assessor and preserves dated receipts; receipt/audit binding and a small-deduction precision regression are covered. Parent passed 79 combined finance tests and typecheck at 15:32 on 17 September. Mixed special-income allocation, future-year assumptions, eligibility and full route/UI integration remain open. Official 2025 Act sources refreshed on 17 September identify annual basic-exemption context as a further policy-adapter requirement. No new post-tax recommendation is integrated or approved.

Exit evidence: privacy lifecycle works, no prohibited telemetry, financial review recorded, support/alerts assigned and tested. Real-user notices match actual data behavior.

## Phase 5: Release proof, controlled pilot and publication

Depends on Phase 4 and D3-D6. Release preparation is distinct from permission to publish.

- [ ] **TASK-018**: Run full functional, security, accessibility and performance acceptance.
  Files: existing and proposed tests; `docs/launch-checklist.md` evidence links.
  Notes: NFR-01 through NFR-06, FR-01 through FR-20. Typecheck, tests and build plus real-device browser checks. Verify PWA install/offline/update, two-account isolation, reports and all recovery states. Record lab evidence honestly before field data exists.
  Progress: The restored local build `yAPHNfIW8scb2GyyGdBIo` was a historical checkpoint for the refreshed results-table, landing and guest comparison browser runs. Evidence: `evidence/results-table-browser.json`, `evidence/landing-browser.json` and `evidence/comparison-browser-after.json`. A hosted development performance harness also captured 36 read-only samples; evidence: `evidence/hosted-performance-sample-2026-10-02.json`. These close narrow layout and landing slices only; the current candidate boundary is recorded in the release manifest and the full functional, security, accessibility and performance gate remains open.

- [ ] **TASK-019**: Prove production configuration and disaster recovery in an isolated environment.
  Files: proposed operational runbook/config documentation, `docs/launch-checklist.md`.
  Notes: FR-22, NFR-07/08. D4 required. Verify environment separation, owner access, email/domain settings, backups, deletion replay, old/new app-backend compatibility and recovery time. Prepare a concrete release/rollback command set for the actual provider projects; do not run production mutations yet.
  Progress: Added [release-runbook.md](release-runbook.md) with the current candidate record, local preflight, approval-gated Vercel preview/promotion/rollback commands, Convex backup/restore and deletion-ledger replay steps, compatibility checks and stop conditions. No production command was run; provider entitlements, domain access, restore timing and signed approval remain open. The exact current candidate boundary is captured in [release-candidate-manifest-2026-10-02.json](evidence/release-candidate-manifest-2026-10-02.json); its full 1,061-test baseline remains tied to the earlier recorded build.

- [ ] **TASK-020**: Review go/no-go evidence and obtain the specific release authorization.
  Files: `docs/launch-checklist.md`, release evidence.
  Notes: Every P0 gate has a named owner, build/date and result. Resolve any critical failure. State the exact deployment target, data effects, rollout and rollback plan for approval. No push/deploy is implied by a checked implementation task.

- [ ] **TASK-021**: Run the approved controlled pilot and evaluate outcomes.
  Files: proposed pilot findings, `docs/analytics-plan.md`, release evidence.
  Notes: Publish/invite only within explicit authorization. Review incidents daily, feedback twice weekly, and mature metric windows. Stop expansion on financial errors, cross-account exposure or loss of acknowledged saves. Small samples remain uncertain.

- [ ] **TASK-022**: Approve wider release based on actual pilot evidence.
  Files: release decision and reviewed roadmap.
  Notes: Validate field performance where sample coverage permits, recovery readiness and support coverage. Product accepts D6 outcomes or revises scope with reasons. Insurance receives a separate PRD and approval after this release.

## Demo Day deliverables

These tasks follow production-readiness work under the user's selected priority. Keep the deadline visible and flag conflicts without changing that priority silently. Required deliverables take priority over the optional pitch deck. Assign owners and record final links in [demo-day.md](demo-day.md). Meeting requests to push code are historical discussion, not publication authorization.

- [ ] **TASK-023**: Confirm Demo Day date, submission destination and deliverable owners.
  Files: `docs/demo-day.md`.
  Notes: Organizer specifies Wednesday, submissions before 8 PM IST, playback at 10 PM IST. Tentative date is 16 September 2026. Confirm the upload/form/channel and file/link permissions; inventory any existing one-pager or recording before creating duplicates. Owner: submission coordinator, unassigned.

- [ ] **TASK-024**: Audit the latest team build and freeze an honest demo scope.
  Files: repository/deployment evidence; `docs/demo-day.md`.
  Notes: Partial: source review is complete through `b9e53c0`, with 137 passing CI tests and a successful Vercel deployment status. The email/demo flow and renamed features are verified in source. Live browser/mobile verification, the synthetic demo example and final demo scope remain pending. Show Clerk/Convex/Mixpanel behavior only when implemented and tested. Owner: engineering/demo lead, unassigned.

- [ ] **TASK-025**: Review mobile/PWA demo usability and triage the meeting's UI concerns.
  Files: `docs/ui-spec.md` and demo evidence; possible later edits to comparison results, Loan health/setup and prepay screens only within approved implementation scope.
  Notes: Check mobile layouts and PWA mode; reduce repetitive recommendation copy if confirmed; make reset/new-comparison controls discoverable without bypassing guest gates. Review asking surplus cash when entering Prepay vs invest, rather than requiring it during initial loan setup, and clarify transfer labels. Log findings, then prepare narrowly scoped fixes for approval. Choose mobile or desktop recording from the tested result. Owner: design/engineering, unassigned.

- [ ] **TASK-026**: Finalize the one-page problem-selection rationale.
  Files: proposed `docs/demo/one-pager.md` and a one-page shareable export.
  Notes: Explain the borrower, problem, real alternatives considered, why this problem won, evidence and assumptions, proposed solution and shipped MVP boundary. Reuse/review the existing draft mentioned in the meeting if available. Do not infer an exact idea count from the noisy transcript or invent research/traction. Use TASK-033 for the Chronicle layout/export after the copy is reviewed. Acceptance: one readable page that answers why this problem over the others. Due before the submission cutoff.

- [ ] **TASK-027**: Validate the deployed product link for submission.
  Files: `docs/demo-day.md` final artifact register.
  Notes: Current review target is https://truecost-ebon.vercel.app/ (development Clerk/Convex); truecost-lac is the older reference. Publication to the new own-account Vercel project is authorized and deployed. Verify the public entry and chosen demo flow in a fresh browser/mobile session, record the tested build/date, and ensure reviewers can reach it. If fixes require deployment, prepare the exact change for separate approval. Acceptance: accessible, tested link matching the demonstrated version. Existing URL is a reference, not a fresh availability check.
  Progress: A fresh signed-out Codex In-app Browser check on 2 October rendered the landing page, guest home, `/compare` and `/compare/results` with the synthetic offers and guest action gates. Evidence: [hosted development guest check](evidence/hosted-development-guest-browser-2026-10-02.json). This remains development evidence; production configuration, reviewer access and release approval are open.

- [ ] **TASK-028**: Write and rehearse a timed elevator-pitch plus product-demo script.
  Files: proposed `docs/demo/video-script.md` and shot list.
  Notes: Total duration 3-4 minutes including the demo; aim for 3:30 using the timing in `docs/demo-day.md`. Cover problem, why selected, a working product walkthrough, MVP scope and how success will be measured. Review the organizer's linked video reference during this task. Use claims supported by TASK-024 and the one-pager. Owner: presenter, unassigned.

- [ ] **TASK-029**: Record, edit and verify the final 3-4 minute video.
  Progress, 16 September: landscape and portrait review candidates are exported at 180.683 seconds with the approved free English narration. Corrected scene order, reserved caption space, hashes and complete decoding were checked. Full playback/listening and final acceptance remain open. See `docs/evidence/demo-edits/truecost-hosted-development-assembly.json`. Earlier failed edits are labelled rejected drafts.
  Files: proposed final video and accessible playback link, recorded in `docs/demo-day.md`.
  Notes: Record actual product behavior with synthetic data. Combine the recording with Chronicle visuals and the reviewed short Runway assets from TASK-033/034. Keep generated visuals separate from the evidence of app behavior; do not generate or alter screens to imply features work. Use an available editor for final assembly, narration and captions; verify export capability before committing the whole cut to a tool. Check readable screens, clear audio, total duration 180-240 seconds and a complete beginning/end. Replay the exported file fully and test link access as a reviewer. A script or collection of clips alone does not satisfy the video deliverable. Finish before the submission cutoff.

- [ ] **TASK-030**: Optional: prepare a pitch deck or a clearly labelled PRD snapshot.
  Files: proposed deck or shareable PRD snapshot; `docs/demo-day.md`.
  Notes: Use Chronicle via TASK-033 for the optional deck, or the existing PRD snapshot if that is the fastest useful option. Cover problem space, solution/MVP scope and success measures. Separate implemented behavior from production proposals. This is optional and must not delay TASK-026, TASK-027 or TASK-029; mark completed or explicitly skipped with reason.

- [ ] **TASK-031**: Review and submit the complete Demo Day package before 8 PM IST Wednesday.
  Files: `docs/demo-day.md` artifact links, review and submission evidence.
  Notes: Confirm one-pager, tested product URL and final video; include optional deck/PRD only if ready. Check permissions and open each link from a signed-out reviewer session. Obtain final review and submission authorization, submit through the confirmed destination, and record receipt/time. Adding this task does not itself authorize sending or publishing files. Owner: submission coordinator, unassigned.

- [ ] **TASK-032**: Attend the Wednesday 10 PM IST playback and capture feedback.
  Files: proposed `docs/demo/feedback.md`.
  Notes: The announcement says recordings will be played and Shravan will give team feedback. Record feedback, decisions and follow-up tasks with source/context. Reflect validated changes in the roadmap and PRD; do not silently replace production commitments. Owner: team representative, unassigned.

### Separate Chronicle and Runway production tasks

These support the original deliverables; they are not extra organizer requirements. Production readiness retains priority. Content is prepared locally first; carry existing authorization into execution, and obtain missing permission for external creation/uploads, credit spend or public sharing. This task-list update itself creates no presentation or generated video.

- [ ] **TASK-033**: Produce the one-pager and optional pitch assets in Chronicle.
  Files: proposed `docs/demo/chronicle-brief.md`, one-page PDF, optional deck/PDF, artifact links in `docs/demo-day.md`.
  Dependencies: reviewed TASK-026 copy and TASK-024 demo scope; supports final acceptance of TASK-026 and optional TASK-030, and provides visual assets to TASK-029.
  Notes: Use the user-selected Chronicle workspace. Inspect existing materials before creating a TrueCost document; do not overwrite unrelated decks. Build the one-pager first. If time permits, create a short deck covering problem, selection rationale, working solution/demo, MVP boundary and success measures. Confirm export options and inspect the actual PDF: the one-pager must be exactly one readable page. Deck creation is optional; do not block required submissions on it. Use only verified claims and reusable TrueCost visuals. Record document/export links and sharing status. Owner: presentation lead, unassigned.
  Acceptance: reviewed one-page export; optional deck completed or explicitly skipped; no invented traction or unapproved publication.

- [ ] **TASK-034**: Prepare Runway video assets and an editing handoff for the Demo Day film.
  Files: proposed `docs/demo/runway-brief.md`, storyboard/prompts, exported clips and a shot/asset register; final assembly remains TASK-029.
  Dependencies: approved TASK-028 script, TASK-024 verified demo scope and any needed TASK-033 visuals.
  Notes: Check Runway account access, usable tools, export format, watermark rules, available credits and approved spending ceiling. The requested Runway connector is not callable in this session; browser access or a user-operated Runway handoff is the fallback to verify at execution. Use Runway for a brief opening, problem illustration or transition, and retain actual screen recordings for the product walkthrough. Keep the full film within 180-240 seconds. Prepare narration/caption timing with the presenter; record which assets are generated. Runway's legacy video editor is no longer maintained, so plan final assembly in a suitable available editor rather than assuming a single Runway generation will produce the full film. See the [tool notes](demo-day.md#chronicle-and-runway-production-plan). Owner: video lead, unassigned.
  Acceptance: approved short assets exported and inspected, prompts/source/rights recorded, and an editing handoff ready for TASK-029. Tool/credit blockers stay explicit; a prompt alone is not a finished asset.

Dependency order for the added tasks: reviewed one-pager copy -> TASK-033 -> TASK-026 completion; TASK-028 -> TASK-034 -> TASK-029 completion. TASK-030 remains optional. TASK-031 submits the completed package, then TASK-032 captures event feedback. Appended task numbers do not move these steps after the event.

## Evidence and completion rules

For each task, record the commit/build or working-tree reference, tests exercised, exact result, owner and residual risk. Keep a task unchecked when only its design exists. An automated test pass does not certify the entire user flow; browser checks do not prove backend authorization.

Phase 1 is the next production implementation slice. Production readiness is the selected priority; Demo Day tasks and their deadline remain tracked. A task may be partial even when related upstream changes passed CI. Keep completion claims tied to that task's own acceptance checks.





### TASK-015 evidence update: 17 September 2026

Member comparison/save/feedback/PDF delivery now has live development evidence: nine checks and nine provider acknowledgements in `evidence/member-analytics-browser-2026-09-17T15-36-25-275Z.json`; Mixpanel Events independently showed both nine-event synthetic runs. Withdrawal/sign-out suppression passed for the tested sequence. Identity joining/account switching, denominator reconciliation and retention/deletion remain open, so TASK-015 is not complete. Synthetic profile/feedback/analytics cleanup is not proven by comparison and Clerk-user cleanup.

### TASK-015 identity correction: 17 September 2026

A controlled two-event provider probe isolated equal device/member IDs as the fresh-member identity defect. The adapter now assigns a separate random device ID while preserving legitimate guest joins. Real-SDK regression plus full 1,034-test suite/107 files and 19-route production build passed. Corrected app browser/provider verification, account transitions and lifecycle acceptance remain open. Evidence: analytics-plan.md and evidence/mixpanel-identity-probe-observation.json.

### TASK-015 corrected fresh-member flow: verified

Evidence `evidence/member-analytics-browser-2026-09-17T16-11-26-414Z.json`: 15 live checks passed, including stable member IDs across a page reload, separate per-lifetime device IDs, nine acknowledged events, correlation/stage/count checks, PDF parity and withdrawal/signout suppression. Other TASK-015 identity-transition, dashboard denominator and retention/deletion gates remain open.

### TASK-005 OTP stall recovery: 17 September 2026

Added a bounded wait for code-send creation and dispatch, preserving cancellation/generation checks and leaving verified-session finalization unchanged. Full suite1,037/107 and production build61igxZXtteLa9GzAcIUt2 passed. Native-browser retry message/enabled-button behavior verified in evidence/otp-send-timeout-browser.json. Root cause of the provider stall and broader production auth acceptance remain open.

## Guest-to-member analytics verification: 18 September 2026

The authorized Clerk development testing-token flow passed 10 browser checks on local analytics-enabled build GSAY4j5K9ehRo4tBrd1C0. Six synthetic events received HTTP 200/body 1 acknowledgements. Mixpanel's member profile activity feed independently contained all six guest and member events. Evidence: `evidence/member-analytics-browser-2026-09-17T17-14-58-817Z.json` and `evidence/mixpanel-guest-join-observation.json`.

Fixes preserve the validated guest identity and save-action attribution through consent and Clerk reload/hydration, and suppress tracking while authentication is unresolved. Withdrawal and confirmed sign-out suppression passed for this sequence. This does not establish the next guest interaction after sign-out, shared-device/account switching, dashboard denominator reconciliation, or provider retention/deletion. TASK-015 stays open. Synthetic comparison and Clerk-user cleanup does not prove removal of profile/feedback/analytics records. No production authentication settings or deployment changed.

### Withdrawal followed by guest reuse: verified locally, 18 September 2026

The extended development browser harness passed 11 checks on build LQxx6bL8bDMTcotNllltl. After member withdrawal and confirmed logout, it re-entered guest mode, hard reloaded, reopened the original result, and attempted an edited-input recalculation. The recalculation correctly required sign-in; zero additional analytics requests occurred without re-consent. Evidence: `evidence/member-analytics-browser-2026-09-18T09-17-19-872Z.json`. Mixpanel was intercepted in this run; Clerk/Convex development authentication and cleanup were real. This checks suppression, not new provider ingestion.

The initial extended run timed out at landing-page guest entry. Adding the same Clerk-loaded wait used by the initial authentication flow made the next run pass; no navigation implementation changed. That observation supports a harness timing explanation, not a general landing-page reliability claim. Ordinary accepted-member logout without withdrawal, account switching, storage-unavailable reload behavior, denominator reconciliation and provider retention/deletion remain unverified. TASK-015 stays open.

## Local withdrawal acceptance checkpoint: 18 September 2026

- Full suite passed: 1,046 tests / 107 files (`npx vitest run --maxWorkers=2`, 124.46 seconds). Corrected the test probe to label guest events as guest; affected provider/auth-save/browser-clear checks passed 45/45 after that test-only correction. Typecheck passed.
- Normal analytics-disabled build UwXv6ni5ABtDnDNDJjSKz passed TypeScript and all 19 routes. Environment file unchanged. No deployment.
- Browser withdrawal/logout/reload/guest-reuse check passed 11 checks on analytics-enabled build LQxx6bL8bDMTcotNllltl; evidence `evidence/member-analytics-browser-2026-09-18T09-17-19-872Z.json`.
- Tests cover acknowledged and failed remote withdrawal followed by guest remount, plus reported local write failures and successful retry. A complete reload while storage cannot persist remains unverified; the in-memory retry flag is not durable evidence.
- Ordinary logout without withdrawal, account switching, dashboard denominator reconciliation, provider retention/deletion, production domain and reviewed post-tax model remain open. The earlier default-four-worker deletion scheduler failure remains an unresolved test reliability item. TASK-015 and the master goal remain incomplete. Release status: NOT READY.

### Ordinary logout without withdrawal: browser verified, 18 September 2026

Evidence `evidence/member-analytics-browser-2026-09-18T09-41-43-554Z.json`: all 11 checks passed on analytics-enabled local build w03OYdGRzIW1De6QUDKUx. The member still had accepted consent immediately before confirmed logout. After returning as guest and hard reloading, reopening the original result and attempting edited-input recalculation sent zero new analytics requests. Recalculation correctly required sign-in. Mixpanel was intercepted; Clerk/Convex development authentication was real. Run-owned comparisons and the disposable Clerk user/sessions were deleted; profile/feedback/analytics residual removal is not established.

Actual AuthProvider tests cover delayed successful logout and rejected logout. Storage tests cover retaining declined preference, preserving a retry marker when accepted preference cannot be removed, and fallback revocation when marker writes fail. Temporary scope loss does not count as confirmed logout. Account switching, multi-tab provider behavior, all-storage-unavailable reload, dashboard denominators and provider lifecycle acceptance remain open. No production change, deployment, commit or push.

## Superseding regression checkpoint: 18 September 2026

Deletion fixture module preloading passed both complete configurations: `npx vitest run --maxWorkers=2` passed 1,053 tests / 108 files in 126.27 seconds, then unchanged `npm test` (four workers) passed 1,053 / 108 in 70.17 seconds. `npx tsc --noEmit` passed afterward. No assertions, scheduler limits, product code or dependencies were relaxed. Prior intermittent failures remain documented; the evidence supports the cold-loader mitigation, not a deterministic root-cause proof. Watch for recurrence during subsequent normal verification; no extra repetition is required without new evidence.

Only two test fixtures changed in this slice. The normal analytics-disabled app build m7x_M1UwuU7XQ_VbKZYgU remains current. Vite config and jsdom navigation warnings persist without failing these runs. No deployment, commit or push. TASK-015 still needs account-switch/multi-tab, dashboard-denominator and provider-lifecycle acceptance. Production domain, reviewed post-tax model and the remaining release/demo gates are unchanged. Release status: NOT READY; master goal remains active.

## Account-switch verification checkpoint: 18 September 2026

Seven additional account-switch checks passed; full npm test passed 1,060 tests / 109 files, and TypeScript passed. These are mounted-provider/controller tests, not live two-account or multi-tab acceptance. TASK-015 remains incomplete. See [analytics acceptance evidence](analytics-acceptance.md). Application/build output unchanged; no deployment.

## Same-browser analytics switch: 18 September 2026

The online A → logout → B flow passed 13 development browser checks with intercepted SDK requests: B initially had unknown server consent, sent no events until opt-in, then used distinct member/device IDs. Exactly four comparison events, no replay. Both disposable Clerk users were deleted; Convex profiles/preferences remain. Evidence: [13-check run](evidence/member-analytics-browser-2026-09-18T10-31-39-861Z.json).

TASK-015 remains open. A preceding hard-navigation variant captured zero A comparison events after consent; investigate readiness instead of treating the in-app navigation pass as a fix. Offline/multi-tab, dashboard reconciliation and provider lifecycle acceptance also remain open. No deployment.

18 September reload follow-up: two hard-navigation runs with a 2000ms settle passed A events but missed B events. The later Account view showed analytics on without consent/cleanup errors. Exact readiness timing remains open; see analytics-acceptance.md. New work stopped at 95% weekly usage under stay-within-limits; hourly resume check updated. Goal and TASK-015 remain incomplete.

### TASK-015 hard-navigation readiness probe: 2 October 2026

The diagnostic build `hgG8NSc_8cHfLnCR4v1zv` measured auth-bound token resolution, parsed/current preference, accepted-context activation and committed provider status beside actual input and calculation dispatch. The 0ms run recorded token resolution between input dispatches, 124ms before calculation, while the post-click snapshot had no accepted provider marks and zero A events; the matched 2s run committed acceptance before input/calculation and passed 13 checks with A/B pairs. Evidence: `evidence/member-analytics-browser-2026-10-02T18-01-35-965Z.json` and `evidence/member-analytics-browser-2026-10-02T18-00-22-760Z.json`. The final harness adds a failure snapshot; follow-up 0ms/2s runs remained variable and failed existing event assertions. This is diagnostic evidence only. No event buffering, calculation delay, navigation workaround or live Mixpanel delivery was used. Hard-navigation acceptance, provider reconciliation and release gates remain open.

## TASK-015 second-tab auth transition: 2 October 2026

The harness-only second-tab mode passed 16 checks on analytics-enabled build `ixZzRSloataoxhJS76W4Z`: tab 2 signed out account A, tab 1 observed the transition, the held A completion was discarded, and account B later delivered only its own comparison pair after opt-in. Evidence: `evidence/member-analytics-browser-2026-10-02T10-14-31-722Z.json`.

The latest normal analytics-disabled build is `ReTEk8KCoS93Or4lYAuV6`. A single tab reload was used after shared Clerk state settled at the sign-in boundary; no application source changed. Offline analytics transport, Mixpanel dashboard ingestion/reconciliation, provider retention/deletion and production release gates remain open. TASK-015 and the master goal remain incomplete. Release status: NOT READY.

The focused analytics suite passed 65/65 across controller, provider, integration and browser-clear files before this harness-only checkpoint. It covers the in-memory offline queue and reconnect contract; browser offline transport acceptance remains open.

### TASK-015 offline analytics transport checkpoint: 2 October 2026

The 13-check browser evidence `evidence/member-analytics-browser-2026-10-02T10-52-33-729Z.json` blocked only Mixpanel transport while Clerk and Convex remained available. Account A's queued start was discarded at confirmed sign-out; account B stayed silent before opt-in and then delivered only its own pair with distinct identities and insert IDs. The run-owned comparisons and disposable identities were deleted. This closes the narrow provider-available transport-outage check. At that checkpoint, device-level offline transport, Mixpanel ingestion, dashboard reconciliation, provider retention/deletion and production gates remained open; the later device-offline checkpoint below covers the first of those items. TASK-015 and the master goal remain incomplete. Release status: NOT READY.

### TASK-015 local provider lifecycle checkpoint: 2 October 2026

The current checkout passed 69 focused tests across analytics provider, account-switch, mounted cleanup, and provider deletion orchestration files. Evidence: evidence/provider-lifecycle-local-2026-10-02.json. This closes the bounded local lifecycle regression slice. Live Mixpanel dashboard reconciliation, provider retention/deletion, production configuration, and release approval remain open. TASK-015 and the master goal remain incomplete. Release status: NOT READY.

### TASK-015 device offline checkpoint: 2 October 2026

The 15-check browser evidence evidence/member-analytics-browser-2026-10-02T11-12-19-553Z.json set the browser offline after loading the comparison route. Account A's input remained usable, no analytics event was delivered while offline, and one queued start event delivered once after reconnect. The same run covered A-to-B identity isolation and sign-out suppression. This closes the device-level browser offline transport slice. Live Mixpanel ingestion, dashboard reconciliation, provider retention/deletion, production configuration, and release approval remain open. TASK-015 and the master goal remain incomplete. Release status: NOT READY.


### TASK-011 history and multi-tab refresh: 2 October 2026

The current candidate `s6Rd0-6fq4J60XsjN5Kr5` passed the 24-check `scripts/check-comparison-history-browser.mjs` run in Chrome 154 / Playwright 1.62.1 with report mode enabled. It covered same-account save/detail fidelity, desktop PDF download and stored-value parity, a 390px warm-offline PDF download, queued deletion mirrored to a second tab, warm and cold offline privacy locks, reconnect deletion, two-account isolation, foreign-ID read/delete rejection, narrow keyboard layout and disposable cleanup. Evidence: `evidence/comparison-history-browser.json`. This closes the tested history/report/multi-tab slice only; installed-app upgrades, the broader PWA matrix, cold private report reload, hosted provider behavior and release approval remain open.

The rebuilt candidate `HBKsiYtVfcMcoNQ26SNVk` passed the same 24-check history/multi-tab flow in Chrome 154 / Playwright 1.62.1, with the current build ID asserted by the harness. Evidence remains `evidence/comparison-history-browser.json`; the broader PWA matrix, installed-app upgrade, hosted provider behavior and release approval remain open.

The historical checkpoint candidate `yAPHNfIW8scb2GyyGdBIo` then passed a 21-check history/multi-tab run in Chrome 154 / Playwright 1.62.1. It reverified save/detail fidelity, queued deletion propagation to a second tab, warm and cold offline privacy locks, reconnect deletion, two-account isolation, foreign-ID rejection, narrow keyboard layout and disposable cleanup. This refresh did not use report mode; the earlier 24-check report/PDF evidence remains the report reference. Evidence: `evidence/comparison-history-browser.json`. The current `ydMzVTyEiY_q6uNn7FXx1` boundary is recorded in the latest section below. Installed-app upgrade, rollback, the broader PWA matrix, hosted provider behavior and release approval remain open.

### TASK-024 and TASK-028 local demo-flow checkpoint: 2 October 2026

The current candidate `s6Rd0-6fq4J60XsjN5Kr5` passed the 15-check `TRUECOST_MVP_DEMO_CHECK=1` browser run in Chrome 154 / Playwright 1.62.1. It verified the guest two-offer result, preserved save intent through Clerk development OTP, Convex acknowledgement/list/get, matching history/detail, fresh PDF download with stored-value parity, sign-out gating and owned comparison cleanup. Evidence: `evidence/clerk-browser-mvp-demo.json`. This confirms the local demo scope on development resources; it does not prove production email delivery, production access, or final video acceptance. The disposable Clerk user was deleted, while the harness reports that a minimal Convex profile may remain because no Convex deletion operation is available.

The rebuilt local candidate `HBKsiYtVfcMcoNQ26SNVk` also passed the full 61-check comparison/loan browser flow in Chrome 154, including offline reconnect, transfer quotes, cold offline privacy, responsive account and loan status, keyboard sign-out access, UI loan deletion and post-sign-out suppression. Evidence: `evidence/comparison-auth-browser.json`. A first attempt exposed a harness-only reset-settle race; the preserved failure and temporary wait are recorded in the execution log. No product source changed, and this remains development evidence rather than production or provider-retention acceptance.

The same candidate passed the scoped provider-outage browser check 5/5 in Chrome 154: Clerk script requests were blocked inside the disposable Playwright context, while Convex HTTP/WebSocket interceptors were installed but no Convex request occurred in this guest flow. Guest comparison stayed usable, and private `/loan` and `/account` routes stayed locked. Evidence: `evidence/guest-provider-outage-browser.json`. This closes only the local outage-boundary slice; hosted provider behavior, provider-side deletion/retention and production configuration remain open.

The `2Bu3MZWREPtxsAbL9cmPp` checkpoint recovery flow passed 8 Chrome 154 checks for bounded retry exhaustion, explicit same-request recovery, snapshot/request identity preservation, expired queued-save refusal and disposable cleanup. Evidence: `evidence/comparison-recovery-browser.json`, checked at 2026-10-02T21:27:41.989Z. The first copied-harness attempt exposed a Reset settle race; the corrected hydration wait is harness-only and the failed artifact remains preserved. Provider-side deletion/retention and production approval remain open.

The restored yAPH candidate also passed the 15-check MVP demo-flow run in Chrome 154, covering the guest result, Clerk OTP handoff, Convex save/list/get, matching history/detail, stored-value PDF parity, sign-out gating and disposable cleanup. Evidence: `evidence/clerk-browser-mvp-demo.json`. This remains development-resource evidence; production email delivery, reviewer access, Convex profile cleanup, final media review and submission approval remain open.

Focused PWA/accessibility tests passed 10/10 across service-worker, stale-worker and results-table accessibility files. This strengthens local cache and semantic-table evidence only; full screen-reader, contrast, zoom, device and installed-app upgrade acceptance remains open.

The current `ydMzVTyEiY_q6uNn7FXx1` candidate also passed the focused `ResultsTable` semantic suite 2/2 in jsdom, covering the labelled focusable scroll region, semantic headers, explicit cell associations and long lender names without truncation. Evidence: `evidence/accessibility-results-table-local-2026-10-03.json`. This does not close the full browser or assistive-technology gate.

### TASK-014 export rerun warning: 2 October 2026

The first current-build account-export rerun was failed evidence, not acceptance. It passed the fresh-auth and scoped JSON export checks, then encountered Clerk HTTP 429 during the negative-path/cleanup sequence and an unauthorized Convex account-B lookup. The failed state is retained as a summary in `evidence/account-export-browser-failed-2026-10-02T11-58-27-938Z.json`; it is superseded by the later controlled rerun below.

### TASK-014 harness repair: 2 October 2026

The browser verifier now records Convex `Unauthorized` on a foreign comparison ID as a protected outcome alongside `null`, and reuses account A's authenticated Convex client before attempting another Clerk sign-in during cleanup. Syntax and whitespace checks passed. This is harness evidence only; the failed export artifact remains open until one rate-limit-cleared rerun confirms owned-row cleanup.

### TASK-014 browser acceptance rerun: 2 October 2026

The repaired verifier passed 14 checks in Chrome 154 / Playwright 1.62.1. It authenticated two disposable development accounts, downloaded and parsed the scoped JSON export, rejected a signed-out approval request with HTTP 401, confirmed account B had no account-A rows and could not read the foreign direct ID, then deleted the run-owned comparison and both Clerk users. Evidence: `evidence/account-export-browser.json`. Convex profiles, receipts, export sessions and provider records remain unverified because the browser verifier has no reviewed deletion operation for them. Account deletion/recovery and retention acceptance remain open.

### TASK-011 open-tab service-worker upgrade checkpoint: 2 October 2026

The disposable `scripts/check-service-worker-upgrade-browser.mjs` harness passed 3 Chrome 154 checks against offline shell `8ecaf70f4be9b1ec`. It served an N+1 worker, confirmed complete assets, observed eventual removal of the prior owned cache while preserving an unrelated cache, and reloaded the open tab successfully. Evidence: `evidence/service-worker-upgrade-browser.json`.

This closes only the open-tab upgrade slice. Installed-app upgrade, rollback, full accessibility, hosted provider behavior, production configuration and release approval remain open. TASK-011 and the master goal remain incomplete. Release status: NOT READY.

### TASK-033 signed-out Chronicle share checkpoint: 2 October 2026

The Chronicle public share URL opened in signed-out Chrome 154 as TrueCost · Why this problem and rendered the one-page canvas. Evidence: evidence/chronicle-share-browser.json. The share view is reachable; Chronicle PDF export retrieval, editor permissions, full audio review and submission approval remain open. TASK-033 and the master goal remain incomplete. Release status: NOT READY.

### TASK-011 open-tab rollback checkpoint: 2 October 2026

The disposable `scripts/check-service-worker-upgrade-browser.mjs` harness now passes 5 Chrome 154 checks against offline shell `8ecaf70f4be9b1ec`, including N+1 activation, complete assets, unrelated-cache preservation, rollback to N and reload after rollback. Installed-app upgrade/rollback, broader PWA/accessibility coverage and release approval remain open. TASK-011 and the master goal remain incomplete. Release status: NOT READY.

### TASK-010 historical history boundary: 2 October 2026, 22:31 UTC

The restored ZJQ candidate history browser rerun completed the initial two-account save, detail, draft-preservation and cancellation checks, then timed out before the second-tab `Deletion pending` assertion after the first tab queued an offline deletion. The focused local history suite passed 41 tests across three files, and the bounded delete probes remain passing. This keeps the full browser history/report flow, interrupted-save, installed-app/real-device acceptance and provider deletion/retention open. Evidence: [current browser history run](evidence/comparison-history-browser.json) and [local history lifecycle suite](evidence/history-lifecycle-local-2026-10-02.json). TASK-010 and the master goal remain incomplete. Release status: NOT READY.

### TASK-034 local editing handoff checkpoint: 2 October 2026

The local Runway asset register in `docs/demo/runway-asset-register.md` now records the approved opening brief, verified product cuts, narration/captions, hashes, edit order and privacy restrictions. Runway/Higgsfield access, zero-cost generation authorization, rights/export review and final media approval remain open. TASK-034 and the master goal remain incomplete. Release status: NOT READY.

### TASK-028 timed rehearsal script checkpoint: 2 October 2026

The timed script and shot list in `docs/demo/video-script.md` now follows the current 180.683-second narration and local 16:9/9:16 assembly. It names the exact synthetic offers, keeps authentication and private data out of the cut, and records the save acknowledgement and report-ready cues. Presenter rehearsal, full audio listening and final reviewer acceptance remain open; no recording upload or submission occurred.

### TASK-024 and TASK-011 integrated candidate flow: 2 October 2026

The `2Bu3MZWREPtxsAbL9cmPp` checkpoint passed 32 checks in the `scripts/check-clerk-browser.mjs` comparison flow in Chrome 154 / Playwright 1.62.1. Evidence: `evidence/comparison-auth-browser.json`, checked at `2026-10-02T21:35:44.004Z`, with zero errors and zero cleanup errors. Coverage includes two-account isolation, guest comparison, Clerk email OTP, Convex save/list/get, offline queued comparison save and reconnect, responsive account status and confirmed sign-out privacy. The run-owned Clerk user was deleted; the harness cannot delete the Convex profile. This is development-provider evidence only. Installed-app acceptance, live provider retention/deletion, Mixpanel reconciliation, production configuration and release approval remain open.

### TASK-019 candidate verification refresh: 2 October 2026

The candidate manifest records the earlier `2Bu3MZWREPtxsAbL9cmPp` checkpoint verification, 1,059 tests across 111 files, a passing typecheck and a passing 19-route build. Provider, production, installed-app, human-review and submission gates remain open.

### Current candidate privacy and scrubbing checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 26 focused privacy and error-scrubbing tests across four files. Evidence: `evidence/privacy-scrubbing-local-2026-10-03.json`. This strengthens local privacy contracts only; production alert delivery, provider retention/deletion, security review and release approval remain open.

### TASK-015 provider lifecycle refresh: 2 October 2026

The current checkout passed 70 focused tests across analytics provider, account-switch, mounted cleanup and provider deletion orchestration files. Evidence: `evidence/provider-lifecycle-local-2026-10-02.json`, checked at `2026-10-02T21:47:47.1733624Z`. Live Mixpanel reconciliation, provider retention/deletion and production configuration remain open.

### TASK-016 local monitoring boundary checkpoint: 2 October 2026, 20:33 UTC

Added a provider-neutral monitoring scrub boundary that keeps only release, environment, source, stable error code and opaque UUIDs. Focused tests and typecheck passed; messages, URLs, request bodies, user metadata and raw `Error` objects are excluded. Evidence: `evidence/monitoring-scrub-local-2026-10-02.json`. Sentry project setup, operator alert delivery and production scrubbing verification remain open.

### TASK-015 hard-navigation diagnostic repeat: 2 October 2026

A temporary analytics-enabled build produced one zero-settle pass and two controlled 2,000ms observations. The first 2,000ms run timed out with zero events while its preference read crossed the calculation boundary; the repeat passed once the preference read completed before input and calculation. This adds timing evidence without changing the fail-closed provider. The normal candidate was rebuilt as `ZJQv_k9n1bWVBKPw5W-oR`. Hard-navigation acceptance, live Mixpanel reconciliation, provider retention/deletion and production configuration remain open.

### Current candidate rebuild: 2 October 2026, 22:11 UTC

The normal analytics-disabled candidate `ZJQv_k9n1bWVBKPw5W-oR` passed the 19-route production build and the current 32-check Clerk/Convex comparison flow plus the 8-check recovery flow. Evidence: `evidence/comparison-auth-browser.json`, `evidence/comparison-recovery-browser.json` and `evidence/current-candidate-verification-2026-10-02.json`. This refresh rebinds the local candidate after the diagnostics-only build; provider access, hard-navigation acceptance and release approval remain open.

## Current source-equivalent recovery evidence: 4 October 2026, 02:28 UTC

The source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed eight Chrome 154 recovery checks for bounded save retry exhaustion, explicit same-request replay, stable request and snapshot identity, expired queued-save refusal and disposable cleanup. Evidence: `evidence/comparison-recovery-browser-current-2026-10-04.json`. The run used authorized disposable development-data mutation, including provider data creation and deletion; provider settings, hosted settings, production changes, deployment, commit, push and external submission were false. The reviewed release candidate remains separately identified in the manifest; production recovery, provider retention/deletion and release approval remain open.

### Current candidate boundary correction: 2 October 2026, 20:34 UTC

The monitoring slice regenerated the local candidate as `LTKX-eA3DPWpyth-XdVN1`. The matching 24-check history/report browser evidence at `2026-10-02T20:30:53.111Z` is recorded in `evidence/comparison-history-browser.json`; earlier build IDs remain historical references. No provider, deployment or external state changed.

### Current candidate boundary correction: 2 October 2026, 20:23 UTC

The later `npm run build` regenerated the local candidate ID as `RyrrGW1XSRsA5B94RZrd2`. The release manifest and task register now bind the current checkout to that ID. The 24-check history/report browser evidence at `2026-10-02T20:17:16.923Z` is the matching current-run record; earlier build IDs in this roadmap remain historical evidence references. No source, provider, deployment or external state changed.

## Current candidate history rerun checkpoint: 2 October 2026, 20:49 UTC

The monitoring-boundary checkpoint `2Bu3MZWREPtxsAbL9cmPp` passed the integrated 1,059-test/111-file suite, typecheck and 19-route build. Three exact Playwright history runs reached the offline deletion step but timed out waiting for the "Deletion pending" status; the latest evidence is `docs/evidence/comparison-history-browser-2Bu3MZWREPtxsAbL9cmPp-failed.json`. The earlier LTKX 24-check pass remains historical and is not relabelled as this checkpoint. Release remains NO-GO.

### Focused warm-offline deletion probe: 2 October 2026

A short one-account browser probe against the same 2Bu3 build rendered `Deletion pending` and persisted a queued IndexedDB deletion while offline. Evidence: `docs/evidence/comparison-history-delete-probe-2026-10-02.json`. The full two-account/report harness still needs a fresh pass.

A focused two-tab probe on 2Bu3 also showed both same-account tabs receiving the pending deletion state offline. Evidence: `docs/evidence/comparison-history-delete-two-tab-probe-2026-10-02.json`. Reconnect and report parity remain unverified for the current candidate.

### Latest integrated comparison refresh: 2 October 2026, 21:35 UTC

The `2Bu3MZWREPtxsAbL9cmPp` checkpoint passed 32 checks in the Clerk/Convex comparison flow, including authenticated offline save/reconnect, two-account isolation and confirmed sign-out privacy. Evidence: `evidence/comparison-auth-browser.json`. The verifier's hydration wait was harness-only; no product source changed. Installed-app and real-device acceptance, live provider reconciliation, retention/deletion and production approval remain open.


### Current history browser fix: 2 October 2026, 22:51 UTC

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed all 24 checks in the history/report browser harness after the workspace kept its `BroadcastChannel` path and added a metadata-only `storage` event fallback. The same candidate passed the 32-check integrated Clerk/Convex flow, the 8-check recovery flow, 70 provider-focused tests, 1,059 full tests, typecheck and the 19-route build. The previous `Deletion pending` timeout is preserved as historical failure evidence. Installed-app and real-device acceptance, provider retention/deletion, production configuration, Mixpanel reconciliation and release approval remain open.

### Current guest provider-outage browser rerun: 3 October 2026, 01:59 BST

The current candidate passed 5 outage-context browser checks. The guest comparison remained usable while eight Clerk/provider requests were blocked, and private `/loan` and `/account` routes stayed locked. Evidence: `evidence/guest-provider-outage-browser.json`. Deliberate interception produces expected `ERR_FAILED` resource messages; no harness or request failures occurred. Member persistence, production provider behavior and release approval remain open.

### Current candidate evidence boundary: 3 October 2026

The release manifest now binds current candidate claims to `ydMzVTyEiY_q6uNn7FXx1` and keeps older landing, guest, source-map and Supabase records as historical development evidence. Fresh landing, guest comparison, account-export, source-map and legacy-adoption checks are bound to the current candidate. The current local capture and redacted rehearsal metadata are recorded in `docs/evidence/demo-edits/demo-capture-current-ydMz-redaction.json`. No external provider, production, publication or submission action occurred; the master goal remains incomplete while its open gates remain unverified.

### Current history and report browser rerun: 3 October 2026, 01:55 BST

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed all 24 checks in the history harness with report checks enabled. Coverage includes desktop PDF generation/download parity, 390px warm-offline PDF parity and containment, same-account two-tab deletion propagation, cold-offline privacy locking, reconnect deletion, foreign-account isolation and disposable cleanup. Evidence: `evidence/comparison-history-browser.json`. Installed-app and real-device acceptance, provider retention/deletion, live Mixpanel reconciliation and production approval remain open.

### Current hosted-development performance sample: 3 October 2026, 01:43 BST

The current candidate's read-only hosted-development probe captured 36 route/viewport samples against `https://truecost-ebon.vercel.app/` with no harness errors. Response end, DOMContentLoaded, load, LCP, CLS and TBT medians were 336 ms, 373 ms, 523 ms, 964 ms, 0 and 0 ms respectively, within the probe's diagnostic lab thresholds. Evidence: `evidence/hosted-performance-sample-2026-10-02.json`. This is partial development evidence only; it does not close authenticated/provider, Mixpanel, real-device, controlled-network, field-performance or production-release gates.


### TASK-015 current-candidate preference checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 14 development preference and identity checks on 3 October: unknown/declined defaults, stable affirmative consent, distinct account UUIDs, forged-argument rejection, stale-revision fencing, withdrawal suppression and disposable Clerk cleanup. Evidence: `evidence/analytics-preference-dev-20261003T010425Z.json`. Two synthetic Convex preference rows remain because no reviewed public deletion operation exists. Mixpanel ingestion, dashboard reconciliation, provider retention/deletion, account-switch acceptance and production release approval remain open. TASK-015 and the master goal stay incomplete.

### TASK-015 current-candidate analytics preflight: 4 October 2026

The source-equivalent local build `llH6YCL2zRu1VEYvtRTd7` keeps `NEXT_PUBLIC_ANALYTICS_ENABLED=false` by design. The intercepted hard-navigation harness therefore had no consent control to exercise and stopped before provider or Mixpanel requests; enabled-build readiness probes remain diagnostic only. Evidence: `evidence/hard-navigation-current-candidate-preflight-2026-10-04.json`. No consent, queue, calculation or navigation behavior changed, and TASK-015 remains partial.

### Current-candidate loan integration checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 56 disposable Chrome checks with the loan integration slice enabled: email OTP and invalid-code handling, account binding, loan and quote save/reload, offline quote recovery, cold-offline privacy, responsive account/loan status, keyboard sign-out, UI deletion and cleanup. Evidence: `evidence/clerk-browser-loan-20261003T011547Z.json`. Production email delivery, installed-app and real-device acceptance, provider cleanup, retention/deletion and release approval remain open. TASK-005 through TASK-012 retain their broader open conditions.

### Current source-equivalent loan browser checkpoint: 4 October 2026

The current source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed 56 disposable Chrome checks with the loan integration slice enabled, covering OTP, account binding, loan and transfer-quote save/reload, warm and cold offline recovery, responsive account and loan status, keyboard sign-out access, UI deletion and owned cleanup. Evidence: `evidence/clerk-browser-loan-current-2026-10-04.json`. Production email delivery, installed-app/device acceptance, provider retention/deletion and release approval remain open.

### TASK-016 local abuse-limit boundary checkpoint: 4 October 2026

The focused local suite passed 39 tests across comparison, feedback, export, monitoring and response-header contracts. It proves local server-enforced limits and payload scrubbing, while operator alert receipt, hosted header delivery, provider quotas and release switches remain open. Evidence: `evidence/security-abuse-limits-local-2026-10-04.json`.

### Current candidate static secret-boundary checkpoint: 3 October 2026

The current candidate `ydMzVTyEiY_q6uNn7FXx1` passed a source boundary scan with no disallowed secret, private, deploy or key environment references in client-scoped code. Six secret references remained in server-only paths. Evidence: `evidence/secret-boundary-static-2026-10-03.json`. Bundler output, deployment secrets, provider configuration, runtime headers and security owner review remain open.

### TASK-015 current local contract checkpoint: 3 October 2026

The current checkout passed 53 focused tests across five analytics files for Mixpanel adapter serialization, event allowlisting, configuration gating, provider consent lifecycle and integration behavior. Evidence: `evidence/mixpanel-contract-local-2026-10-03.json`. This strengthens local contract evidence only; live provider ingestion, dashboard reconciliation, retention/deletion and account-switch acceptance remain open.

The same five-file analytics contract command was rerun on 4 October and passed 53 tests. Evidence: `evidence/mixpanel-contract-local-rerun-2026-10-04.json`. The rerun confirms local fail-closed consent and auth-readiness behavior without changing product source or contacting a provider; live ingestion, dashboard reconciliation, retention/deletion and production approval remain open.

The member three-offer comparison path now has a focused keyboard-scroll regression covering its 30rem track and ArrowRight/Home/End movement. Evidence: `evidence/offer-grid-three-offer-local-2026-10-04.json`. The focused suite passed 21/21 and the full suite passed 1,061/1,061; broader assistive-technology, device and release acceptance remain open.

The service-worker harness was rerun against the current generated shell and passed five open-tab upgrade/rollback checks, including generated asset completeness, unrelated-cache preservation and reload usability. Evidence: `evidence/service-worker-upgrade-browser-rerun-2026-10-04.json`. Installed-app and device acceptance remain open.

### TASK-016 bundle boundary checkpoint: 3 October 2026

The current `.next` output matched zero non-public secret values from `.env.local` in browser or server bundles. Dependency-name references were recorded separately. Evidence: `evidence/secret-boundary-build-2026-10-03.json`. Deployment configuration, runtime headers, operator alerts and security-owner review remain open.

### TASK-016 current-build secret-boundary rerun: 4 October 2026

The source-equivalent local build `llH6YCL2zRu1VEYvtRTd7` was rescanned against the checked non-public environment values. Browser and server bundle value hits remained zero. Evidence: `evidence/secret-boundary-build-rerun-2026-10-04.json`. Deployment settings, runtime headers, provider state and security-owner review remain open, so TASK-016 remains partial.

### TASK-016 local response-header boundary: 4 October 2026

Added conservative response headers to the local Next configuration and verified them on four built-server routes. Focused tests passed 2/2, typecheck and the 19-route build passed, and route-specific offline cache directives remained intact. Evidence: `evidence/security-headers-local-rerun-2026-10-04.json`. Hosted header delivery, CSP/HSTS/frame policy review, operator alerting and security-owner approval remain open, so TASK-016 and the master goal remain partial and NO-GO.

### Source-equivalent offline and multi-tab rerun: 4 October 2026

The current source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed all 24 history/browser checks in Chrome 154, covering warm/cold offline privacy, same-account second-tab deletion propagation, reconnect deletion, report parity, foreign read/delete rejection and responsive keyboard controls. Evidence: `evidence/comparison-history-browser.json`. This does not close interrupted-save, installed-app/device, provider retention/deletion or release approval gates.

### Hosted development OTP revalidation: 4 October 2026, 01:24 BST

The approved development endpoint `https://truecost-ebon.vercel.app/` at deployment `dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7` passed 12 current Chrome 154 checks with authorized disposable development-data mutation for Clerk SDK readiness, invalid and accepted synthetic OTP handling, account provisioning, explicit sign-out and disposable cleanup. Evidence: `evidence/clerk-browser-hosted-current-2026-10-04.json`. The harness created and deleted a disposable Clerk identity and provisioned development account data; no hosted settings changed. This does not establish source-candidate parity, comparison save/history/PDF behavior, production inbox delivery, provider reconciliation or release approval; TASK-005 and the master goal remain partial and NO-GO.

### Evidence-register audit after hosted revalidation: 4 October 2026

The 34-task register resolves all 130 listed evidence references with zero missing paths. Evidence: `evidence/task-register-file-audit-2026-10-04-final5.json`. This is a local path audit only; provider, production, human-review and submission gates remain open.

### Current provider lifecycle local rerun: 4 October 2026, 01:32 BST

The current checkout and build `1iwP4oc_H3NlGLD2I7W_j` passed 70 tests across four provider and account-lifecycle files. Evidence: `evidence/provider-lifecycle-local-current-2026-10-04.json`. This covers mounted analytics account-switch fencing and disposal, durable provider deletion claim/retry/lease/poll transitions, and signed-out cleanup retry safety. Live Mixpanel ingestion, dashboard reconciliation, provider-side retention/deletion and production approval remain open.

The evidence register now resolves 131 references with zero missing paths in `evidence/task-register-file-audit-2026-10-04-final6.json`. This path audit does not close the NO-GO gates.

## Account export checkpoint: 4 October 2026

A fresh local browser run passed 14 account-export checks against build '1iwP4oc_H3NlGLD2I7W_j', covering fresh OTP, scoped export, signed-out rejection, account isolation and owned cleanup. The dated evidence is [account-export-browser-current-2026-10-04.json](evidence/account-export-browser-current-2026-10-04.json). This is development evidence only. Provider-side deletion, retention, profile and receipt cleanup, and production approval remain open.

### TASK-019 current full-suite checkpoint: 4 October 2026, 01:57 BST

The current source-equivalent checkout at revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2` and build 1iwP4oc_H3NlGLD2I7W_j passed `npm test -- --maxWorkers=2`: 112 files and 1,063 tests in 61.48 seconds. The evidence records the expected JSDOM unsupported-navigation diagnostics without test failures. This strengthens local verification only. Production configuration, recovery entitlement, restore timing, installed-app/device acceptance, hosted provider ingestion, human review and signed release approval remain open; TASK-019 and the master goal stay partial and NO-GO. Evidence: [current full-suite rerun](evidence/current-full-suite-rerun-2026-10-04.json).

### TASK-029 current-build assembly checkpoint: 4 October 2026, 02:23 BST

The current source-equivalent redacted capture was assembled into fresh 16:9 and 9:16 candidates with 180.683-second narration and burned captions. Both outputs decode successfully at 180.68 seconds, and the edit keeps the authentication interval out of view. Evidence: `evidence/demo-edits/truecost-current-1iwP4oc_H3NlGLD2I7W_j-assembly.json`. This is a local review candidate; full playback/listening, caption review, reviewer access and final acceptance remain open. TASK-029 stays partial and the release remains NO-GO.

### TASK-019 current manifest path audit checkpoint: 4 October 2026, 02:36 BST

The parsed release manifest now resolves 62 unique repository `docs/` paths with zero missing entries. The task register records this audit and now resolves 147 evidence references with zero missing paths. Evidence: `evidence/release-manifest-path-audit-2026-10-04-current.json` and `evidence/task-register-file-audit-2026-10-04-final16.json`. This is a local consistency check; production configuration, provider reconciliation and signed release approval remain open.

The current 16:9 and 9:16 demo outputs also passed automated FFmpeg null-decode and black-frame checks, with zero black segments of at least 250 ms. Silence markers are narration pauses and do not replace human listening or caption review. Evidence: `evidence/demo-assembly-machine-check-2026-10-04.json`.

### TASK-005 hosted comparison revalidation: 4 October 2026, 02:58 BST

The approved development alias `https://truecost-ebon.vercel.app/` at deployment `dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7` passed 15 Chrome 154 checks. The flow covered guest calculation, bounded save handoff, email OTP, Convex save/list/get, history UI, stored-value PDF parity and confirmed sign-out. Run-owned comparison rows and sessions were cleared and the disposable Clerk identity was deleted; the run-created Convex profile may remain because the harness has no profile deletion or tombstone operation. Evidence: `evidence/clerk-browser-hosted-comparison-current-2026-10-04.json`. This strengthens hosted development evidence; source-candidate parity, production email/provider reconciliation and release approval remain open.

### TASK-016 hosted development header observation: 4 October 2026

A read-only response from `https://truecost-ebon.vercel.app/` returned HTTP 200 and HSTS, but did not expose the local `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` headers. The deployment is not proven source-equivalent to the current checkout, so this is recorded as a hosted configuration gap rather than a local regression. Evidence: `evidence/hosted-security-headers-current-2026-10-04.json`. Production header delivery, CSP/frame policy review, operator alert receipt, provider quotas and release switches remain open.

### Current landing rerun: 4 October 2026, 03:48 BST

The source-equivalent local build `1iwP4oc_H3NlGLD2I7W_j` passed 13 read-only landing checks across desktop light, theme persistence, keyboard destinations, 320px reduced motion and 390px dark responsive contexts. No browser, console or request failures were recorded. Evidence: `evidence/landing-browser-current-rerun-2026-10-04.json`. This strengthens local responsive evidence only; full security, accessibility, authenticated, installed-app, real-device and production acceptance remain open. The release manifest now resolves 70 paths and the task register 157 references with zero missing paths. Release remains NO-GO.

### Current results-table rerun: 4 October 2026, 03:56 BST

The source-equivalent local build `1iwP4oc_H3NlGLD2I7W_j` passed seven guest results checks at 1280px and 320px for semantic headers, complete numeric values, keyboard scrolling, page containment and zero provider writes. Evidence: `evidence/results-table-browser-current-rerun-2026-10-04.json`. This strengthens local guest accessibility evidence only; authenticated, installed-app, real-device, provider and production acceptance remain open. The release manifest now resolves 71 paths and the task register 158 references with zero missing paths. Release remains NO-GO.

### Normal source-equivalent build and Mixpanel contract reruns: 4 October 2026, 04:02 BST

The normal analytics-disabled local build `R-YV2Ykfq677oTDdfRFCj` passed 13 landing and seven guest results checks. An explicitly enabled development build `-L66mtneUM2GHq_Pbd9zp` passed six intercepted Mixpanel consent and payload checks; declined and withdrawn consent emitted no events, while accepted consent emitted the two expected comparison events. Evidence: `evidence/landing-browser-normal-rerun-2026-10-04.json`, `evidence/results-table-browser-normal-rerun-2026-10-04.json` and `evidence/analytics-mixpanel-browser-2026-10-04T03-00-26-605Z.json`. This does not close live ingestion, dashboard, provider retention/deletion or production gates. The release manifest resolves 74 paths and the task register 164 references with zero missing paths. Release remains NO-GO.

### TASK-029 current normal-build capture and assembly: 4 October 2026, 04:23 BST

The normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 17/17 disposable Chrome MVP checks. The fresh raw capture was redacted over the authentication interval and assembled into 16:9 and 9:16 local candidates at 180.68 seconds with the accepted narration and burned captions. FFmpeg null decode and black-frame checks passed for both outputs; sampled contact sheets were inspected. Full human playback/listening, reviewer access, Chronicle export retrieval and final acceptance remain open, so TASK-029 and the release remain NO-GO. Evidence: `evidence/clerk-browser-mvp-demo.json`, `evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-assembly.json` and `evidence/demo-assembly-machine-check-R-YV2Ykfq677oTDdfRFCj.json`.

The refreshed release register binds 76 manifest paths and 175 task evidence references with zero missing files. Human media review, authenticated Chronicle export, Runway access and production approval remain open.

The post-assembly reconciliation at 03:23:15.166Z binds `task-register-file-audit-2026-10-04-final29.json` and records authorized disposable development/provider-data mutations only. Provider settings, hosted settings, production, deployment, commit, push and submission remain false; both audits still report zero missing entries.

### TASK-018 current normal-build history and offline rerun: 4 October 2026, 04:37 BST

The normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 24 history/offline browser checks covering stored-report parity, second-tab deletion mirroring, warm/cold offline privacy locks, reconnect deletion, foreign-account isolation and 320px/390px history controls. Run-owned comparisons and disposable Clerk identities were cleared. Evidence: `evidence/comparison-history-browser.json`. The manifest now binds the current build, with 175 task references and 76 manifest paths resolving without missing entries. Interrupted-save, provider-side retention/deletion, installed-app/real-device, production and release approval remain open.

## Mixpanel dashboard access recheck: 4 October 2026, 04:52 BST

A read-only Chrome probe of the approved TrueCost Development project URL redirected to Mixpanel's `Request Access` page and reported that permission or login is required. No request form was submitted and no project or provider setting changed. Evidence: [current Mixpanel dashboard access](evidence/mixpanel-dashboard-access-current-2026-10-04.json). TASK-015 remains partial until a permitted project member session can verify live ingestion and dashboard reconciliation. The refreshed audits resolve 176 task references and 77 manifest paths with zero missing entries; release remains NO-GO.

### TASK-034 Runway guest access probe: 4 October 2026, 03:58 UTC

A read-only Codex in-app browser probe reached Runway's guest tool navigation. It did not generate media, consume credits, mutate an account, confirm rights or submit anything. Evidence: `evidence/runway-access-current-2026-10-04.json`. TASK-034 moves from pending to partial for this bounded access observation; account, credits, rights and approved export gates remain open.

### TASK-015 fresh hard-navigation timing diagnostic: 4 October 2026, 04:13 BST

An explicitly enabled development build `M5BZqNi5kuPRtReRpBP0Q` was exercised with zero and 2,000 ms settle. The zero-settle run dropped both account-B events. The 2,000 ms run delivered `comparison_completed` but dropped `comparison_started` despite a preference completion 35 ms before calculation. Evidence: `evidence/hard-navigation-diagnostic-current-2026-10-04.json` and its two raw records. This is consistent with a timing-sensitive readiness race, but the raw runs do not record each tracker's attempted-or-skipped decision, so root cause remains open. It does not close hard-navigation acceptance, live ingestion, dashboard reconciliation or provider retention/deletion. Authorized disposable development and provider-data mutations occurred while provider settings remained unchanged. No buffering, calculation delay or navigation workaround was introduced; TASK-015 remains partial.

### TASK-015 hard-navigation caller-decision checkpoint: 4 October 2026, 04:35 BST

The diagnostics-only build `I6LLUZppRvjau-wvpU4Xm` added development-only User Timing marks at the analytics caller boundary. The zero-settle run recorded input and completion skipped while the store was loading, with provider acceptance committed after calculation and zero A events. The matched 2,000 ms run recorded accepted context before input/calculation, queued both A and B event pairs and passed all 13 checks. Evidence: `evidence/hard-navigation-diagnostic-track-decision-current-2026-10-04.json` and the two raw member analytics records named there. This supports an event-level readiness race as the current explanation, without proving a product remedy. No event buffering, calculation delay or navigation workaround was introduced; Mixpanel stayed intercepted and provider settings stayed unchanged. Hard-navigation acceptance, live ingestion, dashboard reconciliation, provider retention/deletion and production configuration remain open. TASK-015 remains partial.

### Current checkout build after diagnostics instrumentation: 4 October 2026, 04:40 BST

The normal analytics-disabled environment was restored after the diagnostic run. `npm run build` passed with 19 generated routes and produced `bm38SzfSfXwstgpYCARC4`; evidence: `evidence/current-build-rerun-2026-10-04-latest.json`. No provider setting, deployment, commit, push or external submission occurred. Provider, production, human-review and signed release gates remain open.
