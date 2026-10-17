# TrueCost

A personal finance app for working out what a financial product actually costs
you. Mobile-first PWA, everything computed and stored on the device.

**Flow 1 — True cost comparison** is built. Flow 2 (insurance) is not started.

## Why it isn't a calculator

An EMI calculator answers "what is my instalment". This answers "which of these
offers is cheaper", which is a different and much easier question to get wrong:

- **Effective APR** is the IRR of the real cash flows — the money that reaches
  you at disbursal, then every EMI out. Fees and GST cut what you receive
  without cutting what you repay, so they raise the true rate above the quoted
  one. Solved with Newton-Raphson and a bisection fallback.
- **Flat rates are converted** to the reducing rate that produces the same EMI,
  by root-finding (no closed form exists). `8% flat` over 4 years is worse than
  `13.5% reducing` — the app shows that, a rate table does not.
- **Ranking refuses total interest** when amounts or tenures differ. A 20-year
  loan always shows more interest than a 10-year one even when it is the
  cheaper money, so those comparisons fall back to APR and cost per lakh.
- **Financed premiums accrue interest** for the full tenure and are priced that
  way, separately from premiums paid upfront.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm run start
npm test           # 32 tests over the finance layer
npm run typecheck
```

## Layout

```
lib/finance/
  core.ts         EMI, amortisation, flat -> reducing root-find
  xirr.ts         IRR solver, nominal and compounded annualisation
  compute.ts      Offer -> derived figures, per-offer warnings
  comparison.ts   Ranking and the common-basis rule
  validate.ts     Blocking errors vs non-blocking nudges
  loanTypes.ts    Per-product defaults, prepay and tax notes
  format.ts       Indian digit grouping, lakh/crore
  __tests__/      Unit tests + end-to-end scenarios
components/       Input primitives, offer card, results table, breakdown
app/              Landing, /compare, /compare/results
lib/store.tsx     State + localStorage persistence
```

The finance layer is pure and framework-free. Every claim the UI makes is
covered by a test in `__tests__/scenarios.test.ts`; run with
`npx vitest run --reporter=verbose --disable-console-intercept` to see the
worked examples printed.

## Deliberate limits

- **No prepayment modelling.** Marked optional in the spec and deferred. The
  types carry no prepay field yet; adding one means a second cash-flow builder,
  not a change to the solver.
- **Fixed rates assumed.** No floating-rate reset is modelled, so a repo-linked
  home loan is priced at today's rate for the whole tenure.
- **Product type is per offer** (in each card's extras drawer) with a top-level
  picker that bulk-sets it, so comparing a gold loan against a personal loan
  works but is not the default path.
- **Regulatory and tax notes are general**, phrased to prompt a check against
  the sanction letter rather than to be relied on.

Not financial advice. No product recommendations, no commissions, nothing
leaves the device.
