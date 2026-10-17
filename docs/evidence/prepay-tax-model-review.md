# FIN-REVIEW-07: prepayment tax model review

**Date:** 16 September 2026  
**Scope:** source and arithmetic review only; no product or provider changes  
**Status:** open methodology finding; this is not tax advice or a statement of current tax law

## Finding

The prepayment screen presents a post-tax comparison, but the current inputs do
not contain enough information to support that claim across the three asset
presets and both tax regimes.

- `postTaxReturnPct` applies a tax percentage to the expected annual return and
  then compounds that reduced rate monthly. This is an accrual-style shortcut;
  it does not represent an asset whose gain is taxed when it is disposed of.
  See [tax.ts](../../lib/prepay/tax.ts#L51) and
  [compute.ts](../../lib/prepay/compute.ts#L108).
- `loanTaxBreakdown` estimates a full year's interest from the opening balance,
  even when fewer than twelve months remain. It also infers 80C capacity from a
  boolean, although the input does not record remaining capacity or other uses
  of that cap. See [tax.ts](../../lib/prepay/tax.ts#L73).
- The selected loan deductions affect `postTaxLoanCostPct` and the crossover,
  but do not enter any of the three terminal-wealth ledgers. The screen can
  therefore change its recommendation while displaying the same projected
  wealth rows. See [recommend.ts](../../lib/prepay/recommend.ts#L95) and
  [compute.ts](../../lib/prepay/compute.ts#L141).

The product contract requires sourced and reviewed tax assumptions, preserved
precision, and suppression of a dependent recommendation when its assumption is
unavailable. See [PRD FR-17](../prd.md#fr-17-financial-accuracy-and-provenance).

## Independent arithmetic counterexamples

The calculations below use ordinary monthly compounding and keep the engine's
own configured constants where noted. They are independent ledgers, not calls
to the production functions. They deliberately avoid asserting eligibility
under current law. Where a deduction is used, the assumption is that the user
has the required eligibility and unused capacity and receives the resulting tax
benefit at the stated slab.

### 1. Equity gain taxed on disposal is understated by a recurring haircut

**Synthetic input:** surplus ₹10,00,000; expected equity return 11% annually;
120-month horizon; no fee. The loan fields do not affect the investment corpus
in this isolated comparison. Use the implementation's `EQUITY_LTCG_PCT = 12.5`
and assume all gains are realized once at month 120, with no annual exemption.

| Quantity | Current implementation | Independent disposal ledger |
| --- | ---: | ---: |
| Return used during accumulation | 9.625% (11% × (1 − 12.5%)) | 11% gross |
| Gross corpus before disposal tax | — | ₹29,89,149.60 |
| Gain taxed at month 120 | — | ₹19,89,149.60 |
| Tax at 12.5% on that gain | — | ₹2,48,643.70 |
| Net corpus at month 120 | ₹26,08,200.42 | ₹27,40,505.90 |
| Difference | — | **₹1,32,305.48 higher** |

The current value is
`₹10,00,000 × (1 + 9.625% / 12)^120`. The independent value is
`gross corpus − 12.5% × (gross corpus − principal)`. The difference exists
because the current function taxes the return during every compounding period,
while the stated assumption taxes the accumulated gain once at disposal. The
current screen labels the result “post-tax corpus” and uses it in the
recommendation.

This does not prove that 11% will occur, that all gains qualify for one rate, or
that a particular person can use the assumed treatment. It proves that a
disposal-tax asset cannot be represented by the current shortcut without an
explicit approximation label.

### 2. A six-month loan is charged a full year's interest and deduction

**Synthetic input:** outstanding ₹10,00,000; reducing rate 12%; six months
remaining; old regime; 24(b) claimed; 80C not claimed; 30% slab; no fee. The
derived EMI is ₹1,72,548.37. Assume, only for this ledger, that the 24(b)
benefit is eligible, has full unused capacity, and is credited at the end of
the six-month horizon.

| Quantity | Current implementation | Six-month amortization ledger |
| --- | ---: | ---: |
| Interest base | ₹1,20,000.00 (`balance × 12%`) | ₹35,290.20 over six actual payments |
| Principal base | ₹19,50,580.40 (`EMI × 12 − annual interest`) | ₹10,00,000.00 over six payments |
| 24(b) deduction | ₹1,20,000.00 | ₹35,290.20 |
| Tax saved at 31.2% | ₹37,440.00 | ₹11,010.54 |
| Net cost on the displayed period | ₹82,560.00 on the engine's one-year proxy | ₹24,279.66 over the six-payment schedule |

The current function's “Interest over the next year” line is therefore not an
actual next-year schedule for this input. Its 8.256% value is an annual opening-
balance proxy, while the reference figures above are a six-payment schedule;
they are deliberately not presented as comparable annual loan rates. A
tax-credit timing assumption would also be needed to convert either schedule
to a cash-flow IRR. The current input has no tax-credit timing, deduction
headroom, property-use or eligibility field to resolve that uncertainty.

The example leaves 80C off so the mismatch is isolated to the annual interest
schedule. If 80C is switched on, the current function can also apply its full
₹1,50,000 cap to `EMI × 12 − annual interest` without knowing how much of that
cap remains after other eligible payments. Six payments do not by themselves
make a ₹1,50,000 principal deduction impossible: the six-month schedule repays
₹10,00,000 of principal. The unsupported part is the missing headroom and
eligibility input, not the number of payments.

### 3. A selected deduction changes the verdict while wealth rows stay fixed

**Synthetic input:** outstanding ₹10,00,000; reducing rate 8%; twelve months
remaining; ₹1,00,000 surplus; equity expected return 11%; 30% slab; no fee.
Compare two otherwise identical inputs:

1. new regime, no deductions;
2. old regime, 24(b) claimed, with assumed full unused capacity; 80C off.

Both branches use the equity shortcut's 9.625% return, so the current terminal
wealth rows are identical:

| Quantity | New regime | Old regime + 24(b) |
| --- | ---: | ---: |
| Derived EMI | ₹86,988.43 | ₹86,988.43 |
| Current `reduceTenure.terminalWealth` | ₹1,08,328.62 | ₹1,08,328.62 |
| Current `investInstead.terminalWealth` | ₹1,10,061.16 | ₹1,10,061.16 |
| Current loan tax saved | ₹0.00 | ₹24,960.00 (80,000 × 31.2%) |
| Current post-tax loan cost | 8.000% | 5.504% |
| Current advantage after loan cost | 1.625 points | 4.121 points |
| Current recommendation with a 2-point equity margin | line-ball | invest |

An independent twelve-payment ledger gives no-prepay interest of ₹43,861.15
and prepayment-route interest of ₹35,702.33. Under the stated capacity
assumption, no-prepay therefore receives ₹13,684.68 of 24(b) tax benefit and
the prepayment route receives ₹11,139.13. The no-prepay/invest route has an
additional **₹2,545.55** tax cash-flow advantage before any tax-credit timing
or reinvestment assumption. Adding that difference to the current projected
wealth gap changes the simple month-12 comparison from ₹1,732.54 to
₹4,278.09 in favour of investing.

The exact tax-aware terminal values need a rule for when each tax benefit is
received and whether it is reinvested. That missing timing is part of the
finding. The invariant defect is already visible: changing only the selected
loan deduction changes the displayed post-tax cost and verdict, while the
terminal wealth rows do not change at all.

## Why the current input contract is insufficient

`PrepayInput` contains `taxSlabPct`, regime, and two claim booleans, but no
remaining deduction capacity, eligibility facts, tax-year boundaries, filing or
credit timing, asset holding period, disposal date, gain basis, or exemption
state. See [types.ts](../../lib/prepay/types.ts#L50). Those omissions matter in
different ways:

- A boolean `claims80c` cannot distinguish ₹0, ₹50,000, and ₹1,50,000 of
  remaining capacity after other eligible payments.
- A one-year opening-balance estimate cannot represent declining monthly
  interest, a term shorter than a year, or a tax year boundary inside the
  remaining term.
- A single percentage cannot represent whether an expected return is taxed on
  accrual, annually, or on disposal. It also cannot determine when a tax saving
  becomes investable cash.
- The terminal-wealth comparison must include the same tax cash flows on every
  route. Applying a tax adjustment only to the headline rate makes the verdict
  and the wealth cards describe different models.

## Recommended next slice

Choose one of these explicit product decisions before changing the engine.

### Model correction

Define a deliberately narrow supported model and version it in the snapshot:

1. Add explicit eligibility and remaining-capacity inputs for every deduction
   the model permits. Keep 24(b) and 80C capacity separate.
2. Generate the actual loan schedule month by month, partitioned by tax year,
   and calculate interest and principal deductions from that schedule. Apply
   only the user-entered remaining capacity.
3. Give each asset preset a documented tax event and timing assumption. For a
   disposal model, accumulate gross wealth and tax the gain at the selected
   horizon. For an accrual model, apply tax at the specified event dates.
4. Put tax benefits and tax costs into the dated cash-flow ledger for all
   scenarios, then derive both terminal wealth and the recommendation from that
   same ledger.
5. Record the selected assumptions, source date, model version and calculation
   time in the output snapshot. Add independent fixtures for the three cases
   above before changing the recommendation copy.

This is a finance-methodology change. It needs reviewer agreement on supported
eligibility, timing and asset treatment before implementation.

### Interim truthful unsupported state

Until that model is approved, keep the raw prepayment and investment scenarios
available but suppress claims that depend on the missing inputs:

- mark the tax comparison as “Tax treatment cannot be determined from these
  inputs” when a deduction capacity, eligibility or tax-event assumption is
  missing;
- hide or relabel “post-tax corpus”, “loan cost after tax”, “crossover”, and an
  invest/prepay verdict that depends on those figures;
- preserve the entered figures, prepayment fee, liquidity gate and a clearly
  labelled pre-tax illustration so the product function remains useful;
- keep the assumptions panel explicit about what was not modeled and avoid
  presenting a disclaimer as a substitute for a supported calculation.

The new regime with no loan deduction can simplify the loan side, but it does
not by itself resolve disposal timing for equity or debt assets. A supported
FD-only approximation would still need its accrual timing stated. The safest
next implementation is therefore either the narrow, fully specified model
above or a truthful unsupported state for the affected post-tax claims.

## Evidence and limits

The figures in this note were recomputed with separate arithmetic using the
input values shown above and the source constants where stated. No current tax
rule, eligibility conclusion, provider behavior, app code, build, or deployment
was changed or validated by this review. The three ledgers establish model
inconsistency and missing inputs; they do not select the legal or tax-policy
assumptions for release.
