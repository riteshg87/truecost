# Annual ordinary-income tax rule inventory for prepay deltas

**Checked:** 17 September 2026  
**Scope:** source inventory for methodology review; no tax advice, legal sign-off,
or production constants  
**Target case:** resident individual, tax year 2026-27, Income-tax Act, 2025 as
amended by Finance Act, 2026

This note identifies the inputs needed to replace a fixed marginal factor with
an annual tax delta. It records what the cited primary sources say and keeps
historical and future periods outside the verified target unless stated.

## Primary sources and verified scope

| Rule | Verified source and location | Scope read from source |
| --- | --- | --- |
| Default new-regime slabs | [Income-tax Act, 2025 as amended by Finance Act, 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), section 202(1), PDF pp. 263-264 | Tax year 2026-27; default rates for an individual, HUF, AOP (other than co-operative society), BOI, or specified AJP |
| New-regime exclusions and option | Same Act PDF, section 202(2)-(4), pp. 264-265 | Section 202(1) computation excludes listed exemptions/deductions and some loss set-offs; section 202(4) describes the option path |
| Resident rebate and marginal relief | Same Act PDF, section 156(1)-(3), pp. 215-216 | Resident individual; ₹5 lakh rule in sub-section (1), and section 202(1) rebate/marginal-relief rule in sub-section (2) |
| Special-rate income and rebate base | Same Act PDF, section 198(7), PDF p. 259 | For qualifying section 198 long-term capital gain, section 156 rebate is allowed from income-tax on total income after reducing tax payable on that gain |
| Enacted old-regime ordinary rates | [Finance Act 2026, official Gazette PDF](https://www.incometaxindia.gov.in/documents/d/guest/finance-act-2026-pdf-1), First Schedule Part I-B, Paragraph A, pp. 83-84 | Tax year beginning 1 April 2026; age bands are under 60, resident 60-79, and resident 80+ |
| Enacted surcharge, capital-gain cap, marginal relief, cess | Same Finance Act 2026 Gazette PDF, section 3(1), (4)-(5), (15), First Schedule Part I-B Paragraph F, pp. 8-9, 12-15, and 85-87 | Tax year beginning 1 April 2026; section 202 surcharge thresholds and 25% ordinary-income ceiling, 15% cap on sections 196-198 component tax, surcharge marginal-relief formulas, and 4% cess |
| Explanatory corroboration only | [Finance Act 2026 memorandum](https://www.incometaxindia.gov.in/documents/81799/11848482/memo-2026.pdf), Part I-B, pp. 8-10 and Part I-A pp. 4-6 | Explanatory source that describes the rates; it is not the controlling enacted text |
| Official explanatory overview | [Computation of tax for individual](https://www.incometaxindia.gov.in/w/computation-of-tax-for-individual-1) | Confirms the annual-rate, regime, rebate, and 4% cess concepts; the Act and enacted Finance Act remain the controlling primary text |

The enacted Finance Act 2026 Gazette is the controlling source for the
2026-27 First Schedule rates, surcharge, marginal-relief formulas, and cess.
The memorandum is retained only as explanatory corroboration. These figures
are not a forecast for 2027-28 or later years.

## Verified rate rules for tax year 2026-27

### Default new regime: section 202(1)

For total income in the section 202(1) computation, the slabs are:

| Total income band | Rate |
| ---: | ---: |
| Up to ₹4,00,000 | 0% |
| ₹4,00,001-₹8,00,000 | 5% |
| ₹8,00,001-₹12,00,000 | 10% |
| ₹12,00,001-₹16,00,000 | 15% |
| ₹16,00,001-₹20,00,000 | 20% |
| ₹20,00,001-₹24,00,000 | 25% |
| Above ₹24,00,000 | 30% |

These are progressive bands. A tax delta must calculate tax on the complete
annual total income before and after the proposed deduction, rather than
multiplying the deduction by the highest visible band or a user-facing slab
label. Section 202(2) also identifies deductions and loss set-offs excluded in
the default calculation, so a deduction cannot be assumed eligible merely
because the caller supplies an amount.

### Old regime: Part I-B ordinary rates

The enacted First Schedule Part I-B, Paragraph A, lists these ordinary rates
for the tax year beginning 1 April 2026:

| Person | Nil band | 5% band | 20% band | 30% band |
| --- | ---: | ---: | ---: | ---: |
| Individual other than the resident age bands below | Up to ₹2,50,000 | ₹2,50,001-₹5,00,000 | ₹5,00,001-₹10,00,000 | Above ₹10,00,000 |
| Resident individual age 60 to under 80 | Up to ₹3,00,000 | ₹3,00,001-₹5,00,000 | ₹5,00,001-₹10,00,000 | Above ₹10,00,000 |
| Resident individual age 80 or more | Up to ₹5,00,000 | None | ₹5,00,001-₹10,00,000 | Above ₹10,00,000 |

The age test is “at any time during the tax year” in the enacted Part I-B
text. The model therefore needs date of birth or a reviewed age-band input and
residency status when the old regime is selected. A generic “30% slab” is not
enough to identify an annual tax delta.

## Rebate, marginal relief, surcharge, and cess

- **Section 156(1):** a resident individual whose total income does not exceed
  ₹5,00,000 receives a rebate equal to 100% of income-tax or ₹12,500,
  whichever is lower.
- **Section 156(2):** where the resident individual is taxed under section
  202(1), total income up to ₹12,00,000 receives a rebate equal to 100% of tax
  or ₹60,000, whichever is lower. Above ₹12,00,000, where tax exceeds the
  income excess over ₹12,00,000, the rebate is the excess of tax over that
  income excess. Section 156(3) limits this rebate to the section 202(1) tax.
  This is the statutory marginal-relief shape for the new-regime threshold;
  it must be applied after the annual tax comparison, not as a fixed factor on
  one deduction.
- **Special-rate income:** section 198(7) says the section 156 rebate is allowed
  from income-tax on total income after reducing tax payable on qualifying
  section 198 long-term capital gain. The annual model must keep ordinary
  income and each special-rate component separate, and must not rebate
  special-rate tax by accident. Other special-rate components need their own
  section-specific treatment.
- **Surcharge for the selected regime:** Finance Act 2026 section 3(4), Table
  1, item 10, gives section 202 (default/new-regime) individuals 10% when total
  income exceeds ₹50 lakh up to ₹1 crore, 15% above ₹1 crore up to ₹2 crore,
  25% above ₹2 crore when sections 196-198 income is excluded from the
  threshold test, and otherwise 15% above ₹2 crore. Thus the ordinary-income
  section 202 ceiling is 25%; the Part I-B Paragraph F table is the option
  path under section 202(4), where ordinary income can reach 37% above ₹5 crore.
  Section 3(5), Table 2, supplies separate section 202 marginal-relief bands
  through the >₹2 crore range.
- **Capital-gain surcharge cap:** for income including dividend or capital
  gains under sections 196, 197, or 198, surcharge on the income-tax computed
  for that part cannot exceed 15%. The tax engine needs a component split to
  apply the cap; it cannot apply one surcharge percentage to total tax.
- **Health and Education Cess:** Finance Act 2026 section 3(15) adds 4% of
  income-tax plus surcharge. The statutory marginal-relief formulas cap the
  income-tax-plus-surcharge amount before this addition, so the annual
  calculation should apply cess after rebate, surcharge, and marginal relief.

## Small review examples

These are arithmetic checks of the source rules, not taxpayer advice.

1. **New-regime rebate threshold:** ordinary total income of ₹12,00,000 gives
   slab tax ₹60,000 before rebate, then section 156(2) reduces it to zero. At
   ₹12,01,000, slab tax is ₹60,150; the marginal-relief rebate is ₹59,150,
   leaving ₹1,000 before 4% cess, or ₹1,040 after cess when no surcharge or
   special-rate component is present.
2. **Old-regime age band:** for a resident under 60 with ordinary income of
   ₹10,00,000, slab tax is ₹1,12,500 before cess and ₹1,17,000 after 4% cess,
   assuming no surcharge, rebate, or other deduction. At exactly ₹5,00,000,
   the ₹12,500 section 156(1) rebate removes the computed tax before cess.
3. **Delta test:** a ₹1,00,000 eligible deduction must be run through the
   complete annual tax function in both states. A deduction crossing ₹12 lakh
   under section 202(1) can change rebate/marginal relief, so `deduction ×
   31.2%` is not an equivalent annual result. The fixture must include total
   income, ordinary/special components, regime, residency, age where relevant,
   and every deduction that competes for the same capacity.
4. **Surcharge boundary:** a total income of ₹50,00,001 enters the 10%
   surcharge band in the enacted Part I-B Paragraph F table. A test with a
   separately identified section 198 capital-gain component must cap surcharge
   on that component's tax at 15% and test marginal relief around the threshold.

## Required normalized inputs before implementation

The annual tax function needs, per tax year:

- tax year and Act version, with event dates mapped to the tax-year boundary;
- resident status and, for old-regime age bands, age during the tax year;
- regime and any reviewed option state under section 202(4);
- ordinary income components and their allowable deductions, including the
  proposed loan deduction;
- each special-rate income component and the section/rule producing its tax;
- deduction eligibility facts and remaining capacity, with no inferred caps;
- surcharge base and component attribution, including dividend/capital-gain
  amounts subject to the 15% cap;
- rebate eligibility, tax before rebate, and marginal-relief calculation state;
- cess application and the selected source version.

The prepay ledger can supply an actual dated interest or principal amount, but
it cannot supply these taxpayer-level facts. Until an adapter provides them,
the tax-dependent delta should remain `unsupported`; the pre-tax dated loan
schedule remains available.

## Historical and future boundary

The verified target is tax year 2026-27 under the Income-tax Act, 2025 as
amended by Finance Act, 2026. Periods before 1 April 2026 continue to require
the applicable Income-tax Act, 1961 and Finance Act source snapshot; this note
does not back-port section numbers or rates. Tax years after 2026-27 require a
later Finance Act/source refresh. No future rate, threshold, or rule is inferred
from this inventory.

## Open methodology inputs

The owner and finance reviewer still need to choose and version the following:

1. Which resident individual fact set and source evidence is sufficient for
   the first support scope.
2. Whether the annual tax delta accepts a reviewed tax-function snapshot or
   asks for all income components and deductions directly.
3. How loan-benefit receipt dates, TDS, advance tax, and final return refunds
   are represented in the dated cash-flow ledger.
4. Which special-rate asset events are in scope and how their tax is separated
   before rebate and surcharge.
5. How losses, carry-forwards, AMT, rebates other than section 156, and joint
   ownership are suppressed or modeled.

These are implementation gates, not decisions made by this source inventory.
