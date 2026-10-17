# Prepay UI integration map

**Checked:** 17 September 2026  
**Scope:** DEC-014 implementation handoff. This maps the current UI and call
sites to the dated, annual post-tax model. It does not approve tax policy or
resolve the pending property-scope decision.

## Current call graph

| Surface | Current contract and evidence | Integration consequence |
| --- | --- | --- |
| Loan Health | `app/loan/page.tsx:22-35` reads the saved loan and calls `prepaySnapshot(loan, surplus)`. `lib/health/analyse.ts:187-216` calculates interest saved and months saved only. | Keep this as a pre-tax teaser until it can consume the same validated result. Its copy currently promises a post-tax comparison at `app/loan/page.tsx:112-120`. |
| Prepay page | `app/prepay/page.tsx:47-81` owns an in-memory `PrepayInput`, hydrates loan fields once, and calls `recommendPrepay` as soon as four numeric fields are positive. There is no model snapshot or persistence. | Replace the direct recommendation call with a discriminated `supported`/`unsupported` calculation result. Preserve entered values when required facts are absent. |
| Recommendation | `lib/prepay/recommend.ts:95-180` calls `computePrepay`, derives `loanTaxBreakdown`, applies a fixed risk premium, and always returns a verdict and post-tax percentages. | Verdict, crossover, and post-tax figures must be withheld unless every route is assessed by the reviewed annual tax function and shared dated ledger. |
| Scenario arithmetic | `lib/prepay/compute.ts:93-191` produces four monthly scenarios. Investment value is a single corpus (`:171-180`) using a monthly post-tax haircut. | Feed all routes from `buildDatedPrepayScenarios` (`lib/prepay/dated-scenarios.ts:12-56,106-170`) and dated funding/growth/tax ledgers. Keep this old function only as a compatibility/pre-tax path during migration. |
| Tax helper | `lib/prepay/tax.ts:12-70` hardcodes caps, cess, equity LTCG factor and slab haircut. `loanTaxBreakdown` (`:73-126`) estimates one year from opening balance and booleans. | Do not adapt these constants into the reviewed engine. Use annual assessments and explicit source/version facts; keep this module behind an unsupported/legacy boundary until replaced. |

## Existing input versus required normalized facts

The current page exposes or defaults the following: balance, optional EMI,
rate, term, rate basis, surplus, prepayment fee/other charges, asset preset,
expected return, regime, slab buttons, two deduction claim booleans, and a
liquidity answer (`app/prepay/page.tsx:121-394`). `PrepayInput` is defined at
`lib/prepay/types.ts:33-67`.

The missing facts are material:

- **Loan and property:** calculation/anchor date, exact prepayment date and
  fee treatment, rate type and reset/payment schedule, property use and
  eligibility evidence, ownership share, and numeric remaining 24(b)/80C
  capacity for every tax year.
- **Taxpayer and years:** tax-year boundaries, applicable Act version and
  assessment-year handling, residence/profile and age where relevant, ordinary
  income context (including agricultural income where it affects the reviewed
  computation), special-rate income, losses/carry-forward treatment, surcharge
  policy, cess/source snapshot, and the dated rule for receiving and reinvesting
  a tax benefit. Preserve the original background-income context so every route
  can be assessed against the same base.
- **Investment:** instrument subtype, dated contribution lots, explicit return
  or accrual grid, disposal/accrual event dates, cost/proceeds/expense basis,
  holding/disposal facts, FD credit and payout schedule, equity exemption/STT
  facts, or debt-fund classification and effective date.

`lib/prepay/model-contract.ts:13-183` expresses most of the normalized loan,
investment, tax-year, and provenance shape, but it still needs to evolve for
the complete annual background-income/profile context, losses/carry-forward,
agricultural-income treatment, and any reviewed eligibility facts. Its
validator deliberately returns
`structurally-complete` with `support.status: "unsupported"` until methodology
review is complete (`:232-243,538-552`). It must remain the boundary: structural
validity must never be presented as a supported financial recommendation.

The first annual ordinary-tax primitive is narrower than the UI choices:
`lib/prepay/annual-ordinary-tax.ts:3-25,45-70,152-168` supports only its
versioned Tax Year 2026-27 Act 2025 snapshot, with resident status and explicit
zero special-rate income; old-regime assessment also needs age. It assesses
caller-supplied taxable ordinary income and does not establish complete
taxpayer eligibility, agricultural-income treatment, loss/carry-forward rules,
or deduction facts. Other years, nonzero special-rate income, and unresolved
profile facts must return `unsupported`, not receive a fallback factor.

## Current output and misleading paths

`PrepayRecommendation` (`lib/prepay/recommend.ts:47-88`) exposes verdict,
terminal wealth, `postTaxLoanCostPct`, `postTaxReturnPct`, crossover and risk
margin. The page renders these as completed results: “post-tax corpus” at
`app/prepay/page.tsx:492-500`, “loan really costs ... after tax” and a
recommendation at `:560-590`, and a tax explanation at `:662-700`.

These claims can leak from incomplete facts because `ready()` checks only four
positive numbers (`app/prepay/page.tsx:38-45`). The fixed-factor output also
ignores dated equity exemption/holding facts, annual slab/rebate interactions,
declining schedule interest, and when a deduction benefit becomes investable.
The review records the invariant defect and required suppression at
`docs/evidence/prepay-tax-model-review.md:133-157,185-204`.

The `/loan` teaser has a second leakage path: it computes the independent
pre-tax `prepaySnapshot` and says investing must beat the result “after tax”
(`app/loan/page.tsx:98-123`). It should either show a clearly pre-tax teaser or
read the same supported/unsupported model result.

## Reporting and persistence boundaries

- The prepay screen is session-only React state (`app/prepay/page.tsx:47-81`);
  no prepay input, dated ledger, annual assessment, assumptions, or result is
  saved.
- `LoanProvider` persists the saved loan and surplus/buffer through its private
  loan payload (`lib/loanStore.tsx:45-60,96-108,298-421`), but it does not
  persist a prepay calculation or tax snapshot.
- Existing report/history persistence is for comparisons only. The comparison
  snapshot is created and stored by `lib/store.tsx:455-470,486-507`, and its
  history record carries `calculationVersion` (`lib/comparison/history-transport.ts:30-39,122-150`).
  `app/compare/results/page.tsx:19-68` and `app/comparisons/page.tsx` render
  that comparison report flow; there is no prepay report call site.

The DEC-014 snapshot must therefore be a new versioned prepay model record,
not embedded opportunistically in a comparison snapshot or saved-loan payload.
If a report is added, it must consume that exact snapshot so screen and export
values match, including source dates, assumptions, missing fields, annual
before/after assessments, dated cash flows, and supported/unsupported status.

## Smallest faithful next implementation sequence

1. Add a page adapter that collects the missing normalized facts and validates
   them with `validatePrepayModelInput`; keep asset choices visible while
   returning explicit unsupported reasons. Do not silently infer the pending
   property scope.
2. Build the three dated loan routes, partition payments at tax-year
   boundaries, and calculate deductions from explicit capacity and eligibility.
3. Resolve each investment class through its explicit event schedule and feed
   gross growth, annual ordinary/special tax assessments, deduction benefits,
   tax costs, and settlement dates into one same-budget route ledger.
4. Return a versioned internal audit snapshot with source/version metadata and a
   discriminated result. Derive terminal wealth, recommendation and all copy
   from that result; use the truthful unsupported state until all required
   policy and review gates pass.
5. Keep the existing comparison report/history and saved-loan persistence
   boundaries unchanged. If a future product decision adds saved prepay
   results or a prepay report, serialize this same snapshot and add screen/PDF
   parity tests. Update the Loan Health teaser and prepay page to suppress
   tax-dependent claims on any unsupported route.

DEC-014 remains a full reviewed post-tax release requirement. Existing dated
primitives and the structural contract are usable foundations, but passing
arithmetic tests alone does not satisfy Rajesh/Ritesh financial-methodology
review or authorize the current fixed-factor recommendation.
