# Account deletion request review

17 September 2026. Local dirty checkout, base `b9e53c00219f778294a904e9b3175a9bb5bb26c2`. Luna implemented the coordinator; Astra inspected the submission/replay guards and reran its 13 tests successfully.

An accepted server deletion revokes private app access. If its response is lost, requiring that private grant again prevents recovery. The coordinator now checks the live Clerk subject and session independently for replay while retaining the original request/grant pair. Initial approval and submission still require current private access. A different subject or session cannot replay the request.

The tests cover explicit confirmation, cancelled approval, duplicate clicks, invalid request UUID before approval, account changes before and during submission, a lost response followed by revoked-access replay, captured former-account cleanup, cleanup retry without resubmission, and malformed server outcomes. Exceptions become fixed internal states rather than raw user-visible errors.

Command: `npx vitest run tests/deletion-request.test.ts`, 13 passed. These callbacks are simulated. The test suite does not establish a live Clerk challenge or Convex deletion.

The coordinator is memory-only. Account screen integration, survival across a full reload, real multi-tab cleanup and provider completion remain required. TASK-014 remains open and nothing was deployed.
