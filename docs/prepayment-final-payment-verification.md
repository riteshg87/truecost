# Prepayment final-payment verification

TASK-017B covers FIN-BUG-05 only: cash left from a partial final loan
instalment on the reduce-tenure path. Fees and tax are zero in the scoped
fixtures. FIN-BUG-06 (fee budget) and FIN-REVIEW-07 (tax model) remain open.

## Reproduction and correction

The independent reproduction used a ₹1,20,000 balance, 0% interest, 3 months,
and a ₹30,000 prepayment. The regular EMI is ₹40,000, and the actual payments
are ₹40,000, ₹40,000, and ₹10,000. The old engine invested only the full EMIs
after payoff and returned `terminalWealth=0`; the ₹30,000 unused in the final
month was omitted.

`runOff` now records its actual final payment. When the loan clears in month one
or later, the reduce-tenure result adds `max(0, EMI - finalPayment)` at that
payment month and compounds it for the remaining original horizon. A
month-zero foreclosure is excluded because all future EMIs are already in the
freed-EMI series. Existing fee, tax, EMI, and public result fields are
unchanged.

## Independent ledger evidence

The focused test file derives an end-of-month ledger separately from the
engine's runoff: it computes the regular EMI, amortises the post-prepayment
balance month by month, pays the actual amount due, and invests the unused part
of the fixed EMI budget. It compares that ledger with the engine output.

| Fixture | Expected behavior |
| --- | --- |
| ₹1,20,000, 0%, 3 months, ₹30,000 surplus | Final remainder ₹30,000 is retained; terminal wealth is ₹30,000 at zero return. |
| ₹1,00,000, 12%, 12 months, ₹90,000 surplus, 6% return | Clears in month 2 with a partial final payment; engine matches the independent ledger. |
| Zero prepayment | Regular schedule has no freed cash. |
| Immediate full payoff | Future EMI budget is invested from month 1; no month-zero final remainder is added. |
| ₹1,20,000, 0%, 3 months, ₹40,000 surplus | Pays two ₹40,000 instalments, then invests one full EMI at month 3; no extra remainder is created. |
| ₹1,00,000, 12%, 12 months, ₹99,000 surplus, 6% return | Clears in month 1; the partial final-payment remainder compounds through the remaining horizon. |
| ₹1,20,000 balance, ₹1,50,000 surplus, 6% return | Excess surplus compounds separately and matches the ledger. |

## Verification

Environment: Windows, Node 24.14.0, Vitest 5.0.0. Focused command:
`npm test -- --run lib/prepay/__tests__/prepay.test.ts lib/prepay/__tests__/final-payment.test.ts`.

- Focused prepayment tests: **35/35 passed across 2 files**.
- `npm run typecheck`: blocked by four concurrent private-storage test
  diagnostics in `tests/private-storage.test.ts`: three readonly `outbox`
  versus mutable `unknown[]` casts and one `StorageGuard` argument mismatch;
  no prepayment diagnostic appears.
- Full Next build was not rerun; root owns the integrated build.

This correction preserves the existing public API and only addresses the
missing final-payment remainder. It does not resolve how prepayment fees should
be funded in equal-budget comparisons, the tax assumptions, or any other open
financial finding.
