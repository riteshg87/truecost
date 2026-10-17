# Home-loan eligibility source map

**Scope:** enacted Income-tax Act, 2025 as amended by Finance Act, 2026, for
Tax Year 2026-27. Later-year projection rules remain a separate unresolved decision. Checked 17
September 2026. This is source mapping, not tax advice or an eligibility decision.

The official transition FAQ says the 2025 Act applies from 1 April 2026, while
income for 1 April 2025–31 March 2026 remains under the 1961 Act. Therefore a
payment schedule crossing 31 March must carry its tax-year and Act version; an
old section number must not be silently applied to TY2026-27.

| Rule and source | What is explicit | Inputs TrueCost needs / current gap |
| --- | --- | --- |
| House-property income and use: [ITA 2025 §§20–21, pp.51–52](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | Annual value is chargeable under house property. A house occupied for the owner's residence has nil annual value under §21(6); §21(7)(a) limits that treatment to two houses, and §21(7)(b) removes it if actually let or another benefit is derived during the tax year. | `propertyUse` is present, but the model lacks property count, occupation/letting dates, annual-value facts and ownership/beneficial-use evidence. `let_out` must not be treated as the self-occupied rule. |
| Interest and pre-construction interest: [ITA 2025 §22(1), (2) and (4), pp.52–53](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | The ordinary/old-regime path allows interest on borrowed capital for acquisition, construction, repair, renewal or reconstruction under §22(1)(b). Pre-acquisition/construction interest is spread over five equal instalments under §22(1)(c). For §21(6) property, the combined deduction is ₹2,00,000 when acquisition/construction is completed within five years from the end of the borrowing tax year and a lender certificate is furnished; otherwise it is ₹30,000. §22(5) caps such properties at ₹2,00,000 in aggregate. | Need purpose, borrowing/acquisition/construction dates, completion, pre-construction allocation, lender certificate amount and other-claim offsets. Generic `propertyEligibilityFacts` does not require these. |
| Co-ownership: [ITA 2025 §24, p.54](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | Co-owners with definite and ascertainable shares are assessed separately according to their shares. Relief under §21(6) is provided as if each co-owner were individually entitled. | `ownershipShare` exists, but there is no co-owner identity, definite-share proof, borrower/repayment split, or lender certificate allocation. Joint ownership cannot be converted to a full single-owner claim by default. |
| Principal repayment and transfer conditions: [ITA 2025 §123 and Schedule XV ¶1(r), ¶3, ¶4 table, pp.182, 672–677](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | Chapter VIII §123 adopts Schedule XV. Paragraph 1(r) covers purchase/construction of a residential house whose income is or would be chargeable under house property. Paragraph 3 includes qualifying instalments, repayment to listed government, bank, insurance, housing-finance and other specified lenders, and transfer stamp duty/registration. It excludes repair/renovation after completion certificate, occupation or letting, and expenditure already deductible under §22. Paragraph 4 row 3 recaptures prior deductions if transferred before five years from the end of the possession tax year, or a covered sum is refunded. Section 123 caps the aggregate Schedule XV amount at ₹1,50,000; §122(2) limits Chapter VIII deductions to gross total income. | The adapter must version these caps and aggregate other Schedule XV claims: [ITA 2025 §§122–123, pp.181–184](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), corroborated by [Deductions](https://www.incometaxindia.gov.in/w/deductions). Need lender, borrower, payment date/amount, possession, completion certificate, transfer/refund events and other 80C usage. |
| New-regime restriction: [ITA 2025 §202(1)–(2), pp.263–265](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | §202(1) gives the new slabs. Under §202(2)(a)(v), self-occupied §22(1)(b) interest is excluded. §202(2)(a)(xii) excludes Chapter VIII except listed exceptions, so §123/Schedule XV principal and legacy Chapter VIII interest are unavailable in this computation. §202(2)(b)(ii) also bars setting a house-property loss against another head. | Regime is represented in the tax profile. The adapter must suppress self-occupied interest and principal in `new`; zero deduction does not prove eligibility. Let-out interest and loss carry-forward need a separate reviewed interpretation. |
| Legacy interest add-ons: [ITA 2025 §§130–131, pp.191–192](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf) | Sections 130/131 preserve narrow historical additional-interest deductions (old 80EE/80EEA windows), with sanction-date, property-value, ownership and lender conditions; §131 has a ₹1,50,000 limit. They are Chapter VIII and therefore excluded by §202(2)(a)(xii) in the new-regime computation. | Need sanction date, loan/property value, ownership on sanction date and lender classification before even considering a legacy claim. Do not infer these from `propertyUse` or a generic boolean. |

## Open review issues

1. The contract's `propertyEligibilityFacts: Record<string, unknown>` is only a
   container. A policy adapter needs typed, source-versioned facts and explicit
   unknown states for completion, possession, lender, purpose, ownership and
   other claims.
2. Current `remaining24bCapacityByTaxYear` and
   `remaining80cCapacityByTaxYear` can represent headroom, including zero, but
   do not establish that the underlying payment is eligible or that another
   person has not claimed it.
3. The enacted text supports separate §22 interest and Schedule XV repayment
   paths. It does not justify one generic “home-loan tax saving” factor. Annual
   tax assessment must receive the selected regime, ordinary/special income,
   loss and rebate context, and dated deductions together.
4. This map does not decide support for repair, let-out, pre-construction,
   joint/multiple loans, non-residents, or historical 80EE/80EEA claims. Those
   cases should remain explicit `unsupported` until an owner and reviewed
   allocation method supply the missing evidence.

## Primary transition source

[Official transition FAQ](https://www.incometaxindia.gov.in/documents/81799/11848482/FAQs-on-Interplay-and-Transition.pdf/05f80c1a-073c-a5d7-fb6f-55509242be53?doAsUserId=9rMQatnoqCcGNU9mEWvVNA%3D%3D&t=1774082865717), pp.4, 8–14, confirms the 1 April 2026 boundary and the savings treatment for earlier years. The FAQ is guidance; the enacted Act controls if wording differs.

## Parent source check

On17 September the parent independently retrieved the enacted PDF and checked section22 and section202. Section22 supports the interest caps, completion condition and lender certificate described above; section202(2)(a)(v)/(xii) supplies the cited new-regime restrictions. Corrected the nested subsection references in this map. Pre-construction interest needs explicit review: section22(1)(c) is a separate paragraph, while the displayed section202 restriction names22(1)(b). Do not infer its treatment from a generic self-occupied boolean. This spot-check does not approve joint ownership, loss allocation or future-year projections.
