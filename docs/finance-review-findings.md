# Financial review findings

Initial source-backed review, 15 September 2026. TASK-017 and the financial release gate remain open. Rajesh and Ritesh own methodology review; this record is not their sign-off.

## FIN-BUG-01: June 2025 historical repo rate is incorrect

Status: corrected locally in TASK-017A; root reviewed the change and reran 25 passing health tests.

Before the correction, lib/health/repo.ts set the rate effective 6 June 2025 to 5.75%. A direct execution of repoOn('2025-06-06') returned 5.75. The Government of India's [6 June 2025 announcement](https://www.pib.gov.in/PressNoteDetails.aspx?ModuleId=3&NoteId=154573&lang=2&reg=3) gives the policy repo rate as 5.50%, with immediate effect. It separately gives the MSF/Bank Rate as 5.75%.

The earlier health tests expected 5.75 for September 2025 and repeated that value in rate-verdict fixtures. Their passing results did not validate the source data. The RBI's indexed [rate-change circular](https://www.rbi.org.in/scripts/BS_CircularIndexDisplay.aspx?Id=12854) corroborates the change; opening that RBI URL was unavailable through the research tool, so the directly read PIB announcement is the cited evidence.

The June entry is now 5.50%, with adjacent-date regression cases. See
[date verification](finance-date-verification.md). Some other exact table
boundaries remain inherited and unverified; this correction does not establish
today's policy rate.

## FIN-REVIEW-02: inferred spread uses a hard-coded benchmark

Status: original input defect corrected locally; complete financial release review remains open.

The earlier app/loan/setup/page.tsx inferred a missing spread as the entered rate minus 5.75 and stored it as an ordinary spread. Current setup preserves a missing spread as null with unknown provenance. Legacy values remain unconfirmed until the user re-enters them from loan documents; an unrelated save does not confirm them. The setup and benchmark-coverage changes are recorded in execution-log.md, including the root's 64 passing health, loan UI and loan-provider checks.

## FIN-REVIEW-03: freshness and unsupported dates

Status: unsupported-date guard corrected locally; verified continuous coverage and update process remain open.

The earlier repoOn selected the first entry before its effective date and carried the final entry forward indefinitely. Current lookup returns a rate only for a reviewed effective-date observation or explicitly sourced coverage interval. Three observations are recorded; the continuous-coverage list is empty. Other dates therefore return unknown, and unsupported current/reset dates suppress the benchmark verdict while preserving the other calculation tools. This prevents an unsupported present-day claim but does not supply a current benchmark feed.

These findings concern Loan health benchmark handling. They do not establish a defect in the independent offer-comparison EMI/APR calculations; those require their own financial fixtures and snapshot/report parity checks.

Source follow-up, 16 September: the [RBI February 2023 resolution](https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=55178) supports the 8 February change to 6.50% in its search-indexed primary text. The directly opened [December 2025 resolution](https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61749) supports the 5 December entry at 5.25%. These establish two change points; they do not establish continuous coverage or a future freshness window. The official February 2025 PDF was located but could not be read through the tool because its response requires a human check. That source verification remains open. See [source-check record](evidence/repo-rate-source-check.json). No additional benchmark code changed during this follow-up.

## FIN-BUG-04: reset timing drops elapsed days

Status: corrected locally in TASK-017A; exact-anniversary and month-end tests pass.

Before the correction, rateVerdict compared whole months with a strict greater-than check against the selected reset cycle. For a synthetic quarterly loan last reset on 15 June 2026, execution reported resetOverdue=false on 16 September and 14 October, becoming true only on 15 October. The three-month anniversary is 15 September; rounding months down lost the elapsed days after that anniversary.

The implementation now uses a clamped calendar-month anniversary. The due date
itself is not overdue; the following day is. Invalid or future reset dates
produce the existing unknown verdict. Month-end and leap-year cases are covered
in [date verification](finance-date-verification.md). The difference between a
scheduled reset and the last numerical rate change still needs methodology
review; this is not a conclusion about a lender's legal obligation.

## Independent offer-calculation check

Status: passed for the nine cases below; TASK-017 remains open.

Root compared the actual computeOffer implementation at b9e53c00219f778294a904e9b3175a9bb5bb26c2, with unrelated auth/backend/document working changes, against a separate Python Decimal calculation using 60-digit precision. The reference uses the annuity payment formula and 220 iterations of monthly discounted-cash-flow bisection. APR follows the engine's monthly nominal convention, monthly rate multiplied by 1,200; this check does not establish a regulatory APR convention.

Cases: fee-free reducing balance, percentage processing fee, flat processing fee plus another charge, financed insurance, upfront insurance, zero interest, one-month term, flat-rate mathematics and invalid net cash received. Flat-rate mathematics is a calculation fixture, not a newly enabled launch feature.

All 63 assertions passed across EMI, total repayment, total interest, upfront fees, cash received, borrowing cost and APR. Tolerances were ₹0.01 for money and 0.01 percentage point for APR. The largest observed differences were 0.000000003726 rupees and 0.000000000000109 percentage point respectively. Invalid net cash returned no APR as expected.

Evidence: [independent inputs and reference values](evidence/finance-decimal-reference.json), [observed engine values and assertions](evidence/finance-decimal-observed.json). No finance implementation changed during this check. Transfer, prepayment, payment rounding, snapshot/report parity, the benchmark findings above and human methodology approval remain unverified.

## FIN-BUG-05: prepayment drops cash freed in the final payment month

Status: corrected locally in TASK-017B; root reviewed the change and independently passed 35 focused prepayment tests.

With a synthetic ₹1,20,000 balance, zero interest, three remaining months and ₹30,000 prepaid, the earlier engine calculated a ₹40,000 EMI and subsequent payments of ₹40,000, ₹40,000 and ₹10,000. Under its stated equal-monthly-budget comparison, the remaining ₹30,000 in the last month belongs in terminal wealth. It returned zero because it invested only complete EMIs after the payoff month. The same omission affected partial final instalments at positive rates.

The correction retains and compounds that unused amount from the payoff month to the common horizon. Month-zero payoff excludes the extra remainder to avoid double counting. Independent monthly cash ledgers cover zero interest, positive-rate partial payments, month-one and immediate payoff, an exact EMI payoff, and excess surplus. See [reproduction](evidence/prepay-arithmetic-reproduction.json) and [verification](prepayment-final-payment-verification.md). Fee and tax findings below remain open.

## FIN-BUG-06: prepayment fees do not affect terminal wealth

Status: corrected locally under DEC-013; focused prepayment tests pass 39/39, including independent zero-tax ledger fixtures. Rendered verification and financial-methodology approval remain open.

For a synthetic ₹10,00,000 fixed loan at 10%, 24 remaining months and ₹1,00,000 surplus, adding ₹15,000 of fees changes total outflow but leaves both prepayment terminal-wealth figures identical. The recommendation compares those unchanged wealth figures. Its feeDecisive branch reruns the same calculation without fees, so a fee cannot change that branch's outcome.

The user selected an equal additional fee budget for every option: initial cash is surplus plus applicable fees. Investing now receives that full amount; prepayment spends the fee and applies the entered surplus, preserving excess cash above the balance. Baseline idle cash and fee-specific UI copy follow the same budget. A fee-driven wealth reversal preserves the liquidity gate and investment risk margin rather than forcing an investment recommendation. [Original reproduction](evidence/prepay-arithmetic-reproduction.json) and [independent expected ledgers](evidence/prepay-fee-budget-reference.json) use zero tax; they do not validate the app's tax assumptions.

## FIN-REVIEW-07: tax estimates exceed the implemented model

Status: source concern, independent scenarios and methodology review pending.

The prepayment engine applies an annual tax reduction to investment returns, even for gains described as taxed on disposal. Its terminal-wealth calculations do not model the loan deductions selected by the user. loanTaxBreakdown estimates a full year's interest from the opening balance without the remaining term, and the recommendation uses average loan tax cost rather than the change in deductions caused by this prepayment. These distinctions can change the comparison when deduction caps bind or the loan ends within a year.

The equity branch also uses the base 12.5% figure without cess, while the directly read [Income Tax Department guide](https://www.incometaxindia.gov.in/w/schedule_112_a) describes qualifying gains above the annual threshold as subject to surcharge and cess as applicable. Review eligibility, holding periods, realization timing, remaining deduction capacity and the annual loan schedules before claiming a complete post-tax comparison. Keep unresolved assumptions visible and suppress unsupported recommendations as required by PRD FR-17; a disclaimer alone does not validate the figures.

## FIN-COPY-08: similar APRs do not establish equal rupee costs

Status: source copy corrected locally; rendered verification remains pending.

The results page described an APR difference below 0.05 percentage points as
smaller than rounding on one EMI, and called the offers effectively equal in
cost. That does not follow from the threshold. A separate 50-digit Decimal
annuity calculation for a fee-free ₹10,00,000 loan over 240 months at 10% versus
10.04% gives a ₹26.52 monthly payment difference and ₹6,364.02 across the
scheduled payments. These figures use unrounded instalments internally.

The copy now says the two leading offers have similar APRs and asks users to
compare total borrowing costs and fees alongside other terms. The threshold,
ranking and finance calculations are unchanged. It applies to the leading pair,
so a third offer is not incorrectly described as similar too.
