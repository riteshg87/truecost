# Prepayment post-tax model contract

**Date checked:** 16 September 2026  
**Scope:** implementable model contract and independent fixtures; documentation only  
**Status:** proposed release contract for finance-methodology review  
**Owner decision:** DEC-014 is recorded separately by the release owner

This contract defines when TrueCost may show a post-tax prepayment comparison.
It is a product and calculation specification, not tax advice. The tax facts
below are limited to the official sources listed in [Sources](#sources), checked
on the date above. A source change, a missing required input, or a case outside
the support matrix produces an `unsupported` result for the dependent tax
comparison. The engine must keep the raw loan schedule available where it can.

## Why this contract is needed

The current engine has a useful starting point, but its post-tax labels describe
an approximation that the inputs cannot identify:

- `postTaxReturnPct` applies a tax rate to the expected return and compounds the
  reduced percentage monthly. It cannot represent a gain taxed once on disposal.
- `loanTaxBreakdown` uses opening balance times rate for a full year, even when
  the remaining term is shorter or crosses a tax-year boundary. It infers the
  80C amount from a boolean instead of remaining capacity.
- `recommendPrepay` adjusts the loan headline and verdict for tax while the
  terminal-wealth rows do not receive the same tax cash flows.

The current input fields are `taxSlabPct`, `regime`, `claims24b`, `claims80c`,
`assetClass`, `expectedReturnPct`, loan terms, fees, and a prepayment mode. They
do not include a tax year, deduction headroom, property use, asset cost basis,
holding period, disposal event, or tax-credit timing. The model therefore needs
an explicit support boundary before a tax-aware verdict can be shown. See the
[FIN-REVIEW-07 arithmetic review](prepay-tax-model-review.md) for independent
counterexamples.

The inspected implementation is [tax.ts](../../lib/prepay/tax.ts),
[types.ts](../../lib/prepay/types.ts), [compute.ts](../../lib/prepay/compute.ts),
and [recommend.ts](../../lib/prepay/recommend.ts). Those files remain unchanged
by this slice.

### Statutory transition and section names

The Income-tax Act, 2025 came into force on 1 April 2026. The official
transition FAQ says tax years beginning before that date continue under the
Income-tax Act, 1961, while Tax Year 2026-27 onward uses the 2025 Act. The
snapshot therefore needs `taxActVersion` as well as a date. The current mapping
for this contract is:

| Earlier reference | Income-tax Act, 2025 reference | Contract use |
| --- | --- | --- |
| section 24(b) | section 22(1)(b), with the section 22(2) limits | Use the 1961 reference for pre-1 April 2026 tax years and section 22 for later tax years. |
| sections 80C and 80CCE | section 123 read with Schedule XV | Use the 1961 references for pre-1 April 2026 tax years and section 123/Schedule XV for later tax years. |
| section 115BAC | section 202 | Use the regime rule for the tax year, carrying forward an existing election only under the transition rule. |
| section 111A | section 196 | Qualifying short-term equity gains; see the 17 September source refresh. |
| section 112A | section 198 | Qualifying long-term equity gains; preserve eligibility and annual context. |
| section 50AA | section 76 | Specified-mutual-fund classification and acquisition-date treatment. |

The capital-gain pages still publish several provisions under their 1961 Act
names while the new Act and Finance Act updates are being presented together.
The model must store the source version and effective date rather than infer a
new section number from a label. The proposed boundaries below are therefore
review items, not an authority to remove any existing FD, debt, or equity choice
from the UI. Those choices stay visible; the tax-dependent result gets an
explicit `unsupported` state until its required facts are present.

## Contract invariants

1. Every displayed post-tax number is derived from one dated ledger shared by
   the no-prepay, reduce-tenure, reduce-EMI, and invest-instead routes.
2. Loan interest and principal come from the actual payment schedule. The
   schedule is split at each tax-year boundary before deductions are applied.
3. A deduction is applied only when the relevant legal eligibility facts,
   numeric remaining capacity, regime, and tax-year rule are present.
4. An asset tax event is explicit. “Expected return” is a scenario assumption;
   it does not establish a tax rate, holding period, or guaranteed outcome.
5. Tax benefit and tax cost have dates. A tax amount is investable on its stated
   receipt date only when the scenario says it is received and reinvested.
6. Internal rupee values retain full calculation precision. Display rounding is
   applied at the final presentation boundary only.
7. `postTaxCostPct`, `postTaxReturnPct`, crossover, and verdict are withheld when
   the required cash-flow dates or tax inputs are unavailable. A bare disclaimer
   cannot turn an unsupported calculation into a supported one.
8. Each snapshot records `modelVersion`, normalized inputs, assumptions,
   calculation time, source dates, missing fields, and `supported` or
   `unsupported` status. This satisfies [PRD FR-17](../prd.md#fr-17-financial-accuracy-and-provenance).

## Supported contract for the first reviewed model

Support means “the complete required inputs are supplied and the case fits the
rules below.” A generic asset button or a checked claim box is not sufficient.

### Loan deductions

The first model may support the following narrow cases:

- **New regime:** no section 24(b) self-occupied deduction and no section 80C
  deduction are applied. The official 115BAC computation page lists those
  deductions among the items given up under the new regime.
- **Old regime, self-occupied acquisition or construction:** section 24(b)
  interest may use a numeric remaining capacity up to ₹2,00,000 per tax year,
  subject to the source conditions and the owner's eligibility declaration.
  The loan schedule still supplies the actual interest paid or payable.
- **Old regime, eligible principal repayment:** section 80C principal may use
  a numeric remaining capacity from ₹0 through ₹1,50,000. This is the aggregate
  section 80C, 80CCC, and 80CCD(1) ceiling, so the model must ask for the
  remaining amount after other eligible payments.

Section 24(b) repair, renewal, reconstruction, let-out-property treatment,
pre-construction interest, multiple co-owners, and mixed-purpose loans remain
unsupported in this first contract until the owner and finance-methodology
reviewer specify their inputs and allocation rules. A user may still calculate
the pre-tax loan schedule.

### Investment tax events

The first model may support these instrument-specific events:

| Instrument | Required event and tax basis | Support boundary |
| --- | --- | --- |
| Fixed deposit | Interest credit or accrual dates, contractual rate, principal, payout or maturity, and the user's ordinary marginal tax profile | Supported only when the bank's credit/accrual schedule is explicit. A generic “7% FD taxed every year” preset is insufficient. |
| Listed equity, qualifying equity-oriented fund, or business-trust unit | Acquisition date and cost, disposal date and proceeds, instrument subtype, STT eligibility where relevant, and annual section 112A exemption headroom | Supported only for a documented section 112A case. For transfers on or after 23 July 2024, the official page states 12.5% LTCG above ₹1,25,000 subject to its conditions. |
| Debt mutual fund | Fund classification under the applicable section 50AA definition, acquisition date, cost, disposal/redemption date, proceeds, and expenses | Supported only when the fund classification and effective-date rule are known. A label of “debt fund” alone is unsupported. |

The model must carry the selected tax event through the horizon. For a disposal
asset, gross wealth accumulates under the return assumption and tax is charged
at disposal. For an accrual asset, each specified event creates a dated tax cash
flow. The model must not replace either event with a single universal haircut.

For debt funds, resolve the applicable tax-year definition and acquisition-date
rule together. Do not infer the financial year of application solely from an
amendment's commencement date. The 17 September refresh verifies section 76 of
the 2025 Act; historical cases still need their year-specific 1961 Act rule.
The snapshot must store the selected source and rule. Missing fund
classification or acquisition date produces an unsupported result.

## Required normalized inputs

### Annual tax integration requirement

The new ledger primitives accept explicit effective factors to test timing and cash conservation. Those factors are not a replacement for the annual policy calculation. A fixed marginal factor can miss a slab boundary or rebate change when a deduction and investment income occur in the same year.

Use one reviewed annual tax function for each route and year. Let `B` be the same background income/context in every route, `D` that route's eligible deductions and `I` its recognized investment income, with ordinary and special-rate classes represented separately. An auditable decomposition is:

```
deduction benefit = tax(B) - tax(B with D)
investment tax cost = tax(B with D and I) - tax(B with D)
net route tax effect = tax(B) - tax(B with D and I)
```

This identity is arithmetic, not an eligibility rule. Both terms must use the same function and annual context so their combination equals the final route tax difference. Do not independently consume an exemption, rebate or deduction in both terms. Store before/after assessments and any allocation ordering in the snapshot.

Recognition dates and settlement dates are separate. Derive cash effects from the explicit settlement schedule after calculating annual liability; a credit date alone does not establish when the final tax is paid. Where settlement changes reinvestable cash, feed that change back into later investment balances. Unknown settlement or eligibility remains unsupported. The implementation must not promote the current factor-driven arithmetic modules to reviewed recommendations before this integration is complete.

The UI may collect these through several screens, but the calculation snapshot
must normalize them into one record.

### Tax profile and dates

| Field | Requirement |
| --- | --- |
| `calculationDate` | Date at which the outstanding balance and surplus are measured. |
| `taxYear` / `assessmentYear` | Tax year containing each event. The schedule must use the applicable year boundaries, including 31 March / 1 April transitions. For a year before 1 April 2026 record the 1961 Act and AY; for Tax Year 2026-27 onward record the 2025 Act and TY. |
| `taxActVersion` | `1961` or `2025`, selected from the event date and transition rule. Do not apply old section labels to a later tax year without a mapped source. |
| `regime` | `old` or `new`, selected for the relevant tax year. |
| `ordinaryMarginalRatePct` | Marginal ordinary-income rate for the modeled taxpayer and year, separate from a display label such as “30% slab.” |
| `surchargePolicy` | Explicit surcharge rate or a declared zero-surcharge assumption. The capital-gain source states surcharge and 4% health and education cess are added where applicable. |
| `cessPct` | 4% for the supported model, versioned with the source. |
| `taxpayerScope` | Resident/status and other profile flags only where they change the supported rule. Non-resident, special-rate, rebate, AMT, loss carry-forward, and multi-person returns are unsupported unless modeled explicitly. |
| `taxBenefitReceiptRule` | Date or rule for when a deduction benefit is received. If it is received after filing and is not reinvested, the ledger must say so. |

`taxSlabPct` may remain as an input alias during migration, but it must be
normalized to a reviewed marginal-rate assumption. It must not be silently
treated as the final tax rate in every case.

### Loan and deduction facts

| Field | Requirement |
| --- | --- |
| `outstandingAtCalculationDate` | Positive principal balance at the anchor date. |
| `rateType`, `rateStructure`, `ratePct` | Terms needed to reproduce each scheduled payment and rate reset. |
| `remainingMonths`, `currentEmi` | Either a validated EMI or enough terms to derive it, with payment dates and rounding rule. |
| `prepaymentDate`, `prepayAmount`, `prepayFeePct`, `otherFees` | Exact cash-flow dates and whether each fee is paid from the surplus or financed. |
| `propertyUse` | At minimum `self_occupied_acquisition`, `self_occupied_repair`, `let_out`, or `other`. Only the first value is in the first 24(b) support boundary. |
| `propertyEligibilityFacts` | Acquisition/construction timing, completion and certificate facts needed by the reviewed 24(b) rule. Missing facts mean unsupported. |
| `remaining24bCapacityByTaxYear` | Numeric rupee capacity, bounded by the reviewed cap and available for this loan after other claims. |
| `remaining80cCapacityByTaxYear` | Numeric rupee capacity after other eligible payments, bounded by the aggregate cap. |
| `ownershipShare` | Explicit share where ownership affects an allowable amount. Joint or ambiguous ownership is unsupported in the first model. |

The engine must produce, for each payment, opening balance, interest, principal,
payment date, rate, fees, and closing balance. “Annual interest equals opening
balance times annual rate” is not an accepted substitute.

### Investment facts

| Field | Requirement |
| --- | --- |
| `assetTaxClass` and `instrumentSubtype` | Separate economic assumption from the legal tax category. Examples: FD interest, listed equity under 112A, specified mutual fund under 50AA. |
| `principalInvested` and `investmentDate` | Initial contribution and date. Monthly contributions need their own dates. |
| `expectedGrossReturnPct` | Scenario assumption with horizon, compounding convention, and volatility/guarantee label. It is not a sourced tax fact. |
| `returnSchedule` | Monthly or other explicit accrual schedule used to build gross wealth. |
| `acquisitionCost`, `acquisitionDate`, `disposalDate`, `proceedsRule` | Required for disposal-tax instruments. |
| `contributionLots` and `lotDispositionMethod` | Every initial or freed-EMI contribution is a dated lot with its own cost and acquisition date. Use the reviewed FIFO or other legally applicable allocation method at disposal; a single horizon holding period is insufficient. |
| `expenseRule` | Transfer expenses included in the tax basis; STT treatment must follow the selected official rule. |
| `exemptionHeadroom` | Annual headroom such as the section 112A threshold where the selected instrument qualifies. |
| `fundClassification` | Required for debt mutual funds, including the applicable effective date. |
| `taxEventSchedule` | Dates at which interest is credited/accrued or gains are realized. |

If any required instrument field is absent, the asset may remain visible as a
pre-tax scenario assumption, while post-tax corpus and a tax-dependent verdict
are `unsupported`.

## Dated cash-flow ledger

The ledger is the calculation's source of truth. Each route starts with the same
anchor date and user-entered surplus.

### Loan side

For each scheduled payment date `t`:

```text
interest[t]  = schedule interest on opening balance at t
principal[t] = payment[t] - interest[t]
closing[t]   = opening[t] - principal[t] - prepaymentPrincipal[t]
```

At the prepayment date, record the principal payment and fee as separate cash
flows. Partition `interest[t]` and `principal[t]` by tax year. For each deduction
head, apply the lesser of the eligible scheduled amount and the user's remaining
capacity for that year. Decrease capacity as it is used. A tax benefit is:

```text
taxBenefit[t] = allowableDeduction[t] × reviewed marginal tax factor[t]
```

The factor includes the explicit cess and surcharge policy. It is not inferred
from the asset's tax rate. The benefit is posted on the declared tax-credit date,
not automatically on the payment date. If no receipt rule is supplied, the
tax-dependent comparison is unsupported.

### Investment side

Record the contribution and every gross return accrual at its date. At each tax
event, calculate the taxable amount from the instrument's selected basis:

- ordinary interest uses the explicit credit/accrual schedule and ordinary
  marginal rate;
- a qualifying 112A disposal uses the documented cost, STT conditions,
  exemption headroom, contribution-lot holding periods, and applicable gain rate
  for that transfer date. A recurring monthly contribution near the end of a
  long horizon can be short-term even when the initial lot is long-term;
- a section 50AA case uses its dated acquisition and classification rules and
  the applicable short-term treatment.

Post tax as a cash outflow on the event date. Reinvest tax benefits, tax refunds,
or freed EMI cash only when the scenario explicitly says so, using the stated
return schedule. Keep TDS, advance tax, filing refunds, and final tax separate
unless the reviewed model chooses one consolidated cash-flow assumption.

### Comparison and annualization

The same dated ledger computes terminal wealth for every route. The verdict is
based on those terminal values and the selected liquidity rule. A percentage
comparison may be shown only when annualization is defined from dated cash flows
(for example, an IRR/XIRR convention with a documented sign and date rule).
Otherwise show rupee totals and a clear unsupported percentage state. A ratio of
total net interest to opening principal is not an annual loan rate.

## Support and suppression matrix

| Case | Result |
| --- | --- |
| New regime with complete dates and no deduction claim | Loan tax benefit is zero. Investment tax still needs its own instrument event and tax profile. |
| Old regime with numeric capacity, property eligibility, tax year, schedule, and receipt rule | Apply only the supported 24(b)/80C rule and show the assumptions. |
| Old regime with only `claims24b` or `claims80c` boolean | Unsupported tax comparison; do not assume full capacity. |
| Let-out, repair, reconstruction, pre-construction, joint, mixed-purpose, or multiple-loan allocation | Pre-tax schedule may run. Tax-dependent result is unsupported pending a reviewed allocation contract. |
| Generic equity or debt label without cost, dates, subtype/classification, or event | Pre-tax illustration may run. Post-tax corpus and tax-dependent verdict are unsupported. |
| Equity case without STT/112A eligibility or annual exemption state | Unsupported 112A tax result. |
| Debt fund without classification under the applicable section 50AA date rule | Unsupported debt-fund tax result. |
| Foreign assets, special-rate income, rebates, losses/carry-forwards, AMT, or missing surcharge policy | Unsupported until separately modeled and reviewed. |
| Negative/zero/guaranteed return claim without a defined distribution model | Keep the user assumption visible, but suppress tax-derived return labels until the event schedule is valid. |

## Independent fixtures for implementation

These fixtures are synthetic reference ledgers. They are intended to be encoded
outside the production functions and compared at full precision. They do not
state that a taxpayer is eligible.

### Fixture A: disposal taxation versus an annual haircut

Inputs: ₹10,00,000 invested at month 0, 11% annual gross return, 120 months,
one disposal at month 120, no fees, 12.5% disposal tax, and no exemption for
this isolated arithmetic. Gross corpus is ₹29,89,149.60; gain is ₹19,89,149.60;
tax is ₹2,48,643.70; net corpus is ₹27,40,505.90. The current shortcut produces
₹26,08,200.42 by compounding 9.625%. The contract expects the disposal ledger,
not the shortcut, when the event is selected.

### Fixture B: six-payment schedule and 24(b) capacity

Inputs: ₹10,00,000 outstanding, 12% reducing rate, six payments, old regime,
eligible 24(b) assumption, full numeric capacity, 30% ordinary marginal rate,
4% cess, and no 80C. The derived EMI is ₹1,72,548.37. Independent schedule
interest is ₹35,290.20, principal is ₹10,00,000, and tax benefit at 31.2% is
₹11,010.54. A full-year opening-balance estimate of ₹1,20,000 interest is a
failed reference. If 80C is enabled, use numeric remaining capacity; six
payments alone do not establish that the ₹1,50,000 cap is exhausted.

### Fixture C: capacity changes the tax result

Use the same twelve-payment loan in two runs, changing only
`remaining24bCapacityByTaxYear` from ₹0 to ₹80,000. The schedule and gross
wealth must remain the same. The allowable interest deduction and dated tax
benefit must change by the capacity-limited amount. Terminal wealth and verdict
must change only through that ledger, with the tax-benefit receipt rule held
constant.

### Fixture D: tax-year boundary

Use an eleven-month schedule with the calculation date before 31 March and
payment dates on both sides of 31 March. Reference output must show separate
interest, principal, capacity consumption, and tax-benefit dates for each tax
year. A single twelve-month opening-balance estimate fails this fixture.

### Fixture E: FD credit timing

Use ₹10,00,000, 7% contractual return, twelve months, 30% ordinary marginal rate,
4% cess, and two runs: a bank-documented annual credit/accrual schedule versus a
contractual maturity payout where the product contract permits it. Gross
interest is ₹70,000 under the simple annual assumption, while the documented
event schedule differs. Payment at maturity alone does not prove that tax was
deferred; recognition must follow the selected accounting/tax rule and be
reviewed. If that rule is unknown, the post-tax result is unsupported.

### Fixture F: dated debt-fund classification

Use identical gross return, cost, and redemption proceeds in two runs. The first
has a documented specified-mutual-fund classification and acquisition date under
the applicable section 50AA rule. The second omits classification. The first may
produce a reviewed tax result; the second must be `unsupported`, with no guessed
debt-fund rate.

## Questions for the owner and methodology reviewer

These are decisions, not facts that the implementation should guess:

1. Is the first release limited to self-occupied acquisition/construction loans,
   and which exact eligibility evidence is acceptable for 24(b)?
2. Should users enter total income and a tax function, or a reviewed marginal
   rate plus an explicit surcharge policy? Who owns updates when slabs change?
3. Which FD credit schedules and debt-fund classifications will the product
   accept, and who maintains their effective-date source snapshots?
4. When does a deduction benefit become cash available to the user, and is it
   reinvested in each scenario?
5. Is deterministic monthly compounding the accepted expected-return convention,
   or should distributions and volatility be represented separately?
6. Are losses, rebates, carry-forwards, AMT, non-resident cases, joint ownership,
   and multiple loans release deferrals? They should remain unsupported until
   each has an owner and a method.

## Work that can start without a tax-policy decision

The following are mathematical and data-contract tasks. They do not decide
eligibility, tax rates, or which user cases the product ultimately supports:

- build a date-aware reducing-loan schedule with explicit anchor and payment
  dates, month-end clamping, small final-payment handling, and separate
  prepayment cash flows;
- partition schedule rows at 1 April / 31 March boundaries and preserve full
  rupee precision;
- represent tax-year deduction capacity and investment contribution lots as
  data, even when the current UI cannot supply them;
- carry `supported` / `unsupported` with missing-field reasons through snapshots;
- test the independent fixtures in this document against reference arithmetic.

The owner and methodology reviewer still decide the tax-law inputs, eligibility
evidence, source refresh process, tax-benefit receipt/reinvestment convention,
and the final support set. The mathematical work must not fill those fields
with defaults.

## Sources

All links below are official Income Tax Department material. They were checked on
16 September 2026. The source's effective date or update label remains part of
the model snapshot; “checked” does not mean a timeless rule.

1. [Section 24, Income Tax Department](https://www.incometaxindia.gov.in/w/section-24-59): 1961 Act interest-on-borrowed-capital treatment, self-occupied ₹2,00,000 and repair/renewal ₹30,000 limits, and certificate conditions. The page carries an official “Year 2021” label and applies only to the relevant pre-transition tax-year contract.
2. [Section 22, Income-tax Act, 2025](https://www.incometaxindia.gov.in/w/section-22-211): current Act house-property deduction, including section 22(1)(b), pre-construction instalments, ₹2,00,000 and ₹30,000 limits, and certificate conditions.
3. [Deductions, Income Tax Department](https://www.incometaxindia.gov.in/w/deductions): 1961 Act section 80C inclusion and ₹1,50,000 aggregate ceiling, with regime restrictions.
4. [Official transition FAQ](https://www.incometaxindia.gov.in/documents/81799/11848482/FAQs-on-Interplay-and-Transition.pdf/05f80c1a-073c-a5d7-fb6f-55509242be53?doAsUserId=9rMQatnoqCcGNU9mEWvVNA%3D%3D&t=1774082865717): 1 April 2026 transition, section 80C to section 123/Schedule XV mapping, section 115BAC to section 202, tax-year boundaries, and savings rules.
5. [Computation of tax for individual, Income Tax Department](https://www.incometaxindia.gov.in/w/computation-of-tax-for-individual-1): 115BAC slabs and deductions given up under the 1961 Act new regime. The new Act equivalent is section 202.
6. [Capital gains, Income Tax Department](https://www.incometaxindia.gov.in/w/capital-gain): year of transfer, 12.5% LTCG treatment and cess/surcharge context, plus section 112A conditions and threshold. The page was last updated 27 May 2026 when checked.
7. [Sale of shares, Income Tax Department](https://www.incometaxindia.gov.in/en/sale-of-shares): section 112A listed-equity conditions, STT requirements, ₹1,25,000 threshold, transfer-date rule for 12.5% LTCG, and FIFO treatment for demat lots.
8. [Section 112A, current official page](https://www.incometaxindia.gov.in/w/section-112a-60): qualifying asset and STT conditions, the transfer-date rate split, and the ₹1,25,000 aggregate threshold.
9. [Section 50AA, current official page](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-50aa-4): current specified-mutual-fund definition and effective-date treatment for units, market-linked debentures, and unlisted bonds/debentures.
10. [Circular No. 1/2024, official PDF](https://www.incometaxindia.gov.in/documents/20117/6507196/Circular-1-2024.pdf/a88097f3-169d-65fa-2232-0e8d47076331?t=1762868793763): Finance Act 2023 section 50AA treatment for specified mutual funds acquired on or after 1 April 2023.
11. [ICDS I, accounting policies, Income Tax Department](https://www.incometaxindia.gov.in/en/income-computation-and-disclosure-standards-icds-1): accounting-method context for income computation. The model still requires the instrument's actual credit/accrual event schedule and reviewer approval of FD recognition.

## 17 September source refresh and policy-adapter gap

Checked the official [2025 Act as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), PDF pages 143–144 and 257–260. Section 196 covers qualifying short-term equity gains at 20%; section 198 covers qualifying long-term equity gains at 12.5% above ₹1,25,000. Both contain resident basic-exemption adjustments. Section 76 carries specified-mutual-fund treatment, including acquisition-date and fund-composition conditions. These are base provisions, not complete effective tax factors.

Implementation consequence: the current per-lot arithmetic is insufficient to resolve policy. Add annual context for unused basic exemption and its allocation across income classes, distinguish it from the equity-gain allowance, and validate instrument qualification. A chosen marginal rate and a fund label alone cannot establish a supported result. Surcharge, cess, losses, rebates and settlement timing still require a coherent annual tax calculation and review.

For future projected years, explicitly record any constant-law scenario assumption and its source date; do not imply that today's statute establishes future tax law. The refresh changes no engine constants or support status. Tax-policy mapping and reviewer approval remain release requirements.

## Scope limit

This document changes no calculation, provider, authentication, build, or
release behavior. It records the inputs, dated rules, suppression boundary, and
reference fixtures required before implementing the reviewed post-tax model.

## Statutory rounding source check, 17 September 2026

The current [Income-tax Act 2025 as amended by Finance Act 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), section 516, specifies rounding total income and payable/refundable amounts to multiples of ten rupees after discarding paise; a units digit of five or more rounds upward. Verified against the official indexed enacted text.

Integration requirement: preserve raw projection arithmetic for audit, but label it separately from a statutory assessment. The reviewed ordinary assessment adapter must round total income before evaluating slabs and round the resulting payable amount after tax, surcharge and cess. Calculate route deltas from those consistently assessed amounts; rounding the delta alone is not equivalent. Add boundary cases at units 4/5/9, paise, and rebate/surcharge thresholds. Existing raw annual arithmetic tests remain deliberately unrounded and do not establish filing-ready tax amounts. Special-income component allocation and complete taxpayer settlement remain separate review requirements.
