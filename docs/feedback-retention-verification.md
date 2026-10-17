# Feedback retention verification

DEC-009 authorizes the 12-month implementation target. The cleanup uses twelve calendar months in UTC and clamps leap day to the prior February end. The internal mutation reads at most 100 submissions and 100 dismissals through createdAt indexes, removes eligible rows, and schedules another transaction when either batch is full. An hourly cron starts cleanup; actual removal can lag eligibility by the scheduling interval, backlog or provider outage.

Only feedback and dismissal rows are removed by this job. Comparisons, loans, users and rate-limit rows are untouched. Account deletion remains a separate earlier-deletion requirement. Once a feedback/dismissal record expires, its deduplication receipt is also gone; suppression is not retained indefinitely beyond this retention window. Provider backups and recovery deletion replay remain separate release gates.

## Evidence, 16 September 2026

- Root local tests: 14/14 across retention and feedback backend suites. Calendar/leap boundary, exact cutoff, preservation of newer/unrelated rows, repeat safety and scheduled draining of 205 rows passed.
- Development sync with backend TypeScript enabled succeeded at 12:01:43 against dev:dutiful-fly-37.
- Explicit internal development invocation returned feedbackDeleted=0, dismissalsDeleted=0, continuationScheduled=false. No eligible live development records were removed.
- A public unauthenticated invocation of retention:purgeExpiredFeedback was rejected as non-public.
- The full app typecheck was not green at this checkpoint: concurrent analytics marker changes in provider.tsx lacked a sessionId property in their parsed type. That separate worker owns correction.

Production scheduling, monitoring/alert delivery, provider outage recovery and deletion from backups are not verified by this checkpoint.
