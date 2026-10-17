# TrueCost workflow and command guide

Updated: 15 September 2026

This guide takes the existing TrueCost PWA through production preparation. The user selected production readiness first, Clerk email OTP only, and Astra xhigh coordinating Luna execution. The [goal prompt](CODEX-GOAL.md) carries authorization for local implementation and fresh development Clerk/Convex setup when submitted. This documentation update does not start that execution. Production publishing and paid commitments still require separate approval.

## Start here

For the complete run, use the [master execution goal](CODEX-GOAL.md): Product OS planning, BuilderOS implementation, selected custom skills, Mixpanel verification and Chronicle/Runway Demo Day production. It includes skill availability checks and local installation of the four selected custom skills when the goal is submitted, while retaining the external-action and publishing boundaries.

For a sequential Product OS planning pass before implementation, use the [Product OS planning goal](PRODUCT-OS-GOAL.md). It refines the existing documents and produces a BuilderOS handoff.

Read [PRD v1.1](prd.md), then the [roadmap](product-roadmap.md): 22 production tasks plus 12 Demo Day/support tasks. Mixpanel implementation is P0 TASK-015. Chronicle presentation assets and Runway video assets have separate TASK-033/034 entries. Use the [ordered skills guide](SKILL-SEQUENCE.md) and [copyable goal prompt](CODEX-GOAL.md) to execute the plan. Supporting detail is in the [technical design](technical-design.md), [UI behavior specification](ui-spec.md), [analytics and metrics plan](analytics-plan.md), and [production launch checklist](launch-checklist.md). Documents do not complete implementation or release gates.

**Production first:** TASK-001 through TASK-022 take precedence. The [Demo Day brief](demo-day.md) retains the one-pager, deployed link and 3-4 minute video, due before Wednesday 8 PM IST; playback is at 10 PM IST. The tentative date is 16 September 2026, awaiting confirmation. Flag deadline conflicts without silently cutting production work. TASK-023 through TASK-034 remain tracked, with the Chronicle/Runway support tasks completed before final asset review and submission.

The next slice is **Phase 1: latest local baseline, contracts and release decisions**. The recommended route is the goal prompt, which continues authorized local/dev phases after Astra's reviews. Step 7 remains an optional narrower phase-only route; do not combine its stop-at-phase restriction with the whole-goal prompt unless that is intended.

## Where to work

Use this folder for every TrueCost task:

```text
C:\Users\RajeshShinde\OneDrive - Electracom Projects (UK) Ltd\Documents\ChatGPT\truecost
```

Open or select that project in Codex before pasting a prompt. The current conversation started in another project; a PowerShell folder change affects that terminal, not the saved Codex project. Keep Money Ops outside this work.

Select `gpt-6-astra` with `xhigh` reasoning for the main task. Its execution agents must use `gpt-5.6-luna`; `high` reasoning is the proposed worker default. Astra owns planning, delegation and final review. Prompt text cannot by itself change the current task's model or saved folder; select the TrueCost project and model before starting.

## Skills installed

- Product OS: 45 skills from `buildbetter-app/product-os`, installed into `C:\Users\RajeshShinde\.codex\skills` on 15 September 2026. Source revision: `d0ad2dfb6700c75aa960c950f3e698fb0feca32a`.
- BuilderOS: all 10 skills were already installed in that same directory. Their existing files were preserved.
- Skill files are installed locally; use `$` and the picker, or attach the exact `SKILL.md` if discovery has not refreshed. Check availability in the task rather than assuming every installed skill is already loaded.

The full list is in [SKILLS.md](SKILLS.md). Product OS handles requirements, scope, research and measurement. BuilderOS handles design, implementation loops and launch preparation. Use the few skills needed for the current decision; the complete inventory is a toolbox, not a sequence of 55 required steps.

## The MVP we are planning

1. A guest completes one comparison of two home-loan offers and sees the full result, with a non-blocking invitation to sign in for saving, downloading or further comparisons.
2. Saving that comparison, starting another comparison, or downloading its report requires sign-in/sign-up.
3. Clerk authentication preserves the comparison and resumes the selected action.
4. Convex stores owned comparison snapshots, feedback and existing saved-loan data where applicable.
5. Members can give optional feedback after a comparison or loan-health suggestion.
6. Mixpanel measures the funnel without receiving financial values or feedback text.

PDF is the proposed report format. Remembering the guest allowance on the device is a proposed soft limit, which can be reset by clearing browser storage. The draft policy gates recalculation with changed loan inputs after the first success; viewing, sorting or expanding the existing result remains available. Members may compare two or three offers under the proposed policy. Account deletion/export, private cache controls, error monitoring, financial validation, accessibility and recovery are also P0 production requirements. Term insurance, payments and live quote integrations are outside this release; existing loan-premium calculations stay supported.

## Prompts to paste into Codex

These are chat prompts, not PowerShell commands. The planning documents in Start here already exist; use Steps 1-6 to review/refine them, not to restart planning or overwrite them with a template. Implementation prompts explicitly state the approved scope. A saved example prompt is not approval until you submit it.

### 1. Start and refine the PRD

```text
$write-product-requirements Read docs/prd.md and the existing TrueCost repository. Refine the draft using our agreed guest comparison, Clerk sign-in/sign-up, Convex saving, report download and member feedback flow. Keep facts, proposals and open decisions distinct. Ask only about unresolved choices that change the MVP. Do not invent research, success targets, budget or a deadline. Update the PRD only; do not implement or deploy.
```

Expected result: a PRD with clear requirements, acceptance scenarios and a short decision list. Resolve the guest-limit policy, member offer count, authentication methods, PDF choice, pilot audience, metrics and ownership before calling it approved.

### 2. Review the PRD

```text
$review-product-plan Review docs/prd.md against the current app and our MVP scope. Focus on preserving the guest result through authentication, enforcing record ownership, repeat comparison rules, accurate save status, report content and optional feedback. Return blockers with requirement IDs and the smallest corrections needed. Do not modify app code or treat a recommendation as my approval.
```

Expected result: a review verdict, documented remaining decisions and corrections to make before building.

### 3. Confirm the release boundary

```text
$scope-product-release Review the release boundary in docs/prd.md and docs/product-roadmap.md. Keep all P0 production requirements, including lifecycle, privacy, monitoring and recovery. Preserve the existing finance engine and loan-health/prepayment functionality. Defer term insurance, subscriptions and live quote integrations. Update those documents only if scope needs clarification; do not create a conflicting second release scope or implement.
```

### 4. Write the metrics and tracking plan

```text
$define-product-metrics Review the Metrics and dashboard section of docs/analytics-plan.md against docs/prd.md. Verify denominators, consent coverage, observation windows and D7 cohort rules. Mark numeric product targets as proposed until I accept them. Update the existing analytics plan; do not connect analytics or claim events are live.
```

Then:

```text
$plan-product-instrumentation Review docs/prd.md and docs/analytics-plan.md for Mixpanel event triggers, allowed properties, anonymous-to-member identity, logout reset, consent, deduplication and test cases. Preserve the existing definitions unless a correction is explained. Exclude financial values, contact details, OTPs, raw URLs and feedback text, including SDK default properties. Keep autocapture and session recording off. Count cloud saves only after Convex acknowledgement and downloads as initiation, not proof the file reached disk. Update planning documents only.
```

### 5. Establish the design specification

```text
$design-system Read docs/ui-spec.md and docs/prd.md, inspect https://truecost-lac.vercel.app/ and read C:\Users\RajeshShinde\Downloads\revolut-design-system.md and C:\Users\RajeshShinde\Downloads\revolut-tokens.css as reference material. Create docs/design.md and its matching docs/design.html for the specified comparison, authentication, history, report, feedback and account lifecycle states. Follow my design instructions, keep content visible without animations, support reduced motion, and identify any missing licensed assets. Do not modify application screens yet.
```

Expected result: one reviewed design specification and a browser-verifiable style guide. The supplied Revolut files are visual references, not permission to replace application behavior or copy proprietary assets.

### 6. Turn the approved scope into build tasks

```text
$plan-outcome-roadmap Review the existing docs/product-roadmap.md against docs/prd.md, docs/technical-design.md, docs/ui-spec.md, docs/analytics-plan.md, docs/launch-checklist.md and docs/demo-day.md. Preserve TASK-001 through TASK-034 and the production phase boundaries unless you explain a necessary change. Keep the Demo Day submission work distinct from production release evidence. Sequence Chronicle TASK-033 and Runway TASK-034 before the deliverables they support. Check dependencies, demoable outcomes and verification, including account lifecycle and recovery. Separate local implementation from cloud setup and publication. Keep the roadmap proposed until I approve it; do not build.
```

For BuilderOS build-loop compatibility, each implementation task should follow this pattern:

```markdown
- [ ] **TASK-001**: Specific behavior to implement
  Files: Existing files or clearly marked proposed files.
  Notes: Relevant PRD requirements, dependencies and the test proving completion.
```

An optional broader business-planning pass is available through `$product-planner`. It captures `docs/VISION.md` and generates strategy, PRD and roadmap documents. Use it if you want that fuller intake; tell it to preserve the draft PRD and ask only unanswered questions. No completed founder vision or validated research has been invented in this task.

### 7. Approve and build one phase

Paste this only when you have reviewed the PRD and roadmap:

```text
$build-loop-codex I approve Phase 1 of docs/product-roadmap.md for local implementation only. Work in the TrueCost repository. Inspect existing changes first and preserve them. Read the relevant installed Next.js documentation before editing framework code. Implement only Phase 1, run typecheck, tests and build, review the diff, and verify the user flow locally. Mark tasks complete only after their checks pass. Stop at the phase boundary. Do not commit, push, publish, change Supabase data or create/update a cloud deployment.
```

For the optional phase-only route, use the following development authorization if it has not already been granted. The whole-goal prompt already includes this scope and must not ask for it repeatedly:

```text
I approve creating and using a fresh Convex development project and Clerk development application for TrueCost. Configure the prepared development integration and test with disposable data. Preserve existing local user data. Production deployment, paid purchases, Supabase changes and pushing commits remain unapproved. Tell me which account sign-in steps I need to complete myself.
```

For each later phase, replace `Phase 1` in the first prompt with the phase you have reviewed and approved. Keep the stop-at-boundary instruction.

Prefer `$build-loop-codex` for this existing app. `$build-mvp` is also installed, but its default workflow runs the entire roadmap and creates a commit at the end. Use it only when intentionally authorizing that breadth, and repeat any limits on commits or deployment. The user's instructions always override the skill's defaults.

### 8. Review the completed interface

```text
$design-better Review the implemented TrueCost guest comparison, sign-in return, saved comparison, report and feedback flows against docs/design.md and docs/prd.md. Verify actual clicks, keyboard use, phone layouts and loading/error/empty states. Fix issues within the approved scope and report what was exercised. Do not deploy or change backend data beyond the approved test environment.
```

### 9. Prepare launch

```text
$launch-checklist Audit the current TrueCost implementation against the existing docs/launch-checklist.md and PRD P0 requirements. Add actual evidence, measured values, versions and named owners; leave unproven gates unchecked. Verify provider settings, financial fixtures, privacy lifecycle, telemetry, accessibility, PWA updates and recovery. Prepare exact release and rollback steps for the real projects. Do not publish, push or change production data without my separate approval.
```

### 10. Review actual outcomes after a pilot

```text
$verify-product-outcomes Compare actual pilot evidence against the metrics in docs/analytics-plan.md and the PRD. Clearly separate missing data from zero usage. Report comparison completion, sign-in conversion, saves, download initiation, feedback and mature D7 cohorts. Recommend the next product change without modifying production or inventing results.
```

To turn collected feedback into the next iteration:

```text
$cluster-feedback-into-jobs Analyse the feedback export I provide for TrueCost. Group recurring jobs and problems, preserve anonymised evidence references, separate individual requests from recurring needs, and propose small follow-up changes. Do not send feedback content to other services or change production records.
```

## PowerShell commands

Run these in a terminal. They do not invoke skills.

### Existing application setup

```powershell
Set-Location -LiteralPath 'C:\Users\RajeshShinde\OneDrive - Electracom Projects (UK) Ltd\Documents\ChatGPT\truecost'
git status --short
node --version
npm --version
npm ci
```

The repository specifies Node 24 and already has a lockfile. `npm ci` rebuilds the dependency directory from that lockfile. It does not upgrade the application dependency list. Earlier checks found the original dependency installation incomplete; a separate temporary copy installed successfully and passed the existing checks. The commands above have been documented, not run against this repo in this task.

### Run locally

```powershell
npm run dev
```

Open the local address printed by Next.js. Keep the terminal running; use Ctrl+C to stop it. If Next.js selects another port, use that printed address.

### Verify changes

```powershell
npm run typecheck
npm test
npm run build
git diff --check
git status --short
```

Run commands one at a time and stop to fix a failure before proceeding. These checks complement browser testing. The existing scripts do not include `npm run lint` or an end-to-end test command; add those only if the implementation introduces and documents them.

### Add approved integration dependencies

After approving the integration phase:

```powershell
npm install @clerk/nextjs convex mixpanel-browser
```

This changes `package.json` and the lockfile. The coding agent must verify compatible versions against the installed Next.js/React versions and implement the providers, ownership checks and tracking wrapper. Installing packages alone does not connect the services.

### Connect the approved Convex development project

In a separate terminal, after authorizing development cloud setup:

```powershell
Set-Location -LiteralPath 'C:\Users\RajeshShinde\OneDrive - Electracom Projects (UK) Ltd\Documents\ChatGPT\truecost'
npx convex dev
```

Choose the TrueCost development project during setup. This command can create/configure a project and continuously deploy backend functions to a development backend. It is not a read-only local check. Keep it running alongside `npm run dev` when developing the connected app. See the [Convex Next.js guide](https://docs.convex.dev/quickstart/nextjs).

Production commands must be generated by the launch audit for the actual Vercel/Convex deployment configuration and approved before use. Running `npx convex deploy`, pushing to a deployment-connected branch or publishing through Vercel can change the live product. No production command has been executed by this planning task.

## Accounts and settings required

| Service | Setup to prepare | Scope |
| --- | --- | --- |
| Clerk | Development app, chosen sign-in methods, separate production app and domain later | Required for accounts |
| Convex | Fresh development project, authentication issuer, schema and owned records | Required for saves/feedback |
| Mixpanel | Development/test project or isolated test data, approved tracking plan, project token | Required for the requested analytics |
| Vercel | Existing project, preview/production environment separation, domain settings | Existing hosting |
| Sentry | Proposed monitoring service: scrubbed errors, release verification and tested alerts | Basic error monitoring is P0 for production |

The integration should document its final settings in `.env.example` using placeholders. Clerk uses `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; Convex setup supplies `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`. Configure `CLERK_JWT_ISSUER_DOMAIN` in the Convex environment. A signing secret is also needed if Clerk lifecycle webhooks are used. The proposed Mixpanel browser variable is `NEXT_PUBLIC_MIXPANEL_TOKEN`; that is an application convention to implement, not a setting already present.

Put actual secrets directly into local or provider environment settings. Keep them out of chat, PRDs and Git. Launch authentication is Clerk email OTP only; phone delivery and SMS setup are deferred. No budget or paid plan has been approved.

## Decisions to make next

The authoritative list is PRD D1-D6 and docs/product-decisions.md. D1 launch defaults and D2 email OTP are accepted; phone is deferred. The pilot audience is registered users in India, and budgets use INR. Rajesh and Ritesh are joint release/privacy/support/methodology owners and the budget is ₹0/free plans only. Remaining decisions concern privacy/retention, production regions, support coverage/contact, actual finance review and pilot outcomes. Ask only for unanswered choices before dependent work; continue independent authorized work.

## Sources and constraints

- User-provided MVP requirements from 15 September 2026 are the product scope.
- The local repository and earlier readiness checks are the implementation baseline.
- [Product OS source](https://github.com/buildbetter-app/product-os/tree/d0ad2dfb6700c75aa960c950f3e698fb0feca32a) supplies product-planning skills.
- [BuilderOS source](https://github.com/BuildGreatProducts/builder-os) supplies the existing build and design skills.
- [Clerk with Convex](https://docs.convex.dev/auth/clerk) documents the integration.
- [Clerk sign-in options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options) documents phone/SMS constraints.
- [Convex CLI](https://docs.convex.dev/cli/overview) documents development and deployment behavior.

This is a working guide. No vendor account, application implementation, purchase, production release or completion claim is implied by a command being listed here.
