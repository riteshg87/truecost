# Finance date verification

TASK-017A covers the historical RBI policy-repo entry and reset-anniversary
arithmetic only. FIN-REVIEW-02/03 and FIN-BUG-05/06/07 remain open. This is
evidence for the corrected health calculation, not a finance methodology sign-
off or a claim that the static table is current.

## Reproduction before the correction

The independent finding in `docs/finance-review-findings.md` recorded these
outputs from the pre-change implementation:

| Input | Previous output | Defect |
| --- | ---: | --- |
| `repoOn("2025-06-06")` | `5.75` | This was the MSF/Bank Rate; the policy repo rate was `5.50%`. |
| Quarterly loan reset `2026-06-15`, checked `2026-09-16` | `resetOverdue=false` | The 3-month anniversary was `2026-09-15`; elapsed days were dropped by whole-month flooring. |
| Same loan, checked `2026-10-15` | `resetOverdue=true` | The old result became true one month late. |

## Source and table review

The Government of India Press Information Bureau's 6 June 2025 policy update
states that the policy repo rate was reduced to **5.50% with immediate effect**
and separately lists the MSF/Bank Rate as **5.75%**:
[PIB June 2025 Monetary Policy Update](https://www.pib.gov.in/PressNoteDetails.aspx?ModuleId=3&NoteId=154573&lang=2&reg=3).
The RBI circular independently records the same change from 6.00% to 5.50%
and distinguishes the SDF and MSF rates:
[RBI Liquidity Adjustment Facility circular](https://www.rbi.org.in/scripts/BS_CircularIndexDisplay.aspx?Id=12854).
The RBI weekly supplement also reports a 5.50% policy repo rate for the week
ending 6 June 2025:
[RBI Weekly Statistical Supplement](https://www.rbi.org.in/scripts/WSSView.aspx?Id=27727).

The supported table was checked at the available official boundaries. The
February and December rows remain inherited static entries because the primary
pages read for this task did not establish those exact effective dates; they
are recorded for review rather than presented as fully reverified:

| Effective date | Policy repo entry | Evidence |
| --- | ---: | --- |
| 2023-02-08 | 6.50% | [RBI February 2023 policy statement](https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=55178) |
| 2025-02-07 | 6.25% | Inherited entry; [RBI policy archive for the February 5-7, 2025 meeting](https://rbi.org.in/Scripts/Annualpolicy.aspx) confirms the meeting window, not the exact rate/date pair read here. |
| 2025-04-09 | 6.00% | [PIB April 2025 policy update](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2120509&lang=2&reg=48) |
| 2025-06-06 | 5.50% | [RBI June 2025 rate-change circular](https://www.rbi.org.in/scripts/BS_CircularIndexDisplay.aspx?Id=12854) |
| 2025-12-05 | 5.25% | Inherited entry; [PIB Economic Survey 2025-26 policy summary](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2220800&lang=1&reg=6) establishes 5.25% by December 2025, not the exact 5 December effective date. |

No entry was added beyond the existing table. The final `5.25%` entry remains a
static historical value and is not evidence of the current September 2026
policy rate. Full source verification of every inherited row remains open.

## Changed behavior

- `repoOn("2025-06-05")` returns `6.00`.
- `repoOn("2025-06-06")` and `repoOn("2025-06-07")` return `5.50`.
- `repoOn("2025-12-04")` returns `5.50`; `repoOn("2025-12-05")` returns `5.25`.
- Malformed benchmark dates throw rather than silently selecting a table row.
- Reset checks compare `today` with a clamped calendar-month anniversary. For
  a 15 June quarterly reset, 15 September is due but not overdue; 16 September
  is overdue. January 31 clamps to February 28 in a non-leap year and February
  29 in a leap year. The same rule applies to quarterly and half-year cycles.
- Malformed or future reset dates return the existing `kind: "unknown"` health
  verdict with null benchmark fields. The UI therefore avoids a stale-rate or
  overdue-reset claim when the date cannot support one.

## Verification

Environment: Windows, Node 24.14.0, Vitest 5.0.0. Focused command:
`npm test -- --run lib/health/__tests__/health.test.ts`.

- Health test file: **25/25 passed**.
- `npm run typecheck`: blocked by concurrent private-storage worker diagnostics
  in `lib/private-storage/storage.ts` (three return-shape errors); no health
  diagnostic was reported.
- Full build was intentionally not rerun; root owns the integrated build.

The tests cover the source-backed June boundary, adjacent rate transitions,
malformed dates, exact quarterly anniversary behavior, non-leap and leap-year
month ends, quarterly and half-year clamping, and unknown reset-date handling.
They do not establish lender-specific contractual schedules, rate freshness,
or the unrelated open finance findings.
