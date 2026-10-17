# TrueCost skill inventory

For the current production-first workflow, use the [ordered skill sequence](SKILL-SEQUENCE.md) and [Astra/Luna goal prompt](CODEX-GOAL.md). This inventory lists available tools; it is not a requirement to invoke every skill.

Verified on 15 September 2026. These are Codex skill names, not PowerShell commands. Paste an installed name beginning with `$` into Codex, followed by the task. Files are present locally; if a skill is absent from the picker, refresh discovery or attach its linked SKILL.md. This inventory does not imply that every skill is loaded in the current task.

## Installation record

- Product OS: **45 installed skills** from [BuildBetter Product OS](https://github.com/buildbetter-app/product-os/tree/d0ad2dfb6700c75aa960c950f3e698fb0feca32a), installed earlier on 15 September 2026. This update verifies and lists them.
- Exact Product OS source revision: `d0ad2dfb6700c75aa960c950f3e698fb0feca32a`.
- BuilderOS: **10 existing skills verified and preserved**, from [BuildGreatProducts BuilderOS](https://github.com/BuildGreatProducts/builder-os). This task did not update their versions.
- Installation directory: `C:\Users\RajeshShinde\.codex\skills`.
- The user requested both packages. Product OS was interpreted as BuildBetter Product OS after an optional package-choice question; several unrelated projects use a similar name.
- These skills are available to Codex projects on this machine; they were not added as application dependencies.

## The short path for TrueCost

Follow the nine Product OS stages in [SKILL-SEQUENCE.md](SKILL-SEQUENCE.md):

1. `$write-product-decision`: record the confirmed direction and unresolved decisions.
2. `$scope-product-release`: reduce the release to the smallest coherent outcome.
3. `$write-product-requirements`: reconcile the PRD with inspected code and evidence.
4. `$review-product-plan`: check the plan for grounding, coherence, risk and verifiability.
5. `$define-product-metrics`: define outcomes, inputs, guardrails and decision rules.
6. `$plan-product-instrumentation`: specify Mixpanel triggers, properties, consent and tests.
7. `$plan-outcome-roadmap`: sequence the next verifiable phases.
8. `$verify-product-outcomes`: verify implementation evidence without claiming prelaunch outcomes.
9. `$plan-product-launch`: prepare rollout, support, measurement, rollback and ownership.

Then use the BuilderOS implementation sequence:

1. `$design-system`: establish the reviewed visual system before UI implementation.
2. `$build-loop-codex`: implement one explicitly approved phase and record evidence.
3. `$design-better`: verify screens, interaction, accessibility, states and motion.
4. `$launch-checklist`: prepare the concrete release candidate before approval.

After an authorized pilot, repeat `$verify-product-outcomes`, then use
`$cluster-feedback-into-jobs` against actual customer evidence.

Full prompts and terminal commands are in `docs/WORKFLOW.md`.

## Michael Shimeles skills

Four selected skills were installed in this project's `.agents/skills/` on 15 September 2026 from revision `513f8a24aae6383b00356fa285144b1bc3730dc1`. All 11 installed files were compared with the inspected source; the included PolyForm Shield license was preserved. Global skill directories were unchanged. See [installation evidence](skill-installation-evidence.md). GrepLoop variants and unslop remain source references only.

- [`new-feature`](https://github.com/michaelshimeles/skills/blob/main/new-feature/SKILL.md): start feature work in an isolated branch/worktree; adapt for Codex-managed worktrees and uncommitted documents.
- [`code-structure`](https://github.com/michaelshimeles/skills/blob/main/code-structure/SKILL.md): extract repeated operational mechanics into shared functions while keeping domain decisions at the caller.
- [`evidence-driven-testing`](https://github.com/michaelshimeles/skills/blob/main/evidence-driven-testing/SKILL.md): capture actual test sessions with assertions and visual evidence, or clearly labelled headless/non-UI evidence.
- [`before-and-after`](https://github.com/michaelshimeles/skills/blob/main/before-and-after/SKILL.md): capture comparable evidence for a change.
- [`greploop`](https://github.com/michaelshimeles/skills/blob/main/greploop/SKILL.md): iteratively address Greptile review findings and push changes; defer until configured and authorized.
- [`greploop-apps`](https://github.com/michaelshimeles/skills/blob/main/greploop-apps/SKILL.md): variant using the `@greptile-apps` trigger for reviews exceeding the usual file-count limit; also deferred.
- [`unslop`](https://github.com/michaelshimeles/skills/blob/main/unslop/SKILL.md): edit prose to remove generic AI writing patterns; overlaps the user's Humanizer rules.

Recommended adoption order: evidence-first testing, selective code-structure
review and local before-and-after proof. Defer GrepLoop and keep `unslop`
optional because the existing writing rules already cover much of its purpose.

Installed entry points: [new-feature](../.agents/skills/new-feature/SKILL.md), [code-structure](../.agents/skills/code-structure/SKILL.md), [evidence-driven-testing](../.agents/skills/evidence-driven-testing/SKILL.md) and [before-and-after](../.agents/skills/before-and-after/SKILL.md). Read the actual file when applying it. Refresh Codex skill discovery or attach the file if the picker does not show it. Installation is separate from execution; actual applications are recorded in [execution-log.md](execution-log.md).

The recorder's preflight found FFmpeg/ffprobe unavailable. Use supported local browser captures and measured non-UI evidence until recording is available. This is a recorder prerequisite, not a failure of the application tests. Public upload options remain subject to explicit authorization.

## Supporting installed skills

These are relevant helpers outside the 55-skill Product OS and BuilderOS
inventory. Each path was verified locally on 15 September 2026.

- [`convex:convex-expert`](<C:/Users/RajeshShinde/.codex/plugins/cache/openai-curated-remote/convex/2.0.1/skills/convex-expert/SKILL.md>): Convex implementation rules for schemas, functions, auth, indexes, validators and deployment checks.
- [`convex:convex-reviewer`](<C:/Users/RajeshShinde/.codex/plugins/cache/openai-curated-remote/convex/2.0.1/skills/convex-reviewer/SKILL.md>): Convex security, authorization, validation, performance and code-quality review.
- [`quick-recap`](<C:/Users/RajeshShinde/.codex/skills/quick-recap/SKILL.md>): concise red, yellow or green completion status convention.
- [`efficient-frontier`](<C:/Users/RajeshShinde/.agents/skills/efficient-frontier/SKILL.md>): delegate repeatable work while retaining planning, synthesis and final review.

For demo copy, reuse the existing decisions, requirements, metrics and evidence;
do not restart the complete Product OS sequence. Use `$define-product-positioning`
only for an unresolved messaging need, `$validate-product-problem` only to assess
actual evidence, and `$plan-product-launch` to coordinate the package. Verify
claims with `$verify-product-outcomes`. No Runway-specific generation skill is
verified in this inventory. External production software may be used
through its browser or an explicit handoff. The final three to four minute video
should be an actual demo recording using synthetic loan inputs, with any Runway
visuals as supporting clips only.

## Chronicle and Runway app notes

Chronicle and Runway are apps or tools, not Product OS or BuilderOS skill names.
Do not invent `$chronicle` or `$runway` invocations.

- **Chronicle:** The user's workspace was read-only verified in Chrome at
  [Rajesh's Chronicle workspace](https://app.chroniclehq.com/2e1eec2b-7e34-4ba3-9b57-e5e7331314dd/home).
  The UI showed `Rajesh's Workspace` and an existing deck named `Plan the last
  stretch`. No TrueCost content or created artifact was verified. Task 033 is
  the Chronicle one-pager and optional deck; creating or publishing it remains
  a separate execution action.
- **Runway:** The explicitly requested plugin is
  `app-6a05e3b201788191be12b590b43e6ce3`, but the current tool inventory and
  MCP tool search returned no callable Runway capability. A Runway browser tab
  exists, but its editing, credits and export capability were not verified.
  Use an explicit Runway or browser handoff when executing. Do not silently
  replace it with Higgsfield. Task 034 covers Runway production assets and the
  video-editing handoff. Runway's editor is suited to short supporting clips;
  use the available approved editor for the assembled three to four minute
  demo recording. See [Runway export troubleshooting](https://help.runwayml.com/hc/en-us/articles/25286249355027-How-to-troubleshoot-an-export-failure)
  and [Edit Studio limits](https://help.runwayml.com/hc/en-us/articles/51683104370451-Creating-with-Edit-Studio)
  for current product constraints.

Updating the task list for Tasks 033 and 034 is documentation work. It is not
generation, editing, export or publication.

## Verification record

- Product OS links verified: **45/45 present** under `C:\Users\RajeshShinde\.codex\skills`.
- BuilderOS links verified: **10/10 present** under `C:\Users\RajeshShinde\.codex\skills`.
- Supporting links verified: **4/4 present** at the paths listed above.
- Michael Shimeles source skills verified as **not installed** in the local
  `.codex\skills` or `.agents\skills` directories.
- Missing linked files: **none**.

## Product OS complete list

| Skill | Purpose |
| --- | --- |
| [$align-product-stakeholders](<C:/Users/RajeshShinde/.codex/skills/align-product-stakeholders/SKILL.md>) | Map stakeholders, incentives, decision rights, conflicts, evidence needs, and communication paths for a product decision or initiative. |
| [$analyze-competitors](<C:/Users/RajeshShinde/.codex/skills/analyze-competitors/SKILL.md>) | Analyze direct competitors, indirect alternatives, non-consumption, and customer switching criteria using current evidence. |
| [$analyze-product-experiment](<C:/Users/RajeshShinde/.codex/skills/analyze-product-experiment/SKILL.md>) | Analyze product experiment results for validity, effect size, uncertainty, guardrails, heterogeneous effects, and the decision they support. |
| [$analyze-retention-and-adoption](<C:/Users/RajeshShinde/.codex/skills/analyze-retention-and-adoption/SKILL.md>) | Diagnose product activation, cohort retention, engagement, feature adoption, churn, and value realization using behavioral and qualitative evidence. |
| [$build-product-business-case](<C:/Users/RajeshShinde/.codex/skills/build-product-business-case/SKILL.md>) | Build an evidence-backed product investment case with baseline, counterfactual, value drivers, costs, scenarios, uncertainty, risks, option value, and decision criteria. |
| [$cluster-feedback-into-jobs](<C:/Users/RajeshShinde/.codex/skills/cluster-feedback-into-jobs/SKILL.md>) | Reframe a body of feature requests, complaints, call snippets, tickets, and survey responses into customer jobs with a traceable clustering receipt. |
| [$define-ideal-customer-profile](<C:/Users/RajeshShinde/.codex/skills/define-ideal-customer-profile/SKILL.md>) | Define an evidence-backed ideal customer profile using shared needs, value realization, urgency, fit, economics, adoption conditions, and disqualifiers. |
| [$define-jobs-to-be-done](<C:/Users/RajeshShinde/.codex/skills/define-jobs-to-be-done/SKILL.md>) | Define a durable job to be done from customer evidence, including situation, motivation, outcome, alternatives, forces, success evidence, and boundaries. |
| [$define-product-metrics](<C:/Users/RajeshShinde/.codex/skills/define-product-metrics/SKILL.md>) | Define a product metric system connecting customer value, a North Star or outcome measure, controllable inputs, guardrails, business effects, and decision rules. |
| [$define-product-positioning](<C:/Users/RajeshShinde/.codex/skills/define-product-positioning/SKILL.md>) | Define evidence-backed product positioning from competitive alternatives, differentiated capabilities, customer value, best-fit segment, category context, and proof. |
| [$define-product-vision](<C:/Users/RajeshShinde/.codex/skills/define-product-vision/SKILL.md>) | Define a durable, directional product vision describing the future customer reality, target beneficiary, distinctive change, principles, and boundaries. |
| [$design-ai-product-evaluation](<C:/Users/RajeshShinde/.codex/skills/design-ai-product-evaluation/SKILL.md>) | Design an empirical evaluation system for an AI product using representative tasks, quality dimensions, human and automated judgments, slices, thresholds, regressions, and online outcomes. |
| [$design-go-to-market-motion](<C:/Users/RajeshShinde/.codex/skills/design-go-to-market-motion/SKILL.md>) | Design a repeatable go-to-market motion connecting a beachhead segment, value proof, acquisition, evaluation, purchase, onboarding, expansion, and ownership. |
| [$design-growth-loop](<C:/Users/RajeshShinde/.codex/skills/design-growth-loop/SKILL.md>) | Design and evaluate a product-native growth loop with a value-producing action, transmission mechanism, recipient conversion, re-entry, coefficient, cycle time, quality guardrails, and experiment plan. |
| [$design-human-ai-workflow](<C:/Users/RajeshShinde/.codex/skills/design-human-ai-workflow/SKILL.md>) | Design a reliable human-AI workflow with explicit roles, autonomy, context, review, control, recovery, feedback, and accountability. |
| [$design-pricing-packaging](<C:/Users/RajeshShinde/.codex/skills/design-pricing-packaging/SKILL.md>) | Design pricing and packaging from customer value, segments, usage, willingness to pay, cost, competitive alternatives, and operational constraints. |
| [$design-product-experiment](<C:/Users/RajeshShinde/.codex/skills/design-product-experiment/SKILL.md>) | Design a product experiment that tests a decision-critical hypothesis with a valid comparison, primary metric, guardrails, stopping rule, analysis plan, and follow-up decision. |
| [$design-product-onboarding](<C:/Users/RajeshShinde/.codex/skills/design-product-onboarding/SKILL.md>) | Design an evidence-backed onboarding path from entry to first and repeated value, including segmentation, progressive setup, guidance, recovery, measurement, and experiments. |
| [$evaluate-product-market-fit](<C:/Users/RajeshShinde/.codex/skills/evaluate-product-market-fit/SKILL.md>) | Evaluate product-market fit using converging retention, behavior, customer pull, switching, economics, growth, and qualitative evidence by segment. |
| [$govern-ai-product-risk](<C:/Users/RajeshShinde/.codex/skills/govern-ai-product-risk/SKILL.md>) | Govern AI product risks through use-case boundaries, harm analysis, controls, accountability, testing, monitoring, incident response, and review triggers. |
| [$manage-product-portfolio](<C:/Users/RajeshShinde/.codex/skills/manage-product-portfolio/SKILL.md>) | Allocate product investment across outcomes, horizons, lifecycle stages, strategic bets, discovery, maintenance, and obligations as a coherent portfolio. |
| [$manage-product-sunset](<C:/Users/RajeshShinde/.codex/skills/manage-product-sunset/SKILL.md>) | Plan and govern a safe product, feature, integration, API, or plan sunset with evidence, affected-user analysis, alternatives, communication, migration, support, access, data, billing, and rollback. |
| [$map-customer-journey](<C:/Users/RajeshShinde/.codex/skills/map-customer-journey/SKILL.md>) | Map an evidence-backed customer journey across stages, actors, jobs, touchpoints, emotions, friction, handoffs, and measures. |
| [$map-product-opportunities](<C:/Users/RajeshShinde/.codex/skills/map-product-opportunities/SKILL.md>) | Build an evidence-backed opportunity map connecting a desired outcome to customer problems, possible solutions, assumptions, and tests. |
| [$plan-ai-model-rollout](<C:/Users/RajeshShinde/.codex/skills/plan-ai-model-rollout/SKILL.md>) | Plan a staged, observable, and reversible rollout for a new AI model, prompt, retrieval configuration, agent policy, or provider. |
| [$plan-customer-interviews](<C:/Users/RajeshShinde/.codex/skills/plan-customer-interviews/SKILL.md>) | Prepare unbiased customer interviews that investigate past behavior, struggling moments, alternatives, and decision context. |
| [$plan-outcome-roadmap](<C:/Users/RajeshShinde/.codex/skills/plan-outcome-roadmap/SKILL.md>) | Build an outcome-oriented roadmap that connects strategy, customer problems, bets, learning, dependencies, and evidence without presenting distant feature promises as certainty. |
| [$plan-product-discovery](<C:/Users/RajeshShinde/.codex/skills/plan-product-discovery/SKILL.md>) | Build an evidence-driven continuous discovery cadence with clear learning goals, participants, methods, decision points, and evidence hygiene. |
| [$plan-product-instrumentation](<C:/Users/RajeshShinde/.codex/skills/plan-product-instrumentation/SKILL.md>) | Create a product analytics tracking plan with decision questions, event semantics, identity, properties, privacy, ownership, quality checks, and release validation. |
| [$plan-product-launch](<C:/Users/RajeshShinde/.codex/skills/plan-product-launch/SKILL.md>) | Plan a product launch across customer readiness, product quality, support, operations, go-to-market, measurement, rollout, rollback, and post-launch learning. |
| [$prioritize-product-opportunities](<C:/Users/RajeshShinde/.codex/skills/prioritize-product-opportunities/SKILL.md>) | Prioritize product opportunities using strategy, customer impact, evidence strength, urgency, risk, effort, dependencies, and learning value without hiding judgment behind a score. |
| [$review-product-plan](<C:/Users/RajeshShinde/.codex/skills/review-product-plan/SKILL.md>) | Review a product strategy, requirements document, roadmap, launch plan, or bet using an independent evidence-first rubric for clarity, grounding, coherence, risk, and verifiability. |
| [$run-product-premortem](<C:/Users/RajeshShinde/.codex/skills/run-product-premortem/SKILL.md>) | Run a structured premortem on a product bet, requirements document, rollout, migration, or launch and convert plausible failure modes into mitigations, owners, triggers, and contingency plans. |
| [$run-product-review](<C:/Users/RajeshShinde/.codex/skills/run-product-review/SKILL.md>) | Run a recurring product operating review focused on outcomes, customer evidence, metric movement, delivery reality, risks, decisions, and learning. |
| [$scope-product-release](<C:/Users/RajeshShinde/.codex/skills/scope-product-release/SKILL.md>) | Reduce a product release to the smallest coherent outcome while preserving trust, usability, measurement, and operational safety. |
| [$segment-product-market](<C:/Users/RajeshShinde/.codex/skills/segment-product-market/SKILL.md>) | Segment a product market using evidence about jobs, situations, behavior, needs, adoption constraints, economics, and value potential. |
| [$set-product-goals](<C:/Users/RajeshShinde/.codex/skills/set-product-goals/SKILL.md>) | Translate product strategy into a small system of outcome goals, measurable results, guardrails, ownership, and review rules. |
| [$shape-product-strategy](<C:/Users/RajeshShinde/.codex/skills/shape-product-strategy/SKILL.md>) | Shape an evidence-backed product strategy with a diagnosis, guiding policy, coherent choices, resource allocation, explicit deferrals, risks, and measures. |
| [$size-market-opportunity](<C:/Users/RajeshShinde/.codex/skills/size-market-opportunity/SKILL.md>) | Estimate market opportunity with transparent top-down and bottom-up models, ranges, assumptions, sensitivity, and evidence quality. |
| [$size-product-bet](<C:/Users/RajeshShinde/.codex/skills/size-product-bet/SKILL.md>) | Set the appetite, boundaries, assumptions, option value, and kill criteria for a product bet before detailed solutioning. |
| [$synthesize-customer-research](<C:/Users/RajeshShinde/.codex/skills/synthesize-customer-research/SKILL.md>) | Turn interviews, calls, surveys, observations, support records, and notes into traceable findings and decision implications. |
| [$validate-product-problem](<C:/Users/RajeshShinde/.codex/skills/validate-product-problem/SKILL.md>) | Assess whether a product problem is important, frequent, underserved, strategically relevant, and supported by sufficient evidence to justify the next investment. |
| [$verify-product-outcomes](<C:/Users/RajeshShinde/.codex/skills/verify-product-outcomes/SKILL.md>) | Compare implemented and observed product behavior against intended customer outcomes, requirements, quality constraints, and release evidence. |
| [$write-product-decision](<C:/Users/RajeshShinde/.codex/skills/write-product-decision/SKILL.md>) | Write a durable product decision record capturing context, decision, evidence, options, tradeoffs, dissent, owner, consequences, follow-up, and reconsideration triggers. |
| [$write-product-requirements](<C:/Users/RajeshShinde/.codex/skills/write-product-requirements/SKILL.md>) | Write evidence-linked product requirements that define the problem, target users, outcomes, scope, behavior, quality constraints, success evidence, non-goals, risks, and open decisions without over-specifying implementation. |

## BuilderOS complete list

| Skill | Purpose |
| --- | --- |
| [$idea-generator](<C:/Users/RajeshShinde/.codex/skills/idea-generator/SKILL.md>) | Discover a product idea. Optional here because TrueCost already exists. |
| [$idea-validator](<C:/Users/RajeshShinde/.codex/skills/idea-validator/SKILL.md>) | Pressure-test audience, problem and alternatives with evidence. |
| [$product-planner](<C:/Users/RajeshShinde/.codex/skills/product-planner/SKILL.md>) | Capture a full founder vision and generate strategy, PRD and roadmap. |
| [$design-system](<C:/Users/RajeshShinde/.codex/skills/design-system/SKILL.md>) | Create matching design.md and design.html from visual references. |
| [$design-better](<C:/Users/RajeshShinde/.codex/skills/design-better/SKILL.md>) | Review and improve interface craft, states, motion and accessibility. |
| [$build-loop-codex](<C:/Users/RajeshShinde/.codex/skills/build-loop-codex/SKILL.md>) | Implement an approved task or phase, review, test and fix it in Codex. |
| [$build-loop-claude-code](<C:/Users/RajeshShinde/.codex/skills/build-loop-claude-code/SKILL.md>) | Equivalent build workflow for Claude Code. |
| [$build-loop-cursor](<C:/Users/RajeshShinde/.codex/skills/build-loop-cursor/SKILL.md>) | Equivalent build workflow for Cursor. |
| [$build-mvp](<C:/Users/RajeshShinde/.codex/skills/build-mvp/SKILL.md>) | Execute a whole approved roadmap; its defaults include a final commit. |
| [$launch-checklist](<C:/Users/RajeshShinde/.codex/skills/launch-checklist/SKILL.md>) | Audit the implemented app and write a practical launch guide. |

## Working rules

- User instructions take priority over skill defaults. The current approval boundary remains in place for app implementation, deployment and external changes.
- `$build-mvp` runs broadly and normally creates a commit. Prefer the phase-scoped `$build-loop-codex` prompt in the workflow guide for TrueCost.
- Product Planner expects a complete vision intake before its full document-generation workflow. The current PRD is a first draft grounded in the conversation, not a claim that this intake is complete.
- Product OS works with local artifacts. BuildBetter account access or a connector is optional and was not installed or used.
- No skill guarantees a complete product from one invocation. Check each phase against the PRD, tests and actual browser behavior.

## Clerk official skills, installed 15 September 2026

Installed all 20 public skills from [clerk/skills](https://github.com/clerk/skills) into project `.agents/skills/` for Codex. Source revision: `7523bd34543de745eed93b29acdf114d33404dfd`; installer `skills@1.5.26`. Installation evidence and limits: [clerk-skills-installation.md](clerk-skills-installation.md). Global skills and other projects were not modified. Installation alone is not an application of these workflows.

- [`clerk`](../.agents/skills/clerk/SKILL.md)
- [`clerk-android`](../.agents/skills/clerk-android/SKILL.md)
- [`clerk-astro-patterns`](../.agents/skills/clerk-astro-patterns/SKILL.md)
- [`clerk-backend-api`](../.agents/skills/clerk-backend-api/SKILL.md)
- [`clerk-billing`](../.agents/skills/clerk-billing/SKILL.md)
- [`clerk-chrome-extension-patterns`](../.agents/skills/clerk-chrome-extension-patterns/SKILL.md)
- [`clerk-cli`](../.agents/skills/clerk-cli/SKILL.md)
- [`clerk-custom-ui`](../.agents/skills/clerk-custom-ui/SKILL.md)
- [`clerk-expo`](../.agents/skills/clerk-expo/SKILL.md)
- [`clerk-nextjs-patterns`](../.agents/skills/clerk-nextjs-patterns/SKILL.md)
- [`clerk-nuxt-patterns`](../.agents/skills/clerk-nuxt-patterns/SKILL.md)
- [`clerk-orgs`](../.agents/skills/clerk-orgs/SKILL.md)
- [`clerk-react-patterns`](../.agents/skills/clerk-react-patterns/SKILL.md)
- [`clerk-react-router-patterns`](../.agents/skills/clerk-react-router-patterns/SKILL.md)
- [`clerk-setup`](../.agents/skills/clerk-setup/SKILL.md)
- [`clerk-swift`](../.agents/skills/clerk-swift/SKILL.md)
- [`clerk-tanstack-patterns`](../.agents/skills/clerk-tanstack-patterns/SKILL.md)
- [`clerk-testing`](../.agents/skills/clerk-testing/SKILL.md)
- [`clerk-vue-patterns`](../.agents/skills/clerk-vue-patterns/SKILL.md)
- [`clerk-webhooks`](../.agents/skills/clerk-webhooks/SKILL.md)

For TrueCost, invoke the router `clerk`, then `clerk-setup` and `clerk-nextjs-patterns`; use `clerk-custom-ui` for the email-code flow/appearance, `clerk-webhooks` for lifecycle synchronization, and `clerk-testing` for auth verification when those slices are reached. Keep Convex authorization and ownership checks in their separate backend review. Organization, billing and native-app skills are installed but outside current product scope. Existing app/keys are already configured: do not rerun provisioning or broaden Clerk CLI access just because a skill suggests it.
