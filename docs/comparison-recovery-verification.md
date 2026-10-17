# Comparison recovery verification

Checked locally on 16 September 2026 as the bounded TASK-007 recovery slice.
The checkout was already dirty with the comparison integration candidate and
other agent work. No existing edits were reset, stashed or replaced.

## Implemented behavior

- `ComparisonWorkspace.retryPausedSave(requestId)` is an explicit, serialized
  transition for `unauthorized` and `retry-exhausted` jobs that are still inside
  the seven-day replay window. It resets only the bounded attempt counter and
  keeps the original request ID, canonical snapshot, source and creation time.
- A second tab or a double click observes the first transition and cannot create
  another queued job. Account lifetime checks still fence the transition before
  and after storage work, so a late callback or invalidated grant cannot reopen
  private work.
- Expired, conflict, request-reuse, deleted and invalid jobs remain paused. An
  expired job is never sent again: the UI says the save is too old to retry and
  that the app could not confirm whether it was saved, while retaining the
  displayed result for a deliberate next action.
- The comparison provider exposes the paused reason and request ID. Its retry
  action calls the workspace recovery transition and then the existing bounded
  pump. A matching receipt is still the only path to `saved`.

## Files owned by this slice

- `lib/comparison/private-workspace.ts`
- `lib/comparison/transport.ts` (inspected; no transport change was needed)
- `lib/store.tsx`
- `components/ComparisonStatus.tsx`
- `tests/comparison-private-workspace.test.ts`
- `tests/comparison-recovery-ui.test.tsx`
- `tests/compare-provider.test.tsx`

## Verification

Focused recovery, provider and UI tests: **35/35 passed** across 3 files.
The full suite before the final concurrent recovery assertion was 432/432;
the full suite was rerun after this slice and remains green at **433/433**.
Typecheck passed after the provider and test changes.

The focused assertions cover:

- bounded retry exhaustion followed by an explicit same-request retry;
- exact request ID, serialized snapshot and original `createdAt` preservation;
- expired replay refusal with durable snapshot retention;
- concurrent retries across two tabs producing one transition and one network
  send;
- grant invalidation returning `locked` without reopening the job;
- mounted provider recovery after an unauthorized callback and a fresh verified
  account grant;
- reason-specific UI copy and no retry control for expired jobs.

## Remaining verification

The real browser still needs a connected check of the paused state after eight
network failures, a fresh verified grant after an unauthorized callback, two
simultaneous tabs pressing the recovery action, and an expired job whose server
receipt status is unknown. History is not part of this slice, so the expired
state deliberately keeps the result open and does not claim account storage.
Root reviewed the workspace transition, provider wiring, status component and
new concurrency/expiry assertions. The final full suite passed 433/433 across
37 files; typecheck and the 17-page production build passed. Build ID:
`PcMbNRf0rAUZoMCH2rUlV`. The changed application sources predate that build.
At that checkpoint browser acceptance remained pending, so the connected run
below was added separately.

## Browser acceptance run

The bounded harness `scripts/check-comparison-recovery-browser.mjs` ran against
the approved built server on 16 September 2026:

- **PASS**: guest two-offer result mounted in Chrome 152.0.7977.83.
- **PASS**: a mounted member result was paused after exactly eight injected
  `rate_limited` save responses, then explicit recovery produced one matching
  Convex row.
- **PASS**: request ID, canonical snapshot hash and original `createdAt` were
  preserved across the retry; cleanup removed the owned row and revoked the
  new session.
- **PASS**: an eight-day-old queued save stayed local, showed the unknown
  acknowledgement copy and offered no blind retry.
- **PASS**: a generated disposable member completed the same flow after the
  harness shortened its local part to 59 characters and asserted the 64-character
  limit. Cleanup revoked the new session, deleted the one run-owned Convex row,
  and deleted the disposable Clerk identity.
- **DIAGNOSIS**: the earlier `truecost-recovery-` generator made a 65-character
  local part, so Clerk returned HTTP 422 from `POST /v1/client/sign_ins` before
  account creation. The failed attempts created no rows and are archived with
  their no-identity cleanup results.

Evidence and screenshots:

- `docs/evidence/comparison-recovery-browser.json`
- `docs/evidence/comparison-recovery-paused.png`
- `docs/evidence/comparison-recovery-saved.png`
- `docs/evidence/comparison-recovery-expired.png`
- `docs/evidence/comparison-recovery-existing-member.json`
- `docs/evidence/comparison-recovery-existing-member-paused.png`
- `docs/evidence/comparison-recovery-existing-member-saved.png`
- `docs/evidence/comparison-recovery-existing-member-expired.png`
- `docs/evidence/comparison-recovery-browser-attempt-20260916T072200Z.json`
- `docs/evidence/comparison-recovery-browser-attempt-20260916T072305Z.json`

The passing run used build `PcMbNRf0rAUZoMCH2rUlV`, the pinned Chrome/
Playwright harness and only authorized disposable development data changes.
No production or provider configuration changed. Browser coverage of
two independent tabs remains pending; the network-fault, explicit retry,
stable identity, disposable-member cleanup and expiry checks are mounted and
recorded.

## Current candidate refresh: 2 October 2026

The recovery flow passed 8 checks in Chrome 154 / Playwright 1.62.1 against the current candidate `ydMzVTyEiY_q6uNn7FXx1`. It covered the guest result, eight intercepted save failures, explicit same-request recovery, stable snapshot identity, an expired queued save with no blind retry, run-owned cleanup and disposable Clerk identity deletion. The existing harness exposed a reset-settle race before the expired branch; a temporary one-second settle was used only in the copied harness and then deleted. The failed first attempt is preserved in [comparison-recovery-browser-failed-2026-10-02T13-15-47Z.json](evidence/comparison-recovery-browser-failed-2026-10-02T13-15-47Z.json). Evidence: [comparison-recovery-browser.json](evidence/comparison-recovery-browser.json). No product source, provider configuration or deployment changed.

## Source-equivalent recovery rerun: 4 October 2026, 02:28 UTC

The current source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed all eight Chrome 154 recovery checks. The run covered the guest result, eight intercepted transient save failures, explicit same-request recovery with stable request and snapshot identity, expired queued-save refusal, run-owned comparison cleanup and disposable Clerk identity deletion. Evidence: [comparison-recovery-browser-current-2026-10-04.json](evidence/comparison-recovery-browser-current-2026-10-04.json). The run recorded zero browser errors and zero cleanup errors. It used authorized disposable development-data mutation, including provider data creation and deletion; provider settings, hosted settings, production changes, deployment, commit, push and external submission were all false. This is local development evidence; production recovery, provider retention/deletion, installed-app coverage and release approval remain open.

## Source hashes

SHA-256 at this checkpoint:

| File | SHA-256 |
| --- | --- |
| `lib/comparison/private-workspace.ts` | `557C85CD2917D0F6A692E460A5DCE8EFD05162C5B64A37E637BE5A7D52C74734` |
| `lib/comparison/transport.ts` | `555B6B7CBA36895D703118E43AF3A8497F915A34369A820219662CBB6FAC29B8` |
| `lib/store.tsx` | `BBB7B783E651EB3A32AA4193648DDE1AF8B262EFB3F8383DD2A8CECD69A3C08F` |
| `components/ComparisonStatus.tsx` | `0BB404B6CF0D432C0F19C03C889DE52508329DA291E9BB6E76FFCC5FE080DF19` |
| `tests/comparison-private-workspace.test.ts` | `BA9ACE826A773D396D9E21C5B83C70FDFF51D0E3C3AC0D3BEBD2347B9D596D45` |
| `tests/comparison-recovery-ui.test.tsx` | `150F1E8B1FAB38F6C5CB55BC8971E91F5C9CBACFF27B8944D8D18534D91AC9E7` |
| `tests/compare-provider.test.tsx` | `BD6312B205384B3B0670775828EBDCA322403B8825B871A699F64D74F3415B76` |
