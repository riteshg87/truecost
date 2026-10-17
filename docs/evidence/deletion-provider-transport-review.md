# Deletion provider transport review

Checked 17 September 2026 in the dirty TrueCost checkout at HEAD b9e53c00219f778294a904e9b3175a9bb5bb26c2. Remote HEAD matched. No deployment or live provider deletion was performed.

Astra inspected convex/lib/deletionProviders.ts and tests/deletion-providers.test.ts after Luna's corrections. Mixpanel create responses retain a pending tracking ID even when marked SUCCESS; a later status request must confirm completion. Create timeouts and HTTP 408/5xx require reconciliation. Status polling and fixed-subject Clerk deletion can retry. Unexpected bodies, mismatched IDs and generic Clerk 404 responses cannot confirm deletion. Body size and request duration are bounded, and outputs exclude provider bodies and credentials.

Root verification: npx vitest run tests/deletion-providers.test.ts tests/prepay-dates.test.ts exited 0, with 40 tests across two files. Of these, 27 exercise transport behavior with injected responses and 13 exercise calendar arithmetic. These checks do not establish real provider deletion, merged analytics identity coverage, recovery after a deployed scheduler interruption, or complete account cleanup.

Next: durable provider orchestration, browser cleanup/status, synthetic development end-to-end checks and external deletion replay evidence. TASK-014 remains incomplete.
