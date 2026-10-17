# TrueCost execution decisions

Recorded 15 September 2026. Source: the user's direct instructions and answers in the active Codex task. Product decisions are accepted where stated; release approval is separate. The [PRD](prd.md) holds requirements and the [roadmap](product-roadmap.md) holds delivery status.

## DEC-001: execute the production-first master goal

Status: accepted. Decision owner: Rajesh Shinde, as the requesting user. Rajesh and Ritesh are the named joint owners for release approval, privacy, support and financial-methodology review; see DEC-006. Assignment is not completed sign-off.

The user asked to start goal mode and execute the saved master goal. Local implementation, dependencies, tests, reviewed installation of the four selected custom skills, and fresh Clerk/Convex development setup now proceed under that scope. Production publishing, commits, pushes, paid commitments and other external actions still require their applicable authorization.

Alternatives were to continue planning only or prioritize the Demo Day recording. The selected path is a verified production candidate first, followed by the required demo assets. This reduces the risk of presenting a demo login as real account security; the tradeoff is schedule pressure on the tentative Demo Day date. No dissent was supplied. Revisit if the user changes priority or the deadline prevents the agreed submission; never silently remove production gates.

## DEC-002: accept D1 launch behavior

Status: accepted on 15 September 2026 in response to the D1 question. Product owner: requesting user.

- One successful guest comparison per browser profile; clearing storage can bypass this soft gate.
- Sign-in for another comparison or a changed-input recalculation; the first full result remains readable.
- Members may compare up to three offers.
- PDF reports, optional contextual feedback and explicit import of device-saved loans.
- Private data locks after an offline reload until the same account is verified online.
- Discard queued private changes only after the user confirms sign-out; allow staying to finish syncing.

Alternatives include unlimited anonymous recalculation, two offers for everyone, and unrestricted offline private access. The selected policy follows the user's accepted value-before-sign-in flow and shared-device boundary. It adds auth-return and offline-state work. The precise storage technology is an engineering choice; the acceptance tests must prove the behavior. Revisit if usability tests show users cannot understand the gate, lose an edited draft, or confuse queued data with an acknowledged save. No such outcome evidence exists yet.

D2 remains accepted: Clerk email OTP only, with phone deferred. Fresh Convex replaces unused/test Supabase scaffolding without importing server data; device data must be preserved.

## DEC-003: India pilot and INR budgeting

Status: audience, currency and the ₹0/free-plan constraint for other services accepted. The existing Vercel paid-plan authorization is recorded separately in DEC-010; pilot schedule and production plan suitability remain open.

The user specified registered users in India as the first pilot audience and requested rupees instead of pounds. They subsequently selected “₹0: free plans only” for monthly service planning, then separately authorized use of the existing Vercel paid plan after upgrading it themselves. Keep other services on free plans with no new paid commitment or automatic overage. Verify each required capability against actual plan entitlements; if a requirement cannot fit, present the concrete gap for a scope or budget decision. Do not silently weaken recovery, privacy or release gates to fit the budget.

India is the selected pilot market; this does not establish provider data residency, legal approval, research validation or an approved invite list. An international pilot and a broader public launch remain follow-ons. Revisit jurisdiction and privacy notices before expanding audience, adding vendors or changing data use.

## DEC-004: development ownership and region

Status: accepted and configured. The user chose Google for both provider dashboard logins. Fresh TrueCost development resources were created in their Clerk Personal workspace and Convex team. App users still use email OTP only.

The user initially chose Ireland for Convex development. Its creation screen disclosed on-demand billing with no included limits and a 30% regional surcharge. After this cost was explained, the user selected US East for disposable development data. The monthly service budget is now ₹0. Production region and vendor review remain open. See [development-setup.md](development-setup.md) for exact resource identifiers and verification limits.

## DEC-005: retain and refine TrueCost's visual identity

Status: accepted, 15 September 2026. The user selected retention of the teal identity and comparison-table layout, with improved contrast, spacing, sign-in states and restrained motion. [design.md](design.md) is the token/rationale source and [design.html](design.html) its visual mirror. This authorizes refinement within the existing product, not copying Revolut's branding or replacing the app with a marketing template.

The later `revolut-tokens (1).css` and `revolut-design-system (1).md` files are byte-for-byte identical to the original references. Unchanged project copies and hashes are retained in [design-references](design-references/README.md). The app does not import that reference CSS.

## DEC-006: named pilot owners and free-plan constraint

Status: accepted from the user's direct clarification. Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review. The user confirmed support@trucost.com and Monday–Saturday, 9 AM–6 PM IST on 16 September. Completed reviews and tested incident coverage remain open. This records responsibility, not legal/financial expertise or permission to publish. Other services must remain ₹0 on free plans; a new paid requirement must be escalated with its concrete tradeoff before purchase or release. The existing Vercel paid-plan authorization is recorded in DEC-010.

## DEC-007: production domain unavailable

Status: confirmed by the user, 15 September 2026. Rajesh and Ritesh do not have a suitable owned domain for TrueCost. Clerk's [production prerequisites](https://clerk.com/docs/guides/development/deployment/production) require an owned domain with DNS access, so production activation remains an unresolved launch dependency. Keep the ₹0 budget and Clerk direction; continue authorized local/development work. This answer does not authorize a purchase, a DNS change or a provider switch.

## DEC-008: commercial product and earlier hosting constraint

Status: commercial classification remains confirmed; the hosting conclusion below was superseded by DEC-010 on 16 September 2026. TrueCost is a business/commercial product for the first India pilot. The earlier [Vercel Hobby](https://vercel.com/docs/plans/hobby) assessment found that Hobby restricts use to personal, non-commercial projects, so it was not a valid launch choice at that time. The user has since upgraded the existing `rvs006s-projects` project to a paid plan and required Vercel-only hosting. Record the exact paid tier, entitlements and project access; no migration, add-on or automatic overage is authorized.

## Release scope reviewed with scope-product-release

The coherent release path is: two offers -> full guest result -> email OTP when the user chooses a gated action -> the preserved comparison -> acknowledged save/history or a PDF -> optional feedback. Registered users in India are the pilot audience; this does not change anonymous first-result access.

| Scope class | Included | Evidence required |
| --- | --- | --- |
| Essential outcome | Guest comparison, auth return, saved history, reports and existing loan tools | Accepted PRD scenarios and real development-provider checks |
| Trust and operations | Ownership, shared-device isolation, deletion/export, recovery, accessibility and support | Security/privacy/finance and launch gates |
| Learning | Consented Mixpanel and contextual feedback | Payload tests, synthetic funnel counts and assigned review owner |
| Follow-on breadth | Insurance, paid subscriptions, live quotes, OCR, history search and direct-list report shortcut | Separate requirement and scope decision after the core release |

Manual review of feedback and release evidence is acceptable at pilot scale; a new operations dashboard is deferred. These reductions retain named support/review ownership as a launch requirement. The tradeoff is operator effort, to be revisited if pilot volume exceeds the assigned review capacity. No customer-validation or conversion target is invented.

## Remaining decisions and consequences

| Decision | Known | Still needed | Work affected |
| --- | --- | --- | --- |
| D1 | Accepted product defaults above | Usability and behavior evidence | Implement and test TASK-003/010 through 014 |
| D2 | Clerk email OTP | Real delivery/configuration evidence | TASK-005 |
| D3 | Pilot users in India; Rajesh and Ritesh own privacy review | Notices, regions, retention and vendor review | Real-user pilot and final lifecycle policy |
| D4 | ₹0/free plans for other services; existing `rvs006s-projects` paid Vercel hosting target; Rajesh and Ritesh own release/support; commercial use; no suitable owned domain; development setup authorized; US East selected for Convex development | Exact Vercel tier/access, domain solution, production regions, tested support/incident coverage and verified free-plan recovery entitlement for other services | Production release and remaining service setup |
| D5 | Preserve deterministic engine and show source dates; Rajesh and Ritesh own methodology review | Independent fixtures and freshness approval | Financial claims and release sign-off |
| D6 | Registered Indian users | Cohort size, invite list, dates, observation window and outcome targets | Pilot invitation and outcome verdict |

Engineering can implement accepted behavior and run synthetic development checks now. None of the open decisions permits inventing names, approving vendor terms, spending money or marking a release gate passed.

## DEC-009: retention targets for implementation

Accepted by the user on 16 September 2026: keep saved loans/comparisons until deleted; retain feedback for 12 months, analytics for 90 days and scrubbed error logs for 30 days; target live account cleanup within 7 days. This authorizes implementation against those targets. Provider support and deletion coverage must be verified before launch. It does not approve production publishing, regions, vendor terms, backup retention or other still-proposed lifecycle targets.

## DEC-010: Vercel paid hosting target and development review deployment

Status: accepted and authorized by the user on 16 September 2026. The user upgraded Vercel themselves and directed deployment under the currently signed-in account to the existing `rvs006s-projects` paid plan. This authorizes the requested hosted review deployment using the existing plan. It does not authorize additional purchases, add-ons, automatic overage, unrelated project changes, production Clerk/Convex resources, or a production pilot release.

The review target is the current candidate connected to the new Clerk and Convex development backends, restricted to synthetic data and clearly labelled development. Exact Vercel tier, entitlements, project access, deployment artifact and hosted acceptance still require evidence. The production pilot remains gated by an owned domain with DNS access, production provider settings, methodology/privacy/security/accessibility/recovery/support evidence and signed release gates. Other services remain within the accepted ₹0/free-plan budget.

## DEC-011: pilot support contact and hours

Accepted and explicitly confirmed by the user on 16 September 2026: `support@trucost.com`, Monday–Saturday, 9 AM–6 PM IST (Asia/Kolkata). The user confirmed that this exact address, without the “e” in TrueCost, is controlled by the team and working. Rajesh and Ritesh are the joint support owners. Use these details in local help/privacy content.

Mailbox delivery has not been independently tested by the agent. This confirmation does not establish DNS access or authorize using trucost.com as the Clerk production domain. Incident alert receipt, backup coverage and acknowledgement performance still need verification; do not claim 24-hour support or a guaranteed response time. No support email was sent during this confirmation.

### DEC-011 verification conflict: publication on hold

The user also confirmed DNS control. A subsequent read-only DNS check returned Akamai nameservers and SOA primary `nsuse01.spglobal.com`, administrator `hostmaster.spglobal.com`, for trucost.com. The MX lookup returned SOA only, with no MX record; app.trucost.com and accounts.trucost.com returned NXDOMAIN. An S&P Global publication identifies www.trucost.com as its Trucost domain. This is a material conflict with the supplied address/control claim. Asked for the exact registrar domain or an alternative working support email. Hold the address and production-domain configuration; the Monday–Saturday, 9 AM–6 PM IST hours remain accepted. No DNS or provider changes were made.

The user deferred resolving the domain/support-address conflict ('later'). Keep it open without repeated questions; continue local development. No public use of the disputed address or production DNS setup is authorized by this deferral.

## DEC-012: analytics deletion timing conflict

Status: awaiting user choice, 16 September 2026. The accepted seven-day live cleanup target conflicts with Mixpanel's documented allowance of up to 30 days to delete events and user profiles. Source: https://docs.mixpanel.com/reference/gdpr-api (Create a Deletion Task, checked 16 September).

The proposed resolution keeps immediate access removal and seven-day application-data cleanup, with a separate maximum 30-day analytics-provider deletion window. The alternative keeps the seven-day requirement and leaves production analytics disabled until a compatible provider arrangement is verified. Neither option is accepted yet. Continue local deletion workflow implementation with distinct requested, provider-pending and provider-confirmed states; an accepted API request is not completed deletion. Do not publish a seven-day all-provider promise or enable production analytics while this conflict is unresolved.

## DEC-013: equal cash budget for prepayment fees

Accepted by the user on 16 September 2026: treat prepayment fees as extra cash, with the same extra budget available to investing. The entered surplus is the amount available for the loan payment before charges; each compared option has total initial cash equal to surplus plus the calculated applicable prepayment fee. For example, ₹1,00,000 surplus and ₹15,000 fees means ₹1,15,000 initial cash in each scenario. Prepayment spends ₹1,00,000 toward the loan and ₹15,000 on charges; investing deploys ₹1,15,000. Any surplus above the outstanding balance retains the existing excess-cash treatment.

Implement this consistently in terminal wealth, baseline idle cash, displayed budget assumptions and fee-decisive comparisons. Preserve monthly cash-flow parity. This resolves FIN-BUG-06's budget choice; it does not validate tax assumptions, legal fee eligibility, current lender terms or financial-methodology release approval.

## Production configuration follow-up, 16 September

The user requested live Clerk keys and production database/secrets in Vercel Production, test configuration only in Preview/Dev, public browser source maps disabled, and signed-out checks after deployment. They then answered “ok skip this” when asked for the verified domain required by production Clerk. Production Clerk/domain switching is deferred; no live keys, production database or DNS changes were made. The existing hosted review remains explicitly development-only. Source-map configuration can be hardened locally without interpreting this deferral as approval of production readiness.

## DEC-014: reviewed post-tax prepayment model is required for release

Accepted by the user on 16 September 2026: complete and review the full post-tax model before releasing Prepay or invest. A before-tax-only feature is not an accepted substitute. FIN-REVIEW-07 remains a release blocker until investment tax timing, eligible loan deductions, available deduction headroom and the same-budget cash-flow ledger are implemented consistently and checked against independent fixtures. Rajesh and Ritesh retain financial-methodology approval; passing automated tests does not replace that review. See docs/evidence/prepay-tax-model-review.md for observed defects. Do not present the existing model as a reliable post-tax recommendation.
