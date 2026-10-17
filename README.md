# TrueCost

A finance PWA for comparing the cost of loan offers in India. Calculations run
in the browser. This checkout is being prepared for a commercial pilot using
Clerk email codes and Convex account storage.

The comparison, Loan health and prepayment screens already exist. The Clerk
provider, owned saved-loan backend and public offline calculator have local
verification; the saved-loan backend also has two-account development-provider
evidence. Account-bound client storage, history, reports, feedback, Mixpanel and
release checks are still in progress. The old Supabase synchronization path has
been removed; Clerk and Convex are the only account and private-storage path.
Missing auth configuration leaves guest access available; demo codes cannot
grant membership.

The separate insurance flow is deferred. Loan-linked insurance premiums remain
part of the comparison. See the [roadmap](docs/product-roadmap.md) for current
task status and [financial findings](docs/finance-review-findings.md) for open
calculation concerns. The reference deployment does not include these unpushed
working changes.

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
npm run build
npm start -- --hostname localhost
npm test
npm run typecheck
```

The production build generates the public offline assets first. For a local
production check, use the `localhost` listen hostname: binding this Next.js
version with `--hostname 127.0.0.1` caused middleware self-proxy failures.
The same build returned successful sign-in, account and comparison pages after
switching the listen hostname; it remained bound to loopback on this machine.
See [runtime evidence](docs/evidence/local-production-headers-localhost.json)
and the related [Next.js issue](https://github.com/vercel/next.js/issues/94745).

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

The finance layer is pure and framework-free. Worked calculation scenarios are
covered by tests in `__tests__/scenarios.test.ts`; run with
`npx vitest run --reporter=verbose --disable-console-intercept` to see the
worked examples printed.

## Deliberate limits

- **Prepayment modelling uses explicit assumptions.** The prepayment flow
  compares tenure and EMI paths with fees, liquidity and post-tax investment
  returns. It does not model floating-rate resets or lender-specific schedules.
- **Fixed rates assumed.** No floating-rate reset is modelled, so a repo-linked
  home loan is priced at today's rate for the whole tenure.
- **Product type is per offer** (in each card's extras drawer) with a top-level
  picker that bulk-sets it, so comparing a gold loan against a personal loan
  works but is not the default path.
- **Regulatory and tax notes are general**, phrased to prompt a check against
  the sanction letter rather than to be relied on.

Financial-methodology and production privacy reviews remain release gates.
Development account actions contact Clerk and Convex; do not assume every
screen stores data only on this device. See the [launch checklist](docs/launch-checklist.md).
