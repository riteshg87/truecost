# Analytics acceptance evidence

Updated 2 October 2026. TASK-015 remains incomplete. Synthetic development checks are not product traction or production approval.

| Requirement | Evidence | What it proves | Remaining gap |
| --- | --- | --- | --- |
| Account-owned consent and IDs | [Current-candidate 14-check development run](evidence/analytics-preference-dev-20261003T010425Z.json), [historical backend run](evidence/analytics-preference-dev-prior-20260916T094620Z.json) | The reviewed candidate preserves unknown/declined defaults, stable affirmative consent, distinct server IDs, validator rejection and stale-revision fencing; withdrawal removes send permission | Two synthetic Convex preference rows remain because no reviewed public deletion operation exists; Mixpanel ingestion, dashboard reconciliation, provider retention/deletion and one-browser account switching remain open |
| Member comparison, save, feedback and PDF events | [15-check live run](evidence/member-analytics-browser-2026-09-17T16-11-26-414Z.json) | Nine acknowledged events, correlations and withdrawal/sign-out suppression in that sequence | Other account transitions |
| Guest activity joins the correct member | [Live browser run](evidence/member-analytics-browser-2026-09-17T17-14-58-817Z.json), [provider observation](evidence/mixpanel-guest-join-observation.json) | Six events acknowledged and present together in the member profile feed | Join latency was not measured; no account-switch claim |
| Withdrawal remains off after guest reload | [11-check intercepted run](evidence/member-analytics-browser-2026-09-18T09-17-19-872Z.json) | Real development auth; guest result/recalculation after logout sends no new analytics | Complete storage failure across reload |
| Ordinary logout resets guest consent | [11-check intercepted run](evidence/member-analytics-browser-2026-09-18T09-41-43-554Z.json) | Accepted member logs out without withdrawing; guest reload requires new opt-in | Cross-tab and external session termination |
| Switching A to B isolates queued work and identity | [Seven regression checks](../tests/analytics-account-switch.test.tsx); full suite 1,061/1,061, TypeScript passed | Mounted-provider queue clearing for unknown/declined B, exact B event delivery, delayed factory disposal, stale preference fencing and revoked-session suppression; controller label check | Same-browser two-account and auth-transition verification, including real SDK requests |
| Online A logout followed by B login in one browser | [13-check intercepted browser run](evidence/member-analytics-browser-2026-09-18T10-31-39-861Z.json) | Real development Clerk/Convex and SDK requests; B's server consent initially unknown, zero B events before opt-in, separate member/device IDs afterward, four exact events and no A insert-ID replay | Cross-tab auth propagation and Mixpanel ingestion are not covered |
| Pending A completion is discarded during an in-app account switch | [14-check pending-transition run](evidence/member-analytics-browser-2026-10-02T09-39-43-046Z.json) | The A completion request was held at the intercepted Mixpanel boundary while Clerk/Convex stayed online; the mounted app completed sign-out without delivering it, and B later delivered only its own pair with disjoint identities and insert IDs | Mixpanel ingestion and a second-tab auth transition remain open |
| Pending A completion is discarded after a second-tab sign-out | [16-check second-tab run](evidence/member-analytics-browser-2026-10-02T10-14-31-722Z.json) | Tab 2 signed out A, tab 1 observed the auth transition, the held A completion was discarded, and B later delivered only its own pair with distinct identities and insert IDs | Mixpanel ingestion remains open; the harness reloads tab 1 once after shared Clerk state settles |
| Consented comparison immediately after hard navigation | [Failed browser run](evidence/member-analytics-browser-2026-09-18T10-29-54-403Z.json) | A signed in and accepted analytics, but no events were captured for the comparison following a hard navigation | Investigate hydration/consent readiness; normal in-app navigation passing does not close this gap |
| Hard navigation with a two-second settle | [2s timing run](evidence/member-analytics-browser-2026-10-02T09-49-54-994Z.json), [0ms provider-readiness probe](evidence/member-analytics-browser-2026-10-02T18-01-35-965Z.json), [2s provider-readiness probe](evidence/member-analytics-browser-2026-10-02T18-00-22-760Z.json), [5s timing diagnostic](evidence/member-analytics-browser-2026-10-02T09-51-14-867Z.json), plus the [18 September diagnostic](evidence/member-analytics-browser-2026-09-18T10-39-31-901Z.json) | The 2s timing run saw the post-navigation preference request start 836ms after the input/calculation click and its HTTP response observed at 942ms; it captured zero events. The 0ms probe records token resolution between input dispatches, 124ms before calculation, while the post-click snapshot has no parsed/current/accepted provider marks and zero A events. The matched 2s probe records parsed/current preference, accepted-context activation and committed accepted status before input/calculation, then captures both A and B pairs | The final harness now captures provider readiness at failure as well as before/after input and calculation, without recording values or changing behavior. These probes distinguish readiness timing from HTTP headers but do not prove the cause or a product remedy. No unconsented event was buffered, no calculation was delayed, and no navigation workaround was used; hard-navigation acceptance stays open |
| Dashboard numerators and denominators | Open | Definitions exist; local event-contract and duplicate/retry tests pass | Seed duplicates/missing events; independently reconcile provider dashboards |
| Retention and historical deletion | Open | Implementation and proposed targets exist; [history browser run](evidence/comparison-history-browser.json) now covers an offline queued deletion mirrored to a second tab and completed after reconnect | Provider feasibility, acknowledgements, joined-identity deletion, retention enforcement |

## Remaining browser acceptance sequence

Use only disposable development accounts and the existing approved Clerk testing-token route. Keep raw IDs, emails, tokens and OTPs out of evidence.

1. Investigate missing events after hard navigation with accepted consent. The diagnostic probes now measure auth-bound token resolution, parsed/current preference, accepted-context activation and committed provider status alongside actual input and calculation dispatch. Preserve fail-closed behavior while consent/auth is unresolved; do not treat a navigation workaround or longer settle as a fix.
2. The [14-check pending-transition run](evidence/member-analytics-browser-2026-10-02T09-39-43-046Z.json) covers a mounted same-browser A to B switch with the A completion held at the analytics transport, confirmed sign-out, and B-only delivery. The [16-check second-tab run](evidence/member-analytics-browser-2026-10-02T10-14-31-722Z.json) adds sign-out from tab 2 and propagation to tab 1. The [15-check device offline run](evidence/member-analytics-browser-2026-10-02T11-12-19-553Z.json) covers a browser-disconnected start event and one reconnect delivery. The current rebuilt candidate's [61-check Clerk/Convex browser run](evidence/comparison-auth-browser.json) covers member comparison and quote queues, reconnect acknowledgements, cold offline privacy, loan transfer/offline recovery, responsive account/loan status, and confirmed sign-out clearing. The current build's [24-check history/multi-tab run](evidence/comparison-history-browser.json) covers queued deletion mirroring and reconnect completion across tabs.
3. The second-tab run observed logout/account changes and verified that the held A completion could not send after the transition. The [history browser run](evidence/comparison-history-browser.json) still covers same-account pending deletion mirroring and reconnect completion across tabs, not analytics auth transition. Mixpanel ingestion remains open.
4. Clean up only run-owned comparison rows and Clerk users/sessions. Report profile, feedback and analytics residuals separately; identity reset is not deletion. The dated browser runs delete their run-owned rows and users; provider profile, feedback and analytics residual cleanup remains separate.

The generic analytics-preference-dev.json is a mutable rerun output; the dated current-candidate copy above is the cited record. Do not infer current production readiness from any historical or synthetic development run.

The approved Mixpanel project URL (`project/4064154`, view `4560599`) opened to a `Request Access` page in the current browser session. No access request, login or event submission was made. Provider dashboard reconciliation and provider-side retention/deletion remain open until authorized project access and evidence are available.

## Pending-transition browser checkpoint: 2 October 2026

The analytics-enabled local build `wABL4wbCIK_WI-WhFi7EN` passed compilation, TypeScript and 19 routes. The harness source hash was `18f056f625d5a0375bb45ab476d2cbc61a0243cb973da8a7db5fcd295c778e3a`; the normal analytics-disabled build was restored as `ApHEKy-bT17LmBF_d8ydv` afterward.

The intercepted 14-check run accepted A consent, emitted A's start event, held A's completion request before the transport acknowledgement, navigated within the mounted app to Account, confirmed sign-out, then verified that the held completion was not delivered. B began with unknown consent, completed a usable analytics-silent comparison, opted in, and delivered only its own start/completion pair with distinct member/device IDs and disjoint insert IDs. Both disposable Clerk identities were deleted and no saved comparisons remained. Evidence: [member-analytics-browser-2026-10-02T09-39-43-046Z.json](evidence/member-analytics-browser-2026-10-02T09-39-43-046Z.json).

This closes the browser-level mounted-provider queue-discard check for one A completion. It does not prove offline transport, second-tab auth propagation, Mixpanel ingestion, dashboard reconciliation, or provider retention/deletion. No product behavior changed, and no event was sent to Mixpanel.

## Hard-navigation consent timing checkpoint: 2 October 2026

The analytics-enabled build `1nKiIy6xdlno5JOcComuK` passed compilation, TypeScript and 19 routes. The harness source hash was `857f7d6c72bfb79e3743631dd3f1bd049dd67188674a663e66b8fce7bc442e47`; the normal analytics-disabled build was restored as `NX0mAmH7jqxFCBi5_QIfM`.

The 2-second run ([evidence](evidence/member-analytics-browser-2026-10-02T09-49-54-994Z.json)) observed analytics on before navigation, then recorded the post-navigation preference request starting 836ms after the calculation click and its HTTP response marker 942ms after the click. No Mixpanel events arrived. The matched 5-second run ([evidence](evidence/member-analytics-browser-2026-10-02T09-51-14-867Z.json)) observed the response marker before the calculation and captured the expected A and B event pairs. Both runs used intercepted transport and disposable identities; cleanup completed with no saved comparisons.

The harness listens to Playwright request/response callbacks, so the response marker is not proof that the provider parsed the preference or activated consent. The provider source and loading-state regression guard keep `track()` fail-closed while consent is unresolved; `npx vitest run --maxWorkers=2 tests/analytics-provider.test.tsx` passed 30/30. This measures a readiness-window difference between the two settles. It does not prove that waiting is the correct product behavior. The harness did not buffer unconsented events or delay calculations, and no navigation workaround was treated as a fix. Hard-navigation acceptance remains open; the mounted second-tab transition and device-level offline transport now have separate local evidence below. Live provider ingestion and dashboard reconciliation remain open.

## Hard-navigation provider readiness checkpoint: 2 October 2026

The diagnostic build `hgG8NSc_8cHfLnCR4v1zv` added opt-in development-only User Timing marks around auth-bound token resolution, preference parsing, accepted-context activation and the committed provider status. The source marks are guarded by `NEXT_PUBLIC_TRUECOST_ANALYTICS_DIAGNOSTICS=1` and the development analytics environment; they do not alter consent, queueing, calculations or transport.

The 0ms hard-navigation run ([failed evidence](evidence/member-analytics-browser-2026-10-02T18-01-35-965Z.json)) records the provider starting `preference_read` and token acquisition before the account A inputs and calculation click. Token resolution occurs between input dispatches, 124ms before the calculation click; the snapshot immediately after the click has no parsed preference, current-read, accepted-context or committed-accepted marks. The failure snapshot then records the same unresolved provider state before the existing event assertion times out. It delivered zero A events.

The matched 2s run ([passed evidence](evidence/member-analytics-browser-2026-10-02T18-00-22-760Z.json)) records B token resolution, parsed/current preference, accepted-context activation and committed `accepted` status before B input and calculation marks. It passed 13 checks and delivered the expected A and B pairs. The harness source hash was `7d55ce7013143714d81013cca31962e588b38e6bcabf6dc64bcb94215d5b1b04`; provider and transport source hashes were `3f9579c9a86fec1f4d4b327883ab5b57906334c466b3564553b855d7a2b95802` and `92eeb10f49b8a629f851d31f87fcd8f5284a1a51d6202558b4b6afce4ddb3243`.

After the probe, the analytics-disabled candidate was rebuilt and restored as `yAPHNfIW8scb2GyyGdBIo`; the current candidate manifests reference that normal build.

This isolates the readiness window more precisely than HTTP callbacks, while still leaving the cause and product remedy unproven. No event was buffered, no calculation was delayed, no navigation workaround was used, and Mixpanel transport remained intercepted locally. Hard-navigation acceptance remains open.

The final harness also records a `failure_after_error` provider snapshot. Three
follow-up runs with the final harness exposed the same readiness variability:
the 0ms run again failed the existing A-event assertion, and the 2s runs failed
at A or B event assertions after recording their provider timelines. Evidence:
`member-analytics-browser-2026-10-02T18-19-44-269Z.json`,
`member-analytics-browser-2026-10-02T18-20-50-061Z.json`,
`member-analytics-browser-2026-10-02T18-22-20-930Z.json` and
`member-analytics-browser-2026-10-02T18-23-15-102Z.json`. Their final harness
source hash is `180ce856ca6a11ae9aca7053c10ffcb209149e50a65edf9db40d2e72ab438181`.
The earlier matched 2s pass remains valid as a prior diagnostic run; these
reruns reinforce that a longer settle is not a product remedy.

## Current hard-navigation diagnostic repeat: 2 October 2026, 22:03 UTC

A temporary diagnostics-only local build `zXmb7WujtdoPzCdjgq39W` enabled analytics for the existing intercepted account-switch harness. The normal analytics-disabled candidate was rebuilt and restored as `ZJQv_k9n1bWVBKPw5W-oR` afterward. No product source, consent policy, queueing, calculation or transport behavior changed.

- The zero-settle run passed 13 checks and delivered the expected A and B `comparison_started` / `comparison_completed` pairs. For account A, the post-navigation preference request completed before input and calculation dispatch.
- The first two-second run accepted consent but timed out with zero events. Its post-navigation preference request started at the calculation boundary and completed afterward, so the provider was still resolving readiness when the calculation ran.
- A second two-second run passed 13 checks and delivered both pairs after the preference request completed before input and calculation. The matched results show run-to-run readiness variance; a two-second delay is not a reliable remedy.

Evidence: [diagnostic summary](evidence/hard-navigation-diagnostic-repeat-2026-10-02.json), [zero-settle pass](evidence/member-analytics-browser-2026-10-02T21-59-56-805Z.json), [two-second readiness failure](evidence/member-analytics-browser-2026-10-02T22-01-46-766Z.json), and [two-second repeat pass](evidence/member-analytics-browser-2026-10-02T22-03-30-709Z.json). The observations strengthen the timing diagnosis but do not prove the cause or authorize a product change. No unconsented event was buffered, no calculation was delayed and no navigation workaround was treated as a fix. Hard-navigation acceptance remains open.

## Second-tab auth transition checkpoint: 2 October 2026

The analytics-enabled build `ixZzRSloataoxhJS76W4Z` passed compilation, TypeScript and 19 routes. The harness source hash for the successful run was `2195329e5f2b2dbe34ba7294a945397b1f808aad8a9aa0043bd06bd81d31a501`; the latest normal analytics-disabled candidate was restored as `ReTEk8KCoS93Or4lYAuV6` after the harness-only rollback.

The 16-check run ([evidence](evidence/member-analytics-browser-2026-10-02T10-14-31-722Z.json)) opened a second tab under account A, signed out from that tab, and observed the transition in tab 1. A's held completion remained undelivered. Tab 1 then authenticated account B, confirmed unknown consent kept B analytics-silent, opted in, and delivered only B's comparison pair with distinct member/device IDs and disjoint insert IDs. Run-owned comparisons were deleted and both disposable Clerk identities were deleted.

The harness reloaded tab 1 once after the shared Clerk client settled at the sign-in boundary. This is a harness synchronization step, not a product behavior change. Mixpanel transport was intercepted locally, so live provider ingestion and dashboard reconciliation remain open.

## Offline analytics transport checkpoint: 2 October 2026

The analytics-enabled build `r2-pg6buNZ5ovwGJZnVou` passed compilation, TypeScript and 19 routes. The harness source hash was `967a3ed31675a18d5d011262528a9a1881abe75a7abd5a5fbde4c82c66455adc`.

The 13-check run ([evidence](evidence/member-analytics-browser-2026-10-02T10-52-33-729Z.json)) kept Clerk and Convex online while the Mixpanel transport was blocked. Account A's comparison start stayed behind the blocked queue head across retries, and no A payload was delivered after confirmed sign-out. Account B started with unknown consent, completed a usable analytics-silent comparison, opted in, and delivered only its own start/completion pair with distinct member/device identities and disjoint insert IDs. Both run-owned comparison records and disposable Clerk users were deleted.

This is browser evidence for a Mixpanel transport outage with auth and data providers available. It does not prove a device-level offline browser run, live Mixpanel ingestion, dashboard reconciliation or provider retention/deletion. The normal analytics-disabled candidate was restored as `FljzqvTD7DFSe5HNlPn2b` after the run; no product behavior changed.

## Local provider lifecycle checkpoint: 2 October 2026

The current checkout passed 70 focused tests across four provider and transition files: [provider lifecycle evidence](evidence/provider-lifecycle-local-2026-10-02.json). The run covers mounted analytics account-switch fencing and disposal, durable provider deletion claim/retry/lease/poll transitions, and signed-out cleanup retry safety. Source hashes and the exact command are recorded in the evidence file.

This strengthens local lifecycle evidence only. Live Mixpanel dashboard reconciliation, provider-side retention and historical deletion, production provider configuration, and release approval remain open.

## Device offline analytics checkpoint: 2 October 2026

The analytics-enabled build n83G62lixjdCZMaPkOA33 passed compilation, TypeScript and 19 routes. The harness source hash was 339fd55abc3a43465a3a036b47d79aa908cc1a1bde042c200b42be62286aa865.

The 15-check browser run ([evidence](evidence/member-analytics-browser-2026-10-02T11-12-19-553Z.json)) loaded the comparison route online, then set the browser offline before Account A edited its inputs. The input remained usable, zero analytics events were delivered while offline, and the queued comparison_started event delivered once after reconnect. The run then completed A's comparison, signed out, authenticated B, confirmed unknown consent kept B analytics-silent, and delivered only B's pair after opt-in. A and B identities and insert IDs were distinct, and run-owned comparisons and disposable Clerk users were deleted.

This closes the device-level browser offline transport check for the tested start event. It does not prove live Mixpanel ingestion, dashboard reconciliation, provider retention/deletion, production configuration, or release approval. The normal analytics-disabled candidate was restored as s6Rd0-6fq4J60XsjN5Kr5.

## Current history boundary correction: 2 October 2026, 20:23 UTC

The later local build regenerated the candidate ID as `RyrrGW1XSRsA5B94RZrd2`. The matching 24-check history/report run at `2026-10-02T20:17:16.923Z` is recorded in [comparison-history-browser.json](evidence/comparison-history-browser.json) and includes desktop and 390px warm-offline report parity, queued deletion mirroring, offline privacy locks, account isolation and cleanup. The release manifest now binds that evidence to the Ryrr candidate. This remains development-browser evidence; Mixpanel ingestion, dashboard reconciliation, provider retention/deletion and release approval remain open.

The monitoring scrub slice later regenerated the candidate as `LTKX-eA3DPWpyth-XdVN1`; the 24-check history/report evidence was rerun against that exact build at `2026-10-02T20:30:53.111Z`. The analytics provider behavior and hard-navigation findings are unchanged. No unconsented event was buffered, no calculation was delayed and no navigation workaround was introduced.


## Candidate refresh after monitoring slice: 2 October 2026, 20:49 UTC

The current candidate is `2Bu3MZWREPtxsAbL9cmPp` with 1,059 tests across 111 files and a passed typecheck/build. The exact comparison-history/report rerun failed twice at the offline "Deletion pending" assertion; no analytics behavior changed, and no event was sent to Mixpanel. The prior LTKX history pass remains historical. Hard-navigation acceptance, live ingestion/dashboard reconciliation and provider retention/deletion remain open.

## Current candidate boundary after history fix: 3 October 2026

The normal candidate is now `ydMzVTyEiY_q6uNn7FXx1` after the metadata-only same-account `storage` event fallback was added beside `BroadcastChannel`. The 24-check history/report run, 32-check integrated Clerk/Convex run, 8-check recovery run and 70-test provider lifecycle suite pass against this candidate. No analytics provider behavior changed: hard-navigation readiness variance remains diagnostic evidence only, Mixpanel transport stayed intercepted, and live ingestion, dashboard reconciliation, provider retention/deletion and production configuration remain open.

## Current candidate preflight: 4 October 2026, 08:37 BST

The rebuilt normal candidate `llH6YCL2zRu1VEYvtRTd7` carries `NEXT_PUBLIC_ANALYTICS_ENABLED=false` by design. Running the intercepted hard-navigation harness against that exact candidate stopped at the account consent step because no analytics-consent control is rendered; it made zero provider or Mixpanel requests and cleaned the one disposable identity created before the preflight stopped. Evidence: [hard-navigation-current-candidate-preflight-2026-10-04.json](evidence/hard-navigation-current-candidate-preflight-2026-10-04.json) and the raw harness record [member-analytics-browser-2026-10-03T23-37-41-240Z.json](evidence/member-analytics-browser-2026-10-03T23-37-41-240Z.json). This is a configuration boundary, not a readiness result. The enabled-build timing probes remain the only hard-navigation diagnostics, and no buffering, calculation delay or navigation workaround was introduced.

## Current local Mixpanel contract checkpoint: 3 October 2026

The current checkout passed 53 focused tests across five analytics files covering adapter serialization, event allowlisting, configuration gating, provider consent lifecycle and integration behavior. Evidence: [mixpanel-contract-local-2026-10-03.json](evidence/mixpanel-contract-local-2026-10-03.json). This is local contract evidence only; no provider request was sent, and live ingestion, dashboard reconciliation, retention/deletion and production approval remain open.

## Local contract rerun: 4 October 2026, 00:19 BST

The same focused command passed 53 tests across the five analytics files after the current checkout's accessibility evidence additions. The rerun confirms the existing fail-closed consent and auth-readiness behavior without changing analytics source behavior. Evidence: [mixpanel-contract-local-rerun-2026-10-04.json](evidence/mixpanel-contract-local-rerun-2026-10-04.json). No provider request or Mixpanel event was sent; live ingestion, dashboard reconciliation, provider retention/deletion and production approval remain open.

## Source-equivalent offline and multi-tab rerun: 4 October 2026

The source-equivalent build `1iwP4oc_H3NlGLD2I7W_j` passed all 24 browser checks covering the two-account history/report flow, same-account second-tab deletion propagation, warm/cold offline locks, reconnect deletion, foreign read/delete rejection and responsive history controls. Evidence: [comparison-history-browser.json](evidence/comparison-history-browser.json). The reviewed candidate binding remains `ydMzVTyEiY_q6uNn7FXx1`; provider-side retention/deletion, interrupted-save and release gates remain open.

## Current local provider lifecycle checkpoint: 4 October 2026

The current checkout passed 70 tests across the four provider and account-lifecycle files used by the earlier local lifecycle evidence. Evidence: [current provider lifecycle rerun](evidence/provider-lifecycle-local-current-2026-10-04.json). The build ID is `1iwP4oc_H3NlGLD2I7W_j`; no provider request, Mixpanel event, deployment or hosted setting changed. This strengthens local lifecycle evidence only. Live ingestion, dashboard reconciliation, provider retention/deletion and production approval remain open.

## Fresh enabled-build hard-navigation timing diagnostic: 4 October 2026, 04:13 BST

An explicitly enabled development build `M5BZqNi5kuPRtReRpBP0Q` was exercised twice with the existing intercepted account-switch harness. The zero-settle run dropped both account-B events while its preference read completed at 32,261 ms, after the calculation click at 31,691 ms. The two-second-settle run delivered account-B completion but dropped account-B start even though a preference read completed 35 ms before the calculation click. Evidence: [diagnostic summary](evidence/hard-navigation-diagnostic-current-2026-10-04.json), [zero-settle raw run](evidence/member-analytics-browser-2026-10-04T04-12-02-845Z.json) and [two-second raw run](evidence/member-analytics-browser-2026-10-04T04-13-21-367Z.json).

This is consistent with an event-level readiness race in the enabled diagnostic build, but the raw runs do not record each tracker's attempted-or-skipped decision, so root cause remains open. A two-second settle does not establish a ready analytics controller. No unconsented event was buffered, no finance calculation was delayed and no navigation workaround was introduced. Mixpanel transport stayed intercepted, disposable Clerk identities were deleted and provider settings were unchanged; authorized disposable development and provider-data mutations occurred during the runs. Hard-navigation acceptance, live ingestion, dashboard reconciliation and production approval remain open.

## Hard-navigation caller-decision checkpoint: 4 October 2026, 04:35 BST

The diagnostics-only build `I6LLUZppRvjau-wvpU4Xm` added two development-only User Timing marks at the store/provider boundary: input and completion calls record when they are skipped while analytics is not accepted, while the provider records `track.invoked` and `track.queued` after acceptance. The marks carry no event values or identity data and are gated by `NEXT_PUBLIC_TRUECOST_ANALYTICS_DIAGNOSTICS=1` plus the development analytics environment. They do not alter consent, queueing, calculation, transport or navigation behavior.

The matched [diagnostic summary](evidence/hard-navigation-diagnostic-track-decision-current-2026-10-04.json) used the existing intercepted account-switch harness. The zero-settle [raw run](evidence/member-analytics-browser-2026-10-04T04-32-42-091Z.json) recorded input and completion skipped while the store was loading; provider acceptance committed after the calculation and zero A events arrived. The two-second [raw run](evidence/member-analytics-browser-2026-10-04T04-34-00-917Z.json) recorded accepted context before both accounts' input and calculation, then `track.invoked` and `track.queued` for both comparison pairs; all 13 checks passed. A prior two-second retry failed during an early auth event assertion and is preserved separately; it is not used for the matched interpretation.

This supports an event-level readiness race as the current explanation for the hard-navigation gap, while leaving product acceptance and alternate causes open. No unconsented event was buffered, no calculation was delayed and no navigation workaround was introduced. Mixpanel remained intercepted, disposable Clerk identities were deleted, and provider settings were unchanged; authorized disposable development and provider-data mutations occurred. Hard-navigation acceptance, live ingestion, dashboard reconciliation and production approval remain open.
