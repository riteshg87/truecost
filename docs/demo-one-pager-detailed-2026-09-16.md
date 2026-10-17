# TrueCost: compare the cost behind the rate

## The problem

An Indian borrower can receive two home-loan offers that look comparable by headline rate while amount, tenure, processing fee, GST, insurance and other charges change the cash flows. TrueCost puts those terms beside one another and shows estimated effective APR, EMI, cost per lakh and total borrowing cost.

The primary audience is an Indian borrower comparing two home loans, sometimes with weak connectivity. This remains a **PRD assumption**; interviews, survey results and usage data are not recorded.

## Why this problem was selected

The team’s supplied rationale records seven ideas and chooses Ritesh’s loan optimizer: refinance, prepay versus invest, and true-cost comparison. The alternatives and the team’s reasons are documented in the [supplied team artifact](https://claude.ai/artifact/FAivn4gFacJzzoE1DD2j5x).

- Amit: insurance-document NLP, with high accuracy/legal-trust demands and low repeat use.
- Amit: “Where to put things?” spatial lens, with unclear finance fit.
- Anoop: leftover-food distribution and stray-animal tracker, both with two-sided logistics and unclear economics.
- Mayank: food/unused-item sharing, with the same logistics challenge.
- Mittali: NRI banking, with heavy KYC/compliance and a narrow initial segment.
- Rajesh: PM Workbench for nontechnical-to-technical workflows, aimed at a different B2B buyer.

The team rationale says the loan problem is high stakes, computable through EMI, amortisation and total cost, useful again when rates or bonuses change, and open to expansion. These are **team hypotheses and selection reasons**, not validated market facts. The artifact does not establish interviews, traction, household coverage, competitor counts, market size, or savings outcomes.

## What the MVP demonstrates

The planned recording uses synthetic values: Guest bank A and Guest bank B, each ₹10,00,000 for 10 years, at 8.50% and 8.90%, with fresh-draft default fees. The local core flow is:

**Guest comparison → Results → email `Send code` / `Verify` → automatic save-intent return → `Saved to your account.` → `Saved comparisons` → `Saved result` → `Generate PDF` / `Download PDF`.**

The figures are estimates from entered terms, not lender quotes, approval, a guaranteed saving or financial advice. The full local browser flow passed on 16 September, including stored-figure parity and PDF download. A raw screen recording exists, and the 2 October local review produced 180.683-second narrated candidates; independent full-audio listening, deployed-link validation and final playback review remain open.

## Proposed success measures

Numeric targets, baseline, cohort and measurement window are **TBD**. The PRD proposes:

- **Guest completion:** completed guest drafts / started guest drafts.
- **Value-to-auth:** gated guests who authenticate / unique gated guests.
- **Intent recovery:** resumed actions / successful gated authentications.
- **Save success:** acknowledged `comparison_saved` requests / attempted save requests.
- **Report generation:** generated reports / requested report IDs; disk saves cannot be observed.
- **Guardrails:** zero cross-account access and zero blocked analytics fields.

These measures need an agreed owner and observation window before they become outcome claims.
