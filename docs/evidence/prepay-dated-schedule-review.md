# Dated loan schedule: local review

17 September 2026. Dirty checkout at b9e53c00219f778294a904e9b3175a9bb5bb26c2. Luna implemented lib/prepay/cashflows.ts; Astra reviewed the actual source and corrected the final-payment tolerance floor and full-payoff principal arithmetic.

The primitive uses dates anchored to the original calendar day, separates immediate principal prepayment from scheduled principal, groups rows by Indian financial year and reports unpaid balances. It contains no tax rates, deduction eligibility or investment taxation. Existing prepayment UI and recommendation calculations do not use it yet.

Root verification: 29 tests passed across dates, cashflows and auth-error files before the final arithmetic correction. After that correction, all 11 cashflow tests passed. The independent six-month reference is ₹10,00,000 at 1% monthly interest with ₹35,290.2002653 total interest. Tests also cover month-end/leap dates, the March/April boundary, a smaller last payment, incomplete repayment, zero balance/rate, prepayment principal conservation, numeric bounds, a large interest-bearing schedule and genuine tiny residuals.

This proves the tested arithmetic foundation only. Full post-tax integration, policy eligibility, investment lot/tax timing, report parity and Rajesh/Ritesh methodology approval remain required. No production publishing or provider changes occurred.
