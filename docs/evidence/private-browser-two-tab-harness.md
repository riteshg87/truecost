# Browser-wide cleanup: actual two-tab storage check

Checked 17 September 2026 in the Codex in-app browser. The checkout is dirty on `codex/truecost-production`; this is local development evidence, not a release commit.

## Environment and method

Ran `node scripts/verify-private-browser-harness.mjs` from the TrueCost checkout. The server bound only to `127.0.0.1:3338` and served an in-memory bundle. It imported the actual private loan storage, comparison workspace, clear coordinator and cross-tab signal modules. It supplied empty provider configuration, read no credentials, and made no provider calls.

Opened `/?account=A` and `/?account=B` in separate browser tabs. Seeded only synthetic data through visible buttons, including cached loan payloads, queued saves, comparison drafts/snapshots and comparison queues. These tabs used mocked private-session capabilities, not Clerk authentication. The separate origin did not share app storage with `localhost:3337` or the hosted site.

## Observed results

| Check | Actual browser observation |
| --- | --- |
| A seeded | Loan store: 1 row; comparison store: 3 rows. |
| B seeded | Shared loan store: 2 rows; comparison store: 6 rows. B owned 1 and 3 respectively. |
| A confirmed synthetic cleanup | Returned `cleared`, loan epoch 1, comparison epoch 1. Both stores had zero rows. |
| B inspected after A clear | Received one deduplicated signal; both stores had zero rows. |
| A and B attempted captured loan writes | Both returned `locked` with reason `stale-callback`. Stores remained empty. |
| A and B attempted comparison writes with revoked access | Both returned `error/locked` from the actual workspace method. |
| A and B attempted comparison writes with deliberately mocked-current access | Both returned `error/stale-callback`, exercising durable epoch rejection independently of the access guard. |
| Captured old cleanup capability | Both returned `retry/runtime-changed`; neither recreated rows. |
| Synthetic guest marker | Preserved in both tabs before and after cleanup. |
| B reloaded and explicitly inspected storage | Both stores remained empty; synthetic guest marker remained present. |

The harness originally returned a hard-coded locked result for one revoked write; root replaced it with an actual workspace call before this run. The first browser load also exposed an undefined `process` reference; root configured the isolated bundle with an empty environment before seeding. Neither failed setup attempt counts as acceptance evidence.

Both test tabs were closed and the harness server stopped after verification. `npm run typecheck` passed with the harness files present.

## Limits and remaining gates

This proves actual browser IndexedDB operations, cross-tab notice receipt, durable stale-writer rejection and persistence after reload for these modules. It does not prove the entire app's Clerk/React sign-out/deletion integration, hosted provider deletion, stalled-tab delivery, private offline reopening, installed-PWA behavior, or other browsers. The preserved marker is a synthetic namespace sentinel, not the full guest comparison/handoff flow. Account deletion remains unchecked in the release task list.
