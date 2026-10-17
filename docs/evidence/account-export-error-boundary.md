# Account export error boundary

17 September 2026, dirty TrueCost checkout. Root reproduced an information-exposure path in AccountExportAction: an exception from the grant exchange was rendered directly from Error.message. An injected synthetic email and provider trace appeared in the alert. The regression failed before the change (1 failed, 5 passed).

The catch now renders a fixed retry message. Account-change checks remain in place. Root added a cancelled-reverification test showing no approval request, grant exchange or export mutation starts and the button becomes usable again. This mocks the hook's cancellation return; it does not prove cancellation in the live Clerk modal.

After the fix, npx vitest run tests/account-export-ui.test.tsx tests/convex-account-export.test.ts passed 16 tests in two files. No production deployment or provider setting changed. Full export scope and browser acceptance remain separately tracked.

## Related PDF error boundary, 17 September

Root reproduced a similar renderer-detail exposure in useComparisonReport by strengthening the existing failure test. Before the fix, the hook returned the injected lender name in its user-visible error (1 failed, 14 passed). The UI now receives a fixed retry/print message, while analytics keeps its existing allowlisted category. Report lifecycle and core suites passed 22 tests after the change. Existing jsdom navigation warnings were non-fatal; actual browser PDF/print acceptance is separate.
