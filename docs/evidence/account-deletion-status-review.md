# Account deletion status boundary: local review

16 September 2026. Dirty worktree based on b9e53c00219f778294a904e9b3175a9bb5bb26c2; remote HEAD was checked and matched that commit.

Files: convex/accountDeletionStatus.ts and tests/account-deletion-status.test.ts.

The public query accepts no record, owner or job ID. It derives the owner from verified tokenIdentifier, checks the Clerk subject, requires a session ID, and reads the owner index. It deliberately permits the owner to inspect deletion progress while the normal profile is blocked. The return validator exposes only status, createdAt and updatedAt; worker tokens, grant/session identifiers and analytics identifiers stay internal.

Observed checks: the deleting owner receives the exact three-field result; another identity receives null; anonymous and missing-session requests are rejected; a mismatched subject/tokenIdentifier returns null. The focused test passed and npx tsc --noEmit exited 0.

Not yet proven: development-provider execution, route integration, status after Clerk removal, browser recovery or completed provider deletion. Existing status values stop at providers_pending; the provider orchestrator must extend both schema and public return validator together when more states are implemented.
