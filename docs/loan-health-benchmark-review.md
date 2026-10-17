# Loan health benchmark review

Status: historical reproduction with subsequent implementation progress, 16 September 2026. Current setup preserves missing spread/reset values as unknown and analysis requests confirmation. Benchmark coverage, freshness policy and methodology approval remain open.

## Current-rate evidence

The [RBI official homepage](https://www.rbi.org.in/home.aspx), inspected on 16 September 2026, lists the policy repo rate as 5.25%. This supports the current value in `lib/health/repo.ts`; it does not establish every historical effective date or an ongoing update process.

## Historical pre-fix arithmetic discrepancy

`app/loan/setup/page.tsx` infers an absent spread using `ratePct - 5.75` and saves that value as if supplied. `lib/health/analyse.ts` then compares the loan against `repoOn(today) + spreadPct`, currently using 5.25.

For an 8.50% entered rate and blank spread, setup saves 2.75%. Analysis therefore expects 8.00% and reports a 0.50 percentage-point gap. The code has created this gap from two different benchmark constants, without evidence of the borrower's contractual spread. Merely replacing 5.75 with today's rate would conceal missing information and would not establish a historical contractual spread.

The form also substitutes today's date when the reset date is blank. That turns an unknown reset date into an asserted fact.

## Original implementation requirements and remaining acceptance

Preserve an explicit unknown spread/reset state through the form, validated loan contract, local cache and Convex storage. Do not silently assign a benchmark-derived spread or today's reset date. Keep ordinary balance, EMI, prepayment and transfer functionality available. Rate-health findings that depend on missing information must explain what is needed instead of claiming a missed reset.

Distinguish genuine zero spread from unknown. Existing inferred records cannot be identified reliably from their number alone; request confirmation before treating legacy spread data as contractual evidence. Design that compatibility treatment before changing the persisted schema.

Add dated source metadata and a freshness policy to the benchmark. Verify historical entries from primary RBI publications and show the observation date in the UI. Rajesh and Ritesh remain the named methodology owners; this source check is not their approval or a completed FIN-04 gate.

Acceptance includes blank spread, explicit zero spread, missing/future reset, legacy records, source expiry, and unchanged deterministic comparison/prepayment fixtures. A regression fixture must cover the 8.50% example above through the actual save and analysis path.

## Upgrade compatibility finding: 16 September implementation review

The in-progress parser normalizes absent provenance fields into legacy/unknown values and the canonical serializer includes them. This changes the canonical bytes for an older saved payload. In lib/private-storage/storage.ts, outbox validation requires canonical bytes to equal the stored payloadJson and verifies its existing hash. In convex/savedLoans.ts, receipt replay compares the canonical payload hash after parsing. Consequently, an additive field change alone can reject an old queued partition or a legitimate retry after a lost acknowledgement.

Acceptance now explicitly requires fixtures created with the pre-change canonical representation: reopen a queued private partition, then replay an already-acknowledged request against its old receipt. Preserve exact request identity and reject changed payloads. Compatibility must cover both the local queue and server receipts; passing newly created fixtures does not establish upgrade safety. This finding has been returned to the implementation owner and remains unresolved until those tests pass.


### First compatibility handoff review

The worker reported 120 focused tests and a passing typecheck. Root found the serializer preserves old bytes only when both provenance values are legacy. A previously valid record with an empty reset date normalizes its missing provenance to unknown and still receives new fields. The existing storage fixture already permits that empty date. The added canonical assertion also compares two outputs of the new implementation, and existing replay tests create their receipt with the new code; neither proves pre-upgrade compatibility. Acceptance remains open pending frozen old-format queue and receipt fixtures for both blank and nonblank reset dates.


### Root recovery verification at 11:05

Root reviewed the frozen old JSON and directly seeded pre-change receipt/queue fixtures, then ran tests/private-storage.test.ts and tests/convex-saved-loans.test.ts: 38 tests passed. Missing provenance on an old blank reset is now legacy, preserving its canonical bytes; new blank inputs remain explicitly unknown. This closes the reviewed local queue/server receipt compatibility issue for these fixtures. The server checks use Convex's local test harness, not the deployed development backend.

A separate consumer gap remains: both Loan health screens still described every unknown verdict as an unsupported T-bill benchmark. The worker now owns wiring the new reason to these screens and adding mounted missing-input regressions. Historical source freshness and methodology approval remain open.


### Screen integration verified at 11:09

Root reviewed both unknown-result branches and reran tests/loan-ui.test.tsx: 19 tests passed. Repo-linked loans now use the missing/legacy evidence reason and expose an edit link; only actual T-bill loans receive the unsupported benchmark wording. This accepts the focused missing-input UI behavior locally. The overall FIN-04 gate remains open for benchmark freshness/history, integrated browser evidence and methodology-owner review.


## Current unresolved date-validity finding
Source reinspection on 16 September confirms rateVerdict still calls repoOn(lastReset) and repoOn(today) after calendar/provenance validation only. repoOn silently extends its first entry backward and latest entry forward. The sampled source evidence explicitly does not establish continuous coverage. Existing health tests expect September 2026 stale verdicts from that unbounded table; those expectations cannot prove source validity. Required next slice: a separate supported-date/freshness decision before benchmark-derived verdicts, with explicit unknown UI for unsupported dates, preserving ordinary EMI/prepay/transfer calculations. Production methodology approval remains open; do not infer it from tests.

