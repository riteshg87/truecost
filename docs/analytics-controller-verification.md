# Analytics controller verification

Status: local implementation for TASK-015B. The controller is a pure, in-memory boundary around the closed event contract in [`lib/analytics/events.ts`](../lib/analytics/events.ts). It has no SDK, browser global, persistence, network client, consent UI or provider configuration.

## Public contract

`AnalyticsController` exposes these operations:

- `acceptGuestConsent()` creates one random UUID only after affirmative guest opt-in.
- `decline()` and `withdraw()` clear the queue, identity, delivery state and business deduplication memory.
- `setMemberContext({ analyticsAccountId, consent }, joinToken?)` accepts only a verified analytics-only member UUID supplied by the caller. A consented guest queue can join that member only with a captured `captureGuestJoin(flowId)` token. A missing or stale token fails closed by clearing the guest context before accepting the fresh member context.
- `signOut()` and `deleteAccount()` clear all pending work and return to an unknown guest state. They never create a replacement identifier.
- `enqueue(event)` revalidates and clones the event through `buildAnalyticsEvent`, checks the current guest/member state, enforces consent-time bounds and applies the plan's business key rules.
- `flush(online)` is the only delivery trigger. It uses a lazily created, immutable identity-bound transport and returns a typed snapshot rather than exposing provider errors.
- `getSnapshot()` reports only bounded status, counts, retry time and allowlisted error codes.

## Invariants verified

- Unknown and declined states create no identifier, transport or retained event. Consent is never persisted here.
- Member events require `auth_state: "member"`; guest events cannot be added after a member switch. Member identity is the supplied opaque analytics UUID, never a Clerk, Convex or contact identifier.
- Guest to member joining preserves the consented guest event's original event ID, timestamp and anonymous identity only when the explicit same-flow token is valid. Account switches, sign-out, withdrawal and deletion invalidate the generation and clear pending work.
- Every transport factory and send receives a frozen identity snapshot. A late factory or send completion cannot remove, retry or report an event for a newer generation. A new generation can start its own pump while an older send is still settling.
- The queue is capped at 100 events and business deduplication memory is capped at the same bound. Successful business keys remain deduplicated for the consent lifetime. No input content is used in a key.
- Events older than the consent lifetime or in the future are rejected. Queued work is bounded to 24 hours; an event exactly at the boundary remains eligible. Expired work is reported as `expired` and is not sent.
- Delivery attempts are capped at five, with bounded exponential backoff. Initialization and send failures count against that cap. Exhausted work remains visible as paused; there is no timer or automatic retry loop.
- `flush(false)` marks the controller offline immediately. A send already in progress may settle, but it cannot advance the queue or start another send while offline.
- Payload validation and outbound revalidation reject unknown properties, malformed IDs, forbidden content and auth mismatches. Failure snapshots carry only the closed error codes.

## Focused evidence

Command: `npx vitest run tests/analytics-controller.test.ts --reporter=verbose`

Observed result: **1 file, 19 tests passed**.

The tests cover unknown and declined defaults, lazy opt-in, business deduplication, explicit guest-to-member joining, stale-token clearing, account isolation, A to B to A late work, lost receipt retry with a stable event ID, age-boundary expiry, attempt-cap pausing, malformed payloads, privacy-safe transport failure, consent-time and future timestamps, idempotent member context, runtime context rejection, initialization failures, offline cancellation, interrupted-send caps, delayed-setup expiry, combined pending and delivered bounds, bounded successful deduplication and invalid injected IDs.

Targeted typecheck: `npx tsc --noEmit --incremental false --pretty false` returned no diagnostics. The event and controller suites together observed **2 files, 25 tests passed**.

## Remaining work

The next local slice can connect this boundary to an explicit consent and auth UI, a reviewed transport adapter and provider payload inspection. The controller does not verify server identity itself, persist consent or events, call an SDK, prove Mixpanel region or retention settings, or provide dashboard evidence. Those release and provider checks remain open under TASK-015.

## Integrated adapter checkpoint, 16 September 2026

Root reviewed the pinned mixpanel-browser 2.83.0 adapter, its actual SDK serialization tests and the controller teardown additions. The adapter uses isolated named instances and consent-marker prefixes, avoids the SDK identify call, limits the complete event envelope and binds every transport to its creation identity. The original occurrence time maps to Mixpanel time, and event_id maps to $insert_id. Ordinary withdrawal does not claim historical provider deletion.

The real SDK test intercepts XHR before initialization, observes zero initialization XHRs, and checks exact request property keys plus ip=0. A separate check proves disposing an older SDK instance cannot opt out the newer instance in the same page. Browser-level observation of all network mechanisms and storage remains required in the integrated app.

Root reran the event, configuration, controller, adapter and backend suites together: 5 files, 44 tests passed. No live Mixpanel ingestion was exercised. The development project uses Simplified ID Merge as verified in its settings. The local token is configured with analytics disabled. App consent UI, business-event instrumentation, live ingestion/funnel comparison, cross-tab withdrawal and historical deletion remain incomplete. These tests do not close TASK-015.
