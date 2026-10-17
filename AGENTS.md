# TrueCost agent workflow

## Goal and scope

Build the existing TrueCost PWA into a verified production-release candidate, then prepare the Buildathon submission. Production readiness comes first. Work only in this TrueCost checkout; do not modify Money Ops or YOI.

Source: [riteshg87/truecost](https://github.com/riteshg87/truecost). Reference deployment: [truecost-lac.vercel.app](https://truecost-lac.vercel.app/).

This workflow adapts the isolation, implementation, evidence and release structure in [Michael Shimeles' AGENTS.md](https://github.com/michaelshimeles/skills/blob/main/AGENTS.md), reviewed 15 September 2026, to TrueCost's goal and authorization. Follow the user's current instructions over reference templates and skill defaults.

## Read the right documents

| Document | Responsibility |
| --- | --- |
| [Master goal](docs/CODEX-GOAL.md) | Full Product OS, BuilderOS, custom-skill and demo workflow when the user asks to execute it |
| [Planning-only goal](docs/PRODUCT-OS-GOAL.md) | Use only when the user requests a planning-only pass; it does not stop an active master goal |
| [PRD](docs/prd.md) | Requirements, accepted D1/D2 decisions and remaining D3-D6 proposals |
| [Roadmap](docs/product-roadmap.md) | TASK-001 through TASK-034, dependencies and acceptance evidence |
| [Skill sequence](docs/SKILL-SEQUENCE.md) and [inventory](docs/SKILLS.md) | Invocation order, installed paths and source references |
| [Technical design](docs/technical-design.md), [UI spec](docs/ui-spec.md), [analytics plan](docs/analytics-plan.md) | Detailed implementation contracts |
| [Launch checklist](docs/launch-checklist.md) and [demo brief](docs/demo-day.md) | Release gates and submission deliverables |

This file guides execution; opening or editing it does not start the build. For a bounded request, do that work. For an invoked master goal, proceed from planning into authorized implementation without asking the user to approve every phase again.

Read the relevant sections once and reuse that context. Reconcile stale README claims and historical test/deployment counts with current source and observed behavior. Preserve adequate existing documents. Resolve a material product contradiction with the user before dependent implementation; continue independent work.

## Product contract

- A guest can compare two loans and see the complete first result. Require sign-in to save, start another comparison or download a report. Preserve the result and intended action through sign-in.
- Use Clerk email OTP only. Phone/SMS authentication is deferred.
- Use fresh Convex development resources. Supabase is unused/test, with no server-data migration planned. Preserve device-saved loans through explicit, account-safe adoption.
- Deliver private comparison history, reports, optional member feedback after comparison/Loan health, account export/deletion, recovery and accessible PWA behavior.
- Mixpanel is required P0 work under TASK-015. Implement and verify consent, events, identity handling and dashboards.
- Preserve the deterministic finance engine, Loan health, transfer and prepayment behavior. Retain loan-linked insurance-premium calculations; the separate insurance flow, payments, live quotes and OCR are deferred.
- D1 launch defaults are accepted, including the browser guest allowance, changed-input recalculation gate, up to three member offers, PDF, optional feedback, explicit data import and private offline/sign-out policy. Pilot audience: registered users in India. Other services must remain on free plans with no new paid commitments. The user upgraded Vercel and authorized its existing paid plan and the backend-connected development review publication; see DEC-010. Rajesh and Ritesh jointly own release approval, privacy, support and financial-methodology review. Retention targets are accepted for implementation; provider feasibility, production regions, support coverage/contact, actual reviews and pilot targets remain open. Follow docs/product-decisions.md.
- Production access requires verified identity. Demo OTPs and browser flags cannot grant membership.

## Start and authorization

1. State the requested outcome and selected task/slice. Inspect branch, working-tree status, relevant diff and files; CLAUDE.md includes this file.
2. Before implementation, inspect the latest remote state and any accessible overlapping PRs. Preserve untracked docs and teammates' changes. Do not reset, discard, stash or replace work automatically.
3. Reading this file authorizes no external action. Executing the master goal authorizes its local implementation, necessary dependencies, verification, reviewed custom-skill installation and fresh development Clerk/Convex setup with disposable test data.
4. Commits, pushes, PR publication, production deployment, production DNS/secrets, Supabase changes, purchases, evidence uploads and external submissions require the applicable explicit authorization. Prepare the concrete result first and reuse authorization already given.
5. Obtain missing authorization for Mixpanel/Sentry project creation or account changes. Ask for provider login/account selection only when required; keep secrets in local/provider settings.
6. Ask at most three unresolved questions at a time. Recommend a choice, record answers, and continue independent work while waiting. Never treat silence as approval.

## Models and ownership

- Astra: gpt-6-astra, xhigh. Own product decisions, architecture, decomposition, integration review and acceptance.
- Luna: gpt-5.6-luna, high. Execute bounded implementation, tests and evidence collection.
- Verify available models; this file cannot switch the main model. Report a limitation and obtain a fallback choice if the requested execution model is unavailable.
- Use at most two Luna workers concurrently, only for useful independent work. Each handoff names task ID, owned files, decisions, dependencies, checks and stop conditions.
- Workers are not alone in the codebase. Preserve others' edits and coordinate overlapping files. Use in-task subagents; create separate user-visible tasks only if requested.
- Handle small documentation/instruction edits directly.

## Workflow

### 1. Plan with Product OS

Run this pass once at the start of the master goal, updating existing artifacts. Revisit only stages affected by new evidence or decisions.

1. $write-product-decision: reconcile accepted choices and unresolved PRD decisions.
2. $scope-product-release: retain production requirements and explicit deferrals.
3. $write-product-requirements: make behavior and failure recovery testable.
4. $review-product-plan: resolve contradictions and record remaining blockers.
5. $define-product-metrics: define denominators, time windows and consent coverage.
6. $plan-product-instrumentation: specify event triggers, allowed data and verification.
7. $plan-outcome-roadmap: select the next task whose dependencies are satisfied.
8. $verify-product-outcomes: map implementation evidence and gaps; leave unobserved user outcomes unknown.
9. $plan-product-launch: prepare owners, support, rollout, recovery and publication gates.

Write the planning handoff specified in the master goal. Continue into implementation when the next slice's decisions are resolved. Do not run every installed Product OS skill or restart idea discovery for this existing product.

### 2. Isolate with new-feature

Use $new-feature when a new implementation slice needs isolation. Reuse an assigned Codex worktree; otherwise use a codex/ branch and a separate worktree when concurrent work needs it. Keep implementation off main. A documentation-only task may use its assigned checkout.

Choose the starting revision deliberately. Carry authorized uncommitted planning context into a new worktree; do not assume origin/main contains it. Never modify another agent's branch/worktree. Check ownership of development ports and databases because worktrees do not isolate those resources. Resolve lockfile conflicts through the package manager; report conflicts that cannot be resolved safely.

### 3. Build with BuilderOS and targeted helpers

- Use $design-system before UI implementation. Inspect the live app and supplied Revolut references; maintain matching docs/design.md and docs/design.html.
- Repeat $build-loop-codex for each selected implementation slice. Define acceptance checks before Luna starts; Astra reviews the actual diff before accepting it.
- Use $code-structure for genuinely repeated operations and clear boundaries. Keep pure calculations separate from UI and provider operations. Do not force a generic service layer into every function or interpret its term "action" as a required Convex action.
- Use convex:convex-expert for backend work and convex:convex-reviewer for relevant authorization, validation, transaction, index and lifecycle changes.
- Use $design-better for working UI changes. Fix findings within the assigned scope before taking another task.
- Production TASK-001 through TASK-020 precede pilot/wider release TASK-021/022. Follow actual dependencies rather than task numbers alone.

### 4. Prove with evidence-driven-testing

Use $evidence-driven-testing, or an explicitly documented equivalent. For a bug, reproduce and record its existing behavior before editing. Capture the changed behavior with synthetic data and meaningful assertions.

Use $before-and-after for material UI changes. Match viewport, input data and state. For nonvisual work, record expected/observed outputs or measurements. Store evidence locally; inspect uploader behavior before using options such as --markdown. Keep browser security enabled and use supported capture tools.

Run relevant tests and exercise the real changed flow. Auth, persistence, deletion and analytics need development-provider checks as well as isolated tests. Review actual diffs for correctness, security and regressions; fix findings and recheck affected behavior.

Record revision, dirty-worktree context, environment, expected result, observed result and pass/fail/untested status. Screenshots do not establish server authorization or financial correctness.

### 5. Prepare release, then publish when authorized

Run $verify-product-outcomes, $plan-product-launch and $launch-checklist against the integrated candidate. Prepare the exact release targets, operational owners, rollback, restoration and deletion replay before requesting publication approval.

Prepare a PR description with the problem, resulting behavior, checks, evidence and remaining risks. Execute commit/push/PR steps only under the user's applicable authorization. Recheck affected behavior after integration changes.

Greptile is optional. Use $greploop or $greploop-apps only when installed, configured and authorized. A review score cannot replace TrueCost's acceptance evidence, and there is no compulsory 5/5 gate. Do not force-push, merge or clean up another branch/worktree without explicit authorization.

## Skill setup and usage records

The master goal selects new-feature, code-structure, evidence-driven-testing and before-and-after. During that goal, verify their installation and use the skill-installer workflow for missing skills: inspect source, scripts, dependencies and license at an identified revision; prefer project-scoped installation; preserve existing versions and record the source revision in docs/SKILLS.md.

This documentation edit does not install them. Read a skill's actual SKILL.md when applying it. Names in a plan or files on disk do not establish that a workflow ran or a tool is available. Keep greploop/greploop-apps conditional and unslop optional alongside the user's writing rules.

During execution, maintain docs/execution-log.md with task ID, actual skill applied, agent/model, owned files, decision, checks, evidence and next dependency. Separate installed, inspected, planned and applied skills so a later usage audit can count real applications. Read only the skills relevant to the current task.

## Engineering and verification

Follow the inspected source layout and installed Next.js guidance. Recheck scripts in package.json before running commands:

| Command | Purpose |
| --- | --- |
| npm run dev | Local development |
| npm run typecheck | Next type generation and TypeScript checks |
| npm test | Vitest suite |
| npm run build | Production build |
| npm start | Serve the completed build |

Use npm ci for an authorized clean lockfile installation; it replaces node_modules. Do not upgrade dependencies without a task-related reason. No lint/E2E script is currently declared; verify availability before naming a command.

Add meaningful tests for changes to calculations, authorization, persistence and recovery. Run typecheck, tests and build for an integrated candidate. Repeat broader checks only after changes, failures or unresolved concerns justify them. Documentation-only changes need diff, link and consistency checks.

Release evidence must cover:

- Independent finance fixtures, engine versions, source dates and report/snapshot parity. Keep comparison snapshots distinct from saved loans.
- Server-derived ownership from verified identity. Test two accounts, direct record IDs, invalid/expired tokens and missing configuration.
- Account-bound queued writes, late callbacks, account switches, sign-out and deletion. Show save success only after server acknowledgement.
- Guest offline calculation, locked private reloads, public-only service-worker caches, deletion retries and restored-backup deletion replay.
- Privacy-safe errors, monitoring alerts, cost controls, support and recovery checks. Never log OTPs, credentials or private finance data.
- Keyboard/focus access, contrast, mobile layout, aligned comparison rows, and loading, empty, error and offline states. Keep content visible if motion fails and support reduced motion.

## Mixpanel: TASK-015

Follow docs/analytics-plan.md. Verify the configured environment/region, consent controls, typed event allowlist, retries/deduplication, identity transitions and dashboard counts with synthetic events.

Exclude financial values, contact details, OTPs, raw URLs, input hashes and feedback text, including SDK-added properties. Keep autocapture, automatic pageviews, geolocation enrichment and session recording off under the current plan. Reset identity and clear queued events on sign-out, account change, withdrawal or deletion.

The app must work without analytics. Record observed payloads and funnel/retention counts with consent coverage and mature cohort windows. An event list or an empty dashboard does not complete TASK-015.

## Chronicle, Runway and Demo Day

Follow docs/demo-day.md and TASK-023 through TASK-034 after production work, or advance independent local preparation while production awaits an external decision.

- TASK-033, Chronicle: reviewed problem-selection copy, exactly one readable PDF page, and an optional deck. Verify access, preserve existing documents and inspect the actual export.
- TASK-034, Runway: approved short illustrative clips and transitions. Verify available tools, credits, rights and permitted spending; do not silently substitute another generator.
- TASK-029: assemble and watch the complete 180-240 second pitch plus a recording of the real verified product, with readable screens, narration and captions.
- TASK-027: verify the actual deployed link and reviewer access. Submission and event feedback remain separate tasks.

Generated media cannot demonstrate working authentication, saving, comparisons or analytics. A script or asset brief does not complete an exported deliverable. Confirm the current deadline before scheduling; leave later attendance, pilot outcomes and submission unchecked until performed.

## Finish each slice

Keep scope narrow, review the final diff, fix findings and update the roadmap only when acceptance evidence exists. Continue the next authorized slice; show a concrete blocker when user action is needed.

Report what changed, why, checks performed, evidence links, remaining decisions and the next task. Distinguish implemented, development-verified, release-ready and deployed. Never claim production readiness from a plan, historical CI result or demo login.

Write plainly; apply the user's Humanizer rules to changed prose. Use quick-recap for a final status line under 100 characters. If that skill is unavailable, give an equivalent concise status.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
