# Clerk deletion webhook local review

17 September 2026. Local dirty worktree on codex/truecost-production; base b9e53c00219f778294a904e9b3175a9bb5bb26c2. No webhook configuration or deployment occurred.

Astra inspected the route, signature boundary, transactional ingest, job startup and provisioning tombstone changes. Review fixes include a total five-second body deadline, non-blocking cancellation, strict UTF-8, and starting missing jobs for owners already marked deleting. User-requested deletion still checks the original grant, subject and Clerk session; webhook jobs have null grant/session and cannot pass that replay check.

Root added tests/webhook-body-deadline-review.test.ts. One stream never settles its cancel promise; another supplies a small chunk four seconds into the request. Both tests prove the handler settles by the total deadline and invokes cancellation. These tests were first run after Luna had applied the fix, so they are regression evidence, not a recorded failing-before result.

Root verification:

- 10:55:18 UK: deadline tests, 2 passed.
- 10:56:15 UK: deadline, webhook and receipt suites, 19 passed across three files. The command also named a nonexistent account-deletion.test.ts; it did not test the foundation suite.
- 10:56:34 UK: corrected convex-account-deletion.test.ts plus convex-users.test.ts, 12 passed across two files.

The webhook tests exercise signed payload verification, invalid signature/oversize rejection, job creation, duplicate delivery, prior job reuse, absent-owner tombstones and malformed internal arguments. Actual hosted ingress, configured secret, provider delivery, and scheduler execution remain unverified. Additional HTTP-route checks for missing secret and rejected requests causing no writes remain acceptance work. TASK-014 stays open.

## HTTP route verification, 17 September, 10:58 UK

Root added tests/clerk-webhook-route.test.ts and ran it directly: three tests passed. These use convex-test's actual HTTP router and transactional ingestion, not a mocked verifier. With a missing signing secret, a signed request returned 503 and all three deletion-related tables stayed empty. An invalid signature returned 400 with no writes. Two valid signed deliveries for the same absent subject returned 200 and produced exactly one receipt and one tombstone, with no owner job. This closes the local HTTP-route test gap noted above, but does not verify hosted ingress or provider delivery.

## Runtime compatibility note

The official [Convex runtime guide](https://docs.convex.dev/functions/runtimes), checked 17 September, lists Web Crypto support and explains deterministic query/mutation execution. This supports the chosen runtime, but local convex-test execution does not establish the hosted implementation of crypto.randomUUID. Confirm webhook job startup against the actual development runtime before acceptance. No production runtime behavior is inferred from Node tests.
