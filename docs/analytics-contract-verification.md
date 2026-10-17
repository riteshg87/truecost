# Analytics event contract verification (TASK-015A)

## Delivered contract

`lib/analytics/events.ts` provides `parseAnalyticsEvent` and `buildAnalyticsEvent` for the closed v1 event envelope in `docs/analytics-plan.md`. The parser accepts only the eleven planned event names and exact event-specific properties. It validates the fixed environment, route, feature, action, stage, source, answer, status, device and error enums; trusted release, calculation and context allowlists; canonical UTC timestamps; opaque v4 UUID correlations; bounded counts and web-vital values; and member-only event auth state. Cross-field rules cover guest/member event meaning, offer-count eligibility, comparison feature scope, compare-again modes, and failure-only error codes.

The builder clones before parsing and returns a deeply frozen sanitized event. Unknown properties, URLs, contact text, finance values, user or database identifiers, hashes, arbitrary strings, NaN/infinity, invalid web-vital units and guest member events are rejected with bounded contract error codes. No SDK, consent state, identity persistence, network transport, provider configuration or UI wiring is included.

## Evidence

Focused verification: **5 tests passed in 1 file** (`tests/analytics-events.test.ts`). The tests cover a valid fixture for every planned event, clone/freeze behavior, unknown and forbidden fields, malformed IDs/timestamps/numbers/enums, guest/member mismatch, compare-again mode requirements, and trusted allowlist behavior.

Targeted TypeScript diagnostics for the analytics contract and tests are clean. No full build or external analytics setup was run.

## Open implementation work

TASK-015 still requires the next local slice for consent and identity, the bounded delivery queue, SDK default-property audit, region and retention decisions, network payload evidence, and seeded dashboard verification. The current release allowlists (`0.1.0`, `finance-engine-v1`) are local trusted defaults and must be updated through reviewed build configuration when release or calculation versions change.
