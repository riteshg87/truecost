# Deletion after analytics withdrawal

17 September 2026, local dirty TrueCost checkout based on `b9e53c00219f778294a904e9b3175a9bb5bb26c2`.

An account may withdraw analytics consent before requesting account deletion. The public preference correctly hides its analytics identifier after withdrawal, but deletion still needs the retained server identifier to remove earlier events.

A Convex integration test now seeds a previously consented synthetic identifier, invokes the real `analytics:setPreference` mutation to decline consent, verifies the public result has no identifier or send permission, then invokes `accountDeletion:requestDeletion`. The durable job retains the original identifier and selects `mixpanel_create_pending` rather than skipping directly to Clerk deletion.

`npx vitest run tests/convex-account-deletion.test.ts`: 6 passed. Source inspection confirms the deletion mutation reads the backing preference row, rather than the public redacted result. No live Mixpanel request was made; deletion of actual provider data remains unverified.
