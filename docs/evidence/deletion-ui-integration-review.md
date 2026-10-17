# Account deletion UI integration review

17 September 2026. Work in progress; no deployment or acceptance claim.

Astra inspected the first `lib/privacy/account-deletion-provider.tsx` draft and returned these findings to the implementing Luna worker:

- Recheck the original Clerk subject/session after awaiting analytics shutdown, before calling the deletion mutation. An account can switch during that await.
- Bind server-status reads and displayed progress to the original request's identity. A later account must not supply completion status for the former account.
- Publish the approving/submitting state immediately and keep captured signal/cleanup callbacks specific to their coordinator. Duplicate starts must not replace callbacks belonging to an in-flight request.
- Handle status-query failures without crashing the application when identity or connectivity disappears.
- Await the coordinator's cancellation result before setting React state.
- For an unknown response, say that acceptance is uncertain. Do not promise the server blocked the account without acknowledgement or status evidence.
- Show the provider attention state, and keep progress readable without covering navigation or page controls.

The integration must remain above CompareProvider's keyed subtree. The existing private-state remount protection stays intact. Tests must cover these boundaries before this review can be closed. Full reload recovery and live-provider acceptance remain separate requirements.

## Partial verification checkpoint

Root ran `npx vitest run tests/account-deletion-mounted.test.tsx tests/account-export-ui.test.tsx`: 9 passed. The three deletion tests mount the panel but mock the entire deletion provider. They establish confirmation cancellation, callback wiring and uncertain-status text only. They do not establish runtime replay, survival across subtree remount, account-switch fencing or status-query failure handling. Those tests were explicitly requested from the implementing worker before acceptance.

Root also ran `npm run typecheck` successfully after the initial layout/provider/panel integration. The current build remains a work in progress. No real account deletion was attempted.

The first actual provider-mounted test draft was run alongside recovery tests. All five runtime cases failed; this supersedes any inference of runtime acceptance from the passing panel tests. Findings include an approving state not advancing visibly during submission and test-harness errors. The implementing worker is fixing the runtime and tests. Root will rerun the frozen result before acceptance.

## Local browser preparation

The old server handle was missing and no listener existed on port 3337. Root started `npm run dev -- --port 3337`; Next reported ready and the root URL returned HTTP 200. In the in-app browser, the landing page rendered. Visiting `/account` while signed out showed the verification hold and then returned to `/`, with no private account or deletion controls visible. The local development server includes the current source; this is not a production build check or a hosted deployment.

The browser has no verified member session for this check. No OTP was sent, no account data was submitted, and account deletion was not attempted. The local tab is retained for the next verification step.

## Reviewed runtime checkpoint, 17 September, 10:51 UK

Root inspected the current runtime, coordinator and actual mounted assertions. The runtime now publishes acceptance before asynchronous local cleanup finishes, validates status payloads, checks Clerk identity after analytics withdrawal, and keeps progress outside the keyed private subtree. Earlier failing draft results above are historical, not the current result.

Root found two weak tests and requested fixes: replay returned a different request ID and asserted only the second call; the account-switch test could pass before the pending withdrawal resumed. The corrected replay test returns the submitted UUID and awaits accepted state with one cleanup and one signal. The switch test awaits terminal cancellation before asserting zero server submissions.

Root ran `npx vitest run tests/account-deletion-provider-mounted.test.tsx tests/deletion-journal.test.ts tests/account-deletion-recovery.test.ts`: 32 tests passed across three files at 10:50:53 UK. These establish mocked runtime behavior, journal validation and authenticated server-receipt behavior. They do not establish reload integration or actual Clerk/Convex deletion. TASK-014 remains open.

## Next recovery boundary

The journal is currently unused by the provider. Integrate persistence before the first deletion network call, retaining the exact original request/grant/session across uncertain responses. A reload must never obtain a new grant to replace an ambiguous request. A journal phase alone cannot establish server acceptance or authorize a profile-selected local wipe.

Use the authenticated recovery receipt to derive the deletion owner's local partition scope. Recovery cleanup must be removal-only, preserve other accounts, increment generation tombstones, and never construct a normal private-session grant. Account switching during receipt retrieval must discard the late result. Missing, malformed, foreign or unavailable journals need truthful recovery states and must not silently overwrite another outstanding request.

Clerk identity removal can make authenticated receipt recovery unavailable. This remains a separate required signed-out cleanup path, along with cross-tab clearing and real development-provider verification. Do not label persistence-only work as complete reload recovery.

## Integrated verification checkpoint, 17 September

Root ran npm test after reload reconciliation and removal-only cleanup integration: 838 tests passed across 84 files, exit 0 (11:10:48 UK start, 61.61 seconds). jsdom emitted two unsupported-navigation warnings; these are test-environment output and do not prove browser navigation. Root stopped the confirmed local dev session before production-build verification to avoid concurrent writes to .next.

The first integrated typecheck still found two test-spy annotations allowing null for IndexedDB.get, which does not accept null. Root coordinated ownership and removed null from those two annotations in tests/deletion-recovery-cleanup.test.ts. This is a test typing correction only; the runtime suite above covers the same behavior. Typecheck rerun and production build are pending their actual results.

Production-build result: npm run build completed with exit 0 after TypeScript and all 19 page generations. Together with 838 passing tests and the successful typecheck, this verifies the local reload-recovery checkpoint as buildable. It does not close the newly identified cross-tab disk-cleanup gap or hosted-provider acceptance. Subsequent cross-tab changes will require affected checks and an integrated build check again.
