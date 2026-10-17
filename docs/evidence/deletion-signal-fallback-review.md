# Deletion notification fallback review

17 September 2026. Local dirty checkout on `codex/truecost-production`, base `b9e53c00219f778294a904e9b3175a9bb5bb26c2`. No deployment performed.

The deletion publisher could open a BroadcastChannel even though an existing local subscriber had failed to open its channel. Successful publishing then skipped local callbacks. Storage events do not notify their originating document, leaving that subscriber unlocked.

A regression test reproduced the missing callback: 1 failed, 7 passed. The publisher now always delivers locally. Each receiving subscription revokes once, so channel and storage delivery cannot duplicate that callback. Account matching, current-lifetime checks and teardown checks remain in the receiver.

After the fix, `npx vitest run tests/deletion-signal.test.ts tests/deletion-cleanup.test.ts` passed 13 tests across two files. Coverage includes a captured publisher used after its sender was revoked, another session of the same account, foreign accounts and subscription teardown.

These are isolated browser-environment tests. Mounted account deletion, reload recovery and real multi-tab provider behavior remain unverified; this evidence does not complete TASK-014.

## Mounted auth integration

A further test mounts the actual AuthShell with mocked Clerk/Convex providers. A foreign profile signal leaves membership unchanged. A matching storage signal removes the member identity without calling Clerk sign-out; a subsequent stale active-profile notification cannot restore it. Switching to account B establishes B's membership, and another account-A deletion signal cannot revoke B.

`npx vitest run lib/auth/__tests__/mounted.test.tsx tests/deletion-signal.test.ts` passed 33 tests. This establishes the mounted auth response to the signal, not a complete deletion UI or live multi-tab provider flow.
