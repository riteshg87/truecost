# Independent dated ledger fixtures for prepay tax work

**Date checked:** 17 September 2026  
**Scope:** arithmetic evidence only; no tax advice, eligibility finding, or
release decision  
**Source contract:** [prepay-tax-model-contract.md](prepay-tax-model-contract.md)

These fixtures are independent reference ledgers for the six proposed fixtures
in the contract. They are intentionally separate from production code. The
implementation primitive in [cashflows.ts](../../lib/prepay/cashflows.ts)
supplies dated reducing-balance rows, including the anchor row, financial year,
interest, principal, fees supplied by its caller, and closing balance. It does
not select tax rates, eligibility, tax event dates, or benefit timing.

## Shared conventions

- Rupees are retained at full precision in the arithmetic and rounded to ₹0.01
  only in the tables. A displayed amount passes when it is within ₹0.01 of the
  reference value.
- Monthly loan rates are nominal annual rates divided by 12. EMI is the usual
  reducing-balance formula. The final row pays the remaining balance.
- Where a benefit factor is needed, `30% × (1 + 4%) = 31.2%` is an explicit
  **illustrative model factor**, not a claimed statutory rate.
- Investment examples use nominal monthly compounding unless they explicitly
  say that the return is taxed at a disposal event. The return is a scenario
  input, not a guaranteed outcome.
- Tax event dates and receipt dates are ledger inputs. If either is missing, the
  dependent post-tax result is `unsupported`.

## Fixture A: disposal tax versus monthly haircut

**Inputs:** ₹10,00,000 contribution on 2026-01-01; 11% nominal annual gross
return; 120 monthly periods ending 2036-01-01; one disposal event on the end
date; 12.5% illustrative disposal factor; no exemption and no fee.

Formula:

```text
gross = 10,00,000 × (1 + 0.11 / 12)^120
gain = gross − 10,00,000
disposal tax = gain × 0.125
net disposal wealth = gross − disposal tax
```

| Dated ledger item | Expected amount |
| --- | ---: |
| 2026-01-01 contribution | -₹10,00,000.00 |
| 2036-01-01 gross corpus before disposal | ₹29,89,149.60 |
| 2036-01-01 taxable gain | ₹19,89,149.60 |
| 2036-01-01 disposal tax | -₹2,48,643.70 |
| 2036-01-01 net corpus | **₹27,40,505.90** |

The shortcut `10,00,000 × (1 + (11% × (1 − 12.5%))/12)^120` produces
₹26,08,200.42. Its difference from the disposal ledger is ₹1,32,305.48. The
contract gap is the asset event model: one disposal tax cannot be represented
by applying the disposal factor to every month's return. This is the contract's
Fixture A and tests that the same dated ledger drives the displayed corpus and
verdict.

## Fixture B: actual six-payment loan schedule and 24(b) capacity

**Inputs:** ₹10,00,000 outstanding on 2026-01-31; 12% reducing annual rate;
six monthly payments; EMI ₹1,72,548.3667108814; old-regime and property
eligibility are synthetic assumptions; numeric 24(b) headroom is at least the
actual interest; no 80C claim. The benefit is credited on 2026-08-31.

| Payment date | Opening balance | Interest | Principal | Closing balance |
| --- | ---: | ---: | ---: | ---: |
| 2026-02-28 | ₹10,00,000.00 | ₹10,000.00 | ₹1,62,548.37 | ₹8,37,451.63 |
| 2026-03-31 | ₹8,37,451.63 | ₹8,374.52 | ₹1,64,173.85 | ₹6,73,277.78 |
| 2026-04-30 | ₹6,73,277.78 | ₹6,732.78 | ₹1,65,815.59 | ₹5,07,462.19 |
| 2026-05-31 | ₹5,07,462.19 | ₹5,074.62 | ₹1,67,473.74 | ₹3,39,988.45 |
| 2026-06-30 | ₹3,39,988.45 | ₹3,399.88 | ₹1,69,148.48 | ₹1,70,839.97 |
| 2026-07-31 | ₹1,70,839.97 | ₹1,708.40 | ₹1,70,839.97 | ₹0.00 |
| **Total** |  | **₹35,290.20** | **₹10,00,000.00** |  |

The 2026-08-31 benefit is `₹35,290.2002652885 × 31.2% = ₹11,010.54`.
The full-year opening-balance proxy would call interest ₹1,20,000 and benefit
₹37,440.00. The contract gap is use of actual dated schedule rows rather than
an opening balance multiplied by an annual rate. The six payments also do not
prove that an 80C ceiling is exhausted; only numeric remaining headroom can do
that.

## Fixture C: zero versus partial 24(b) headroom on one actual schedule

**Inputs:** ₹20,00,000 outstanding on 2026-04-01; 12% reducing annual rate;
12 payments; same schedule and gross investment assumptions in both runs. The
schedule crosses a financial-year boundary, so capacity is entered as ₹80,000
for FY 2026-27 and ₹80,000 for FY 2027-28. The first 11 payments carry
₹1,30,611.55 interest in FY 2026-27; the 12th carries ₹1,759.38 in FY
2027-28. Use the illustrative 31.2% benefit factor.

| Run | FY 2026-27 allowable interest | FY 2027-28 allowable interest | Total benefit |
| --- | ---: | ---: | ---: |
| A: zero headroom in both years | ₹0.00 | ₹0.00 | **₹0.00** |
| B: ₹80,000 headroom in each year | ₹80,000.00 | ₹1,759.38 | **₹25,508.93** |

The full schedule interest is ₹1,32,370.93. Run B therefore uses the lesser of
actual interest and yearly capacity: `80,000 + 1,759.3819540266 = ₹81,759.38`.
The loan schedule, gross wealth, and fee cashflows are identical between runs;
only the dated tax benefit changes. The contract gap is the missing numeric
headroom. A boolean claim cannot distinguish ₹0 from a partial ₹80,000 cap, and
the cap must be consumed separately in each tax year.

## Fixture D: payment and benefit split at 31 March

**Inputs:** ₹5,00,000 outstanding on 2026-02-15; 12% reducing annual rate;
11 payments; EMI ₹48,227.0378556320. Payment 1 is 2026-03-15 (FY 2025-26);
payments 2 through 11 are 2026-04-15 through 2027-01-15 (FY 2026-27).
Use capacity ₹4,000 in FY 2025-26 and ₹20,000 in FY 2026-27. These deliberately
bind below actual interest to exercise the lesser-of rule. Benefits are received
on 2026-07-31 and 2027-07-31 respectively.

| Financial year | Payment dates | Actual interest | Actual principal | Capacity | Allowable deduction | Benefit at 31.2% | Receipt date |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| FY 2025-26 | 2026-03-15 | ₹5,000.00 | ₹43,227.04 | ₹4,000.00 | ₹4,000.00 | ₹1,248.00 | 2026-07-31 |
| FY 2026-27 | 2026-04-15 to 2027-01-15 | ₹25,497.42 | ₹4,56,772.96 | ₹20,000.00 | ₹20,000.00 | ₹6,240.00 | 2027-07-31 |
| **Total** |  | **₹30,497.42** | **₹5,00,000.00** |  | **₹24,000.00** | **₹7,488.00** |  |

A single annual opening-balance estimate has no way to produce these two
capacity ledgers or the two receipt dates. The contract gap is tax-year
partitioning at 31 March/1 April, including capacity consumption and delayed
benefit posting.

## Fixture E: delayed tax benefit receipt

**Inputs:** ₹80,000 allowable deduction posted on 2026-12-31; illustrative tax
factor 31.2%; benefit ₹24,960.00. Compare an immediate receipt on 2026-12-31
with a delayed receipt on 2027-06-30. Both are reinvested at 6% nominal annual
return, compounded monthly, through 2027-12-31 (month-end anniversaries; no extra daily accrual).

| Cashflow | Date received | Months invested to horizon | End value |
| --- | --- | ---: | ---: |
| Immediate benefit | 2026-12-31 | 12 | ₹26,499.48 |
| Delayed benefit | 2027-06-30 | 6 | ₹25,718.22 |
| Timing difference |  |  | **₹781.26** |

Formula: `₹24,960 × (1 + 0.06/12)^months`. If the benefit is not reinvested,
both runs still post ₹24,960, but their dated ledgers differ. The contract gap
is assuming that a deduction becomes spendable on the payment date. A tax
dependent terminal wealth or verdict must state the receipt rule and whether
the cash is reinvested; otherwise it is `unsupported`.

## Fixture F: dated FD credit timing and debt-fund classification

### F1. FD timing subcase

**Inputs:** ₹10,00,000 invested on 2026-01-31; 7% contractual 12-month return;
gross interest ₹70,000; illustrative ordinary factor 31.2%; tax cashflow
₹21,840.00. To isolate date handling in a monthly ledger, one run records an
interim annual-credit event on 2026-12-31 and another records contractual
maturity payout on 2027-01-31, one ledger period later, while holding gross
interest fixed. The event date must be kept even when the gross interest
happens to match.

| Event choice | Gross interest event | Tax cashflow | Net event cashflow |
| --- | ---: | ---: | ---: |
| Annual credit/accrual | 2026-12-31: ₹70,000.00 | Same date: -₹21,840.00 | ₹48,160.00 |
| Maturity payout | 2027-01-31: ₹70,000.00 | Same date: -₹21,840.00 | ₹48,160.00 |

For a 6% reinvestment convention, one month of timing is worth
`₹21,840 × 0.06/12 = ₹109.20` before further compounding. The contract gap is
the current lack of a bank-documented credit/accrual schedule and a recognition
rule. Payment at maturity alone does not establish tax deferral; unknown timing
must suppress the post-tax result.

### F2. Debt-fund classification subcase

**Inputs:** identical ₹10,00,000 cost on 2026-04-01, identical ₹11,00,000
redemption proceeds on 2028-04-01, and identical expenses in both runs. Run A
contains a documented instrument classification and effective-date rule for the
selected section 50AA case. Run B contains only the label “debt mutual fund.”

| Run | Cost | Redemption | Classification and effective date | Result |
| --- | ---: | ---: | --- | --- |
| A | ₹10,00,000.00 | ₹11,00,000.00 | Present and reviewed | Tax result may be computed under that rule |
| B | ₹10,00,000.00 | ₹11,00,000.00 | Missing | **`unsupported`**, no guessed rate |

The contract gap is input identification, not arithmetic. Equal proceeds do not
make two legal tax events interchangeable. A debt-fund label without
classification and acquisition-date rule cannot produce a post-tax corpus.

## Fixture G: equal total budget when a prepayment fee is charged

**Inputs:** total available budget ₹1,02,000 on 2026-01-01; prepayment route
uses ₹1,00,000 principal plus a separate 2% fee of ₹2,000 on that date;
investment route has the same total budget and therefore invests ₹1,02,000;
11% nominal annual return; 12 monthly periods to 2027-01-01. This isolates
budget treatment; loan interest saved by the principal payment is intentionally
not assumed.

```text
factor = (1 + 0.11 / 12)^12 = 1.1157188362
equal-budget investment end value = 1,02,000 × factor = ₹1,13,803.32
if fee is silently omitted = 1,00,000 × factor = ₹1,11,571.88
omitted-budget effect = ₹2,000 × factor = ₹2,231.44
```

| Route or error | 2026-01-01 cashflow | 2027-01-01 end value |
| --- | ---: | ---: |
| Prepay route | -₹1,00,000 principal; -₹2,000 fee | Loan side requires its own schedule |
| Equal-budget invest route | -₹1,02,000 investment | **₹1,13,803.32** |
| Fee omitted from budget comparison | -₹1,00,000 investment | ₹1,11,571.88 |

The contract gap is fee and budget symmetry. The fee must be a dated cashflow,
and routes compared under an equal budget must receive the same total outlay.
Financing the fee would be a different scenario with another loan row; it cannot
be inferred from this fixture.

## Fixture H: monthly contribution lots have different holding periods

**Inputs:** twelve ₹10,000 contribution lots on the first day of each month
from 2027-01-01 through 2027-12-01; 10% nominal annual gross return;
disposal on 2028-01-01; 12.5% illustrative disposal factor; no exemption or
expense. The factor is held constant solely to isolate dated lot arithmetic.

| Lot date | Months held | Gross at disposal | Gain | Tax | Net lot value |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2027-01-01 | 12 | ₹11,047.13 | ₹1,047.13 | ₹130.89 | ₹10,916.24 |
| 2027-02-01 | 11 | ₹10,955.83 | ₹955.83 | ₹119.48 | ₹10,836.35 |
| 2027-03-01 | 10 | ₹10,865.29 | ₹865.29 | ₹108.16 | ₹10,757.13 |
| 2027-04-01 | 9 | ₹10,775.49 | ₹775.49 | ₹96.94 | ₹10,678.56 |
| 2027-05-01 | 8 | ₹10,686.44 | ₹686.44 | ₹85.80 | ₹10,600.63 |
| 2027-06-01 | 7 | ₹10,598.12 | ₹598.12 | ₹74.77 | ₹10,523.36 |
| 2027-07-01 | 6 | ₹10,510.53 | ₹510.53 | ₹63.82 | ₹10,446.72 |
| 2027-08-01 | 5 | ₹10,423.67 | ₹423.67 | ₹52.96 | ₹10,370.71 |
| 2027-09-01 | 4 | ₹10,337.52 | ₹337.52 | ₹42.19 | ₹10,295.33 |
| 2027-10-01 | 3 | ₹10,252.09 | ₹252.09 | ₹31.51 | ₹10,220.58 |
| 2027-11-01 | 2 | ₹10,167.36 | ₹167.36 | ₹20.92 | ₹10,146.44 |
| 2027-12-01 | 1 | ₹10,083.33 | ₹83.33 | ₹10.42 | ₹10,072.92 |
| **Total** |  | **₹1,26,702.81** | **₹6,702.81** | **₹837.85** | **₹1,25,864.96** |

Each row uses `gross = 10,000 × (1 + 0.10/12)^months` and
`tax = gain × 0.125`. Treating the whole ₹1,20,000 as one 12-month lot would
show gross ₹1,32,565.57 and net ₹1,30,994.87, overstating net wealth by
₹5,129.91. The contract gap is the missing `contributionLots` and
`lotDispositionMethod`: a late monthly lot cannot inherit the first lot's
holding period or tax basis.

## Acceptance matrix

| Fixture | Required assertion | Contract gap detected |
| --- | --- | --- |
| A | Disposal ledger ₹27,40,505.90; haircut shortcut must not substitute | Disposal event versus recurring haircut |
| B | Six actual rows; interest ₹35,290.20; benefit ₹11,010.54 | Full-year opening-balance proxy |
| C | Zero versus ₹25,508.93 benefit with unchanged schedule | Boolean claim versus numeric headroom |
| D | Separate FY rows and receipt dates; benefit ₹7,488.00 | 31 March boundary and capacity partition |
| E | Delayed receipt ends ₹781.26 lower under reinvestment | Missing tax-benefit timing |
| F | Missing classification is `unsupported` | Guessed instrument treatment |
| G | Equal-budget investment ends ₹1,13,803.32; fee omission is ₹2,231.44 | Unequal route budgets and undated fees |
| H | Twelve dated lots net ₹1,25,864.96; single-lot shortcut overstates by ₹5,129.91 | Holding periods and lot disposition |

These figures are reference expectations for the reviewed model. They do not
establish tax eligibility, a legal rate, a filing position, or an investment
recommendation.

## Fixture H2: separate illustrative tax factors for different lot ages

This is a synthetic rule-engine fixture, not a statement of Indian tax law. Declare a test-only rule: a lot held longer than 12 months uses a 12.5% gain factor; all other lots use 20%. Both lots grow at 10% nominal annual return compounded monthly and are fully disposed on 2028-01-01, with no exemption, expense or loss offset.

| Acquisition date | Contribution | Months held | Gain before rounding | Applied factor | Net proceeds |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-01-01 | ₹10,000 | 24 | ₹2,203.9096137556 | 12.5% | ₹11,928.42 |
| 2027-12-01 | ₹10,000 | 1 | ₹83.3333333333 | 20% | ₹10,066.67 |

Total tax is ₹292.1553683861 and net proceeds are **₹21,995.09**. Applying the older lot's 12.5% factor to both lots incorrectly produces ₹22,001.34, an overstatement of ₹6.25. Compute each lot using its own acquisition date before aggregation. Exact 12-month boundary handling needs a separate fixture under the eventually reviewed rule.

## Fixture I: conserve the same cash at every route date

Independent integration oracle, using zero loan interest, zero investment return and zero tax solely to isolate funding arithmetic. Anchor 2026-01-01; payments 2026-02-01 and 2026-03-01. Loan principal ₹1,00,000, regular monthly cash budget ₹50,000, surplus ₹60,000 and explicitly supplied prepayment fee ₹2,000. The common initial budget is ₹62,000; each route receives another ₹50,000 on each payment date. The fee is an illustrative input, not a statement that this loan legally permits it.

| Route | Initial principal / fee / investment | February payment / investment | March payment / investment | Terminal investment |
| --- | --- | --- | --- | ---: |
| Keep loan and invest | ₹0 / ₹0 / ₹62,000 | ₹50,000 / ₹0 | ₹50,000 / ₹0 | ₹62,000 |
| Prepay, reduce tenure | ₹60,000 / ₹2,000 / ₹0 | ₹40,000 / ₹10,000 | ₹0 / ₹50,000 | ₹60,000 |
| Prepay, reduce EMI | ₹60,000 / ₹2,000 / ₹0 | ₹20,000 / ₹30,000 | ₹20,000 / ₹30,000 | ₹60,000 |

Every route receives exactly ₹1,62,000 externally and ends with zero loan balance. The ₹2,000 terminal difference is exactly the prepayment fee. The final shortened instalment releases ₹10,000 on its actual date, not one month later. After payoff, continue the original monthly budget through the common horizon.

Excess-surplus variant: change surplus to ₹1,20,000 while retaining the explicitly supplied ₹2,000 fee. Common initial cash is ₹1,22,000. Immediate foreclosure spends ₹1,00,000 principal and ₹2,000 fee, leaving ₹20,000 invested on the anchor date. Add two ₹50,000 contributions: terminal investment ₹1,20,000, versus ₹1,22,000 for keeping the loan. Both routes receive ₹2,22,000 externally. A loan with no remaining balance must not erase the subsequent contributions.

Integration invariants: each dated budget equals loan principal plus interest plus fees plus investment contribution or retained cash. Reject an instalment exceeding the available monthly budget instead of clipping a negative contribution to zero. Tax benefits are separate, dated internal receipts: retain or reinvest them once according to the declared choice, never count them as new external funding. Benefits arriving after the comparison horizon cannot be included as cash already received; report them separately.

On 17 September root reviewed the implemented route allocator and three-scenario composer. Funding's seven focused tests and the composer's six tests passed; a separate three-test integration suite composes schedules, funding, growth and disposal tax against these figures. This proves the local arithmetic examples, not app integration or a reviewed tax policy. The remaining benefit-receipt valuation rules are being integrated separately.

## Fixture F2: ordinary interest settled at each explicit credit

Synthetic arithmetic convention only: invest ₹1,00,000 on 2026-04-01; credit 7% on 2027-04-01 and again on 2028-04-01; settle a supplied 31.2% tax factor from each interest credit. This does not assert a bank's contractual schedule, TDS rate or legal payment date.

| Credit date | Opening invested balance | Gross interest | Tax | Net interest reinvested | Closing invested balance |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2027-04-01 | ₹1,00,000 | ₹7,000 | ₹2,184 | ₹4,816 | ₹1,04,816 |
| 2028-04-01 | ₹1,04,816 | ₹7,337.12 | ₹2,289.18144 | ₹5,047.93856 | ₹1,09,863.93856 |

If both net credits are retained as cash, invested principal stays ₹1,00,000 and retained cash totals ₹9,632. A different scenario that compounds gross interest and settles all tax only at maturity yields ₹1,09,969.12, which is ₹105.18144 more than settlement at each credit. The model must preserve the selected timing and disposition rather than reuse the maturity figure for both.

Root calculated these numbers independently with PowerShell arithmetic on 17 September, before the accrual module was implemented. Every factor and date above is an explicit fixture assumption; production support still requires a reviewed policy adapter.

Root arithmetic spot-check on 17 September used PowerShell Math.Pow independently of application code. Fixtures A, E and H matched their displayed expected values within ₹0.01. H2 was independently computed in the same pass. The E horizon is clarified to 2027-12-31 so 12 and 6 month-end periods are exact; no one-day accrual is silently dropped. Other fixture rows still require engine-to-oracle comparison and methodology review before release.

A second root arithmetic pass independently amortized fixtures B/C/D using the reducing-balance EMI formula and a payment-by-payment loop. Interest totals were ₹35,290.2002652886, ₹1,32,370.9282802010 and ₹30,497.4164119516 respectively. C's last-period interest was ₹1,759.3819540266; D's first-period interest was ₹5,000. These match the fixture totals and tax-year split amounts within ₹0.01. This verifies arithmetic, not legal eligibility, payment-date conventions or production integration.

## Fixture J: annual assessment rounding before a route delta

Synthetic ordinary-income arithmetic, resident under 60, old regime, tax year 2026-27. This asserts no real home-loan deduction eligibility. Baseline taxable income before section 516 rounding is Rs 500,005; a supplied eligible route deduction is Rs 1 and ordinary investment income is zero.

- Baseline income rounds to Rs 500,010. Slab tax is Rs 12,502. With no rebate at that income, 4% cess gives Rs 13,002.08, then the payable amount rounds to Rs 13,000.
- With the deduction, Rs 500,004 rounds to Rs 500,000; the old-regime rebate removes the computed tax. Payable is zero.
- The difference between consistently rounded assessments is therefore Rs 13,000. Calculating the raw delta first (Rs 0.208) and then rounding it would incorrectly give zero.

A second boundary check uses the new regime: Rs 1,200,004.99 rounds to Rs 1,200,000 and payable zero; Rs 1,200,005 rounds to Rs 1,200,010, whose marginal-relief result plus cess is Rs 10.40 and payable rounds to Rs 10.

These reference calculations expose a rounding-order defect; they do not establish a complete tax model or financial-methodology approval. Primary rounding source and scope are recorded in prepay-tax-model-contract.md. Local arithmetic acceptance: the annual delta/rounding suite passed 13 tests, included in root verification of 42 focused tests and typecheck at 14:51 on 17 September. Statutory and raw-mode results are tested separately; full-model review remains open.

## Fixture K: two interest credits cross an ordinary-income slab

Synthetic TY2026-27 new-regime resident, explicit zero other special/agricultural income and losses, no route deduction. Background taxable ordinary income Rs 1,590,000; initial investment Rs 1,000,000. Two supplied 1% credit intervals end within that same tax year. These interval rates and immediate tax settlement are scenario inputs, not a bank product or TDS rule.

Raw mode, reinvest net interest:

- Baseline tax including cess: Rs 123,240.
- First gross credit Rs 10,000 increases annual taxable income to Rs 1,600,000. Annual tax rises to Rs 124,800; charge Rs 1,560. Balance becomes Rs 1,008,440.
- Second gross credit Rs 10,084.40 increases cumulative interest to Rs 20,084.40. Annual tax is Rs 126,897.5552, so the second incremental charge is Rs 2,097.5552 (subtract the prior annual tax cost of Rs 1,560).
- Final invested balance: Rs 1,016,426.8448. Total interest Rs 20,084.40; total tax Rs 3,657.5552. The original 15.6% marginal factor must not apply to the entire second credit.

Retaining net interest instead gives two gross credits of Rs 10,000, tax charges Rs 1,560 and Rs 2,080, principal Rs 1,000,000 and retained cash Rs 16,360.

Under section-516 mode, the reinvested second cumulative annual income rounds to Rs 1,610,080 and final annual tax rounds to Rs 126,900. Total investment tax cost is Rs 3,660; second tax charge Rs 2,100; terminal balance Rs 1,016,424.40. Do not round each gross-interest credit to tax-return rupees.

Local arithmetic acceptance: parent inspected the per-credit raw, retained-cash and statutory assertions, then passed 55 tests in the annual/accrual/adapter/contract suite at 15:15 on 17 September. The positive-deduction case also proves that the audit benefit is not injected into investment assets. Tax-payment timing, future-year policy, app integration and financial-methodology approval remain open.

## Fixture L: one loan schedule, annual interest tax and dated deduction receipt

Synthetic arithmetic only. Anchor2026-04-01; principal100000, monthly loan rate1%, one payment101000 on2026-05-01, horizon2026-06-01. Initial external budget10000 and monthly external budget101000. The loan clears in May; June's101000 budget becomes a horizon contribution without growth. Total external funding212000 = loan cash101000 + investment contributions111000.

Two supplied investment credit intervals, April-to-May and May-to-June, each earn1% gross and reinvest net interest. Resident/new/raw TY2026-27 background taxable ordinary income2000000, explicit zero special/agricultural income/losses. A synthetic reviewed-eligibility input allows the actual1000 interest deduction, producing208 of annual tax saving. This fixture does not assert that a particular property qualifies under the new regime. All investment income remains in the20% bracket after that deduction, plus4% cess.

| Benefit receipt treatment | Invested assets at June1 | Retained benefit cash | Total assets | Future receipt |
| --- | ---: | ---: | ---: | ---: |
|208 received May1 and reinvested |111368.674624 |0 |111368.674624 |0 |
|208 received May1 and retained |111159.027264 |208 |111367.027264 |0 |
|208 received July1 |111159.027264 |0 |111159.027264 |208 |

First gross interest100, tax20.8, closing10079.2. With May reinvestment, the next base is10287.2: gross102.872, tax21.397376 and net81.474624. Add the101000 June contribution only after that credit. Reinvested benefit adds1.64736 more terminal assets than retaining it, reflecting one interval of net growth. Debt is zero. The annual benefit and investment tax are distinct signed effects, each applied once.

Parent computed these values independently using PowerShell arithmetic on17 September before the accrual-route tests. Parent arithmetic integration review passed 40 tests across the route, interest, deduction and funding suites at 15:57 on 17 September. The seven route tests cover retained/reinvested/future receipts, negative net position, cash conservation, horizon deposits, off-grid receipts and aggregate asset bounds. This is local arithmetic evidence; product integration and methodology approval remain open. Credit/tax settlement and benefit-receipt dates are explicit scenario assumptions, not bank/TDS/refund timing claims.
