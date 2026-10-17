# TrueCost Product OS and BuilderOS sequence

Updated 15 September 2026. Use this sequence for the existing app and documents. **Production readiness comes first.** Clerk email OTP is confirmed; phone sign-in is deferred.

Main task: **gpt-6-astra / xhigh**. Execution agents: **gpt-5.6-luna / high**. Astra selects scope, reviews evidence and accepts increments; Luna performs bounded work. Read the selected skill's installed instructions at invocation time.

## Recommended order

The [master execution goal](CODEX-GOAL.md) is the complete entry point. It runs the nine-stage Product OS planning pass first, then the BuilderOS/custom implementation loop, and repeats outcome/launch checks against the finished candidate. The table below shows each skill's role across delivery; do not treat every repeat as a fresh discovery project.

Run one stage at a time, updating existing artifacts. This is not a request to regenerate every document. Revisit a stage when an answer, implementation finding or new evidence changes it.

| Order | Skill | TrueCost output | Lead |
| --- | --- | --- | --- |
| 1 | [$write-product-decision](<C:/Users/RajeshShinde/.codex/skills/write-product-decision/SKILL.md>) | Preserve accepted D1/D2, India pilot, INR and active local/dev authorization. Resolve remaining D3-D6 choices. | Astra |
| 2 | [$scope-product-release](<C:/Users/RajeshShinde/.codex/skills/scope-product-release/SKILL.md>) | Reconfirm production scope. Preserve P0 privacy, accuracy and recovery; defer insurance/payments/live quotes/OCR. | Astra |
| 3 | [$write-product-requirements](<C:/Users/RajeshShinde/.codex/skills/write-product-requirements/SKILL.md>) | Reconcile existing PRD with b9e53c0 or newer inspected code; distinguish demo auth, production requirements and proposals. | Astra; Luna evidence |
| 4 | [$review-product-plan](<C:/Users/RajeshShinde/.codex/skills/review-product-plan/SKILL.md>) | Review the PRD and linked specs for contradictions, blockers and measurable acceptance; no silent rewrite. | Astra |
| 5 | [$define-product-metrics](<C:/Users/RajeshShinde/.codex/skills/define-product-metrics/SKILL.md>) | Audit the existing analytics-plan denominators, consent coverage and time windows; no invented business targets. | Astra; Luna drafting |
| 6 | [$plan-product-instrumentation](<C:/Users/RajeshShinde/.codex/skills/plan-product-instrumentation/SKILL.md>) | Finalize triggers, allowed properties, identity reset, consent, deduplication and tests before SDK integration. | Astra; Luna drafting |
| 7 | [$design-system](<C:/Users/RajeshShinde/.codex/skills/design-system/SKILL.md>) | Inspect the deployment and supplied references; create matching design.md/design.html from a reviewed direction. | Astra direction; Luna artifacts |
| 8 | [$plan-outcome-roadmap](<C:/Users/RajeshShinde/.codex/skills/plan-outcome-roadmap/SKILL.md>) | Keep TASK-001 through TASK-034, dependencies, evidence and priorities consistent. | Astra |
| 9 | [$build-loop-codex](<C:/Users/RajeshShinde/.codex/skills/build-loop-codex/SKILL.md>) | Implement a bounded task/phase, review, test real behavior, fix and record evidence. | Luna implementation; Astra acceptance |
| 10 | [$design-better](<C:/Users/RajeshShinde/.codex/skills/design-better/SKILL.md>) | Verify working mobile/desktop screens, clicks, keyboard, errors, offline states and motion; fix within scope. | Luna; Astra review |
| 11 | [$verify-product-outcomes](<C:/Users/RajeshShinde/.codex/skills/verify-product-outcomes/SKILL.md>) | Before release, check implemented behavior and mark user outcomes unknown. Repeat after pilot using actual outcomes. | Astra |
| 12 | [$plan-product-launch](<C:/Users/RajeshShinde/.codex/skills/plan-product-launch/SKILL.md>) | Resolve remaining owners, audience, support, budget, rollout and rollback gaps. Planning only. | Astra |
| 13 | [$launch-checklist](<C:/Users/RajeshShinde/.codex/skills/launch-checklist/SKILL.md>) | Add exact candidate evidence to the existing checklist. Prepare release steps; obtain production approval. | Luna evidence; Astra go/no-go |
| 14 | [$verify-product-outcomes](<C:/Users/RajeshShinde/.codex/skills/verify-product-outcomes/SKILL.md>) then [$cluster-feedback-into-jobs](<C:/Users/RajeshShinde/.codex/skills/cluster-feedback-into-jobs/SKILL.md>) | After an authorized pilot, analyze actual completion, saves, reports, feedback and mature cohorts; revise the roadmap. | Astra; Luna analysis |

Stages 1-8 mainly refine drafted work. They should not become a second full discovery project or prevent an independent local baseline check. Stage 9 repeats across production phases; Stage 10 runs as screens become usable. Retain adequate existing plan/checklist sections.

## Product OS-only order

Use the [Product OS planning goal](PRODUCT-OS-GOAL.md) to run this sequence as one planning task and prepare a BuilderOS handoff.

1. $write-product-decision: preserve accepted D1/D2 and record only remaining decisions; pilot users are in India and budgets use INR
2. $scope-product-release
3. $write-product-requirements
4. $review-product-plan
5. $define-product-metrics
6. $plan-product-instrumentation
7. $plan-outcome-roadmap
8. $verify-product-outcomes for implementation evidence
9. $plan-product-launch
10. $verify-product-outcomes and $cluster-feedback-into-jobs after actual pilot evidence

Insert BuilderOS $design-system before UI implementation, then repeat $build-loop-codex and $design-better. Use BuilderOS $launch-checklist before release approval.

## Optional skills

### Custom skills in the master goal

The master goal includes local preflight and reviewed installation of these four source skills when it is submitted and they are absent. The current documentation update does not install them.

| Skill | Point of use | TrueCost adaptation |
| --- | --- | --- |
| `new-feature` | Before implementation isolation | Reuse the assigned Codex worktree and preserve uncommitted planning context. |
| `code-structure` | During the build loop | Extract repeated operations without rewriting the finance engine or forcing Convex actions. |
| `evidence-driven-testing` | Verification inside every relevant slice | Record real behavior, assertions, revision and caveats; keep evidence local. |
| `before-and-after` | Meaningful UI changes | Compare equivalent state/viewport; check upload behavior before any sharing. |

`greploop` and `greploop-apps` remain conditional on configured Greptile and authorized external actions; `unslop` is optional alongside existing writing rules. All source links and installation status are in [SKILLS.md](SKILLS.md). Use Convex expert/reviewer for relevant backend work, efficient-frontier for useful delegation, and quick-recap for completion status.

### Demo apps and selective product helpers

Chronicle and Runway are selected Demo Day apps, not Product OS skill names. See [the production brief](demo-day.md#chronicle-and-runway-production-plan) and TASK-033/034. Use existing product skills for verified copy, positioning and success measures, then supported app/browser tools for production. Final app demonstrations require real recordings. The [skills inventory](SKILLS.md) separates installed skills from optional sources and app access.

- [$synthesize-customer-research](<C:/Users/RajeshShinde/.codex/skills/synthesize-customer-research/SKILL.md>): interpret actual interviews/notes. The team meeting supports team decisions, not borrower demand.
- [$validate-product-problem](<C:/Users/RajeshShinde/.codex/skills/validate-product-problem/SKILL.md>): examine an unresolved hypothesis using evidence; never invent research for a pitch.
- [$product-planner](<C:/Users/RajeshShinde/.codex/skills/product-planner/SKILL.md>): full vision intake that can regenerate major docs. Skip for this existing project unless the user requests a vision refresh.
- [$build-mvp](<C:/Users/RajeshShinde/.codex/skills/build-mvp/SKILL.md>): broad execution with a default final commit. Prefer the scoped loop; no commit/publish permission is implied.
- $idea-generator and $idea-validator: do not restart idea selection for an existing chosen product without a specific reason.

Convex implementation can use the installed Convex expert/reviewer skills where relevant. The approved Clerk choice and user instructions override alternative provider defaults.

## Copyable stage prompts

### Refine the existing contract

~~~text
$write-product-requirements $review-product-plan Read docs/prd.md, docs/product-roadmap.md and the latest inspected source. Preserve production-first priority and accepted D1/D2. Distinguish upstream demo behavior from production acceptance. Ask only unresolved D3-D6 questions, update the existing PRD where authorized, and return blockers with requirement IDs. Do not implement in this planning pass.
~~~

### Build a scoped increment

~~~text
$build-loop-codex Use Astra xhigh to orchestrate and Luna to implement the next dependency-ready production task in docs/product-roadmap.md. Follow docs/CODEX-GOAL.md and the authorization already given in this task. Assign file ownership, preserve changes, implement, review and test the real flow. Record evidence before checking the task. Continue authorized local/development work after Astra's review; do not publish, commit or push without approval.
~~~

### Prepare the production decision

~~~text
$plan-product-launch $launch-checklist Audit the exact candidate against docs/prd.md and docs/launch-checklist.md. Add actual evidence, measured results and named owners; leave missing checks open. Prepare exact production targets, rollout and rollback. Show the concrete go/no-go decision and request only remaining production authorization. Do not deploy as part of this audit.
~~~

Skill names are Codex prompt invocations, not PowerShell commands. Use the skill picker or linked SKILL.md if discovery needs refreshing. Terminal commands are in [WORKFLOW.md](WORKFLOW.md).

## Permission and completion rules

Writing a prompt does not run it. Submitting the [goal prompt](CODEX-GOAL.md) authorizes the selected local/dev scope. Do not add a fresh approval gate at every phase. Missing product decisions, provider login steps, paid commitments, production publishing and external submissions still need the applicable input.

The design-system skill requests visual references and reviewed direction. Inspect the supplied references first and skip answered intake questions. Keep design.md/design.html synchronized. The current authorization permits necessary reversible drafting.

The build loop's first-unchecked-task rule operates inside the selected production scope. Its review/testing requirements remain. If a required tool is unavailable, name the missing verification instead of checking the task. User authorization takes precedence over skill defaults.
