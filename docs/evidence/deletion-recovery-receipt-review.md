# Deletion recovery receipt review

17 September 2026, local dirty TrueCost checkout, base `b9e53c00219f778294a904e9b3175a9bb5bb26c2`.

Luna implemented `accountDeletionRecovery:recoveryReceipt`. Astra inspected the query and its tests, then reran the recovery suite: 11 passed.

The query derives ownership from verified token identifier, subject and session. It matches the durable deletion job against the original request and grant and requires a deleting owner. It returns only request ID, owner ID and deletion status. It performs no writes or provider calls and does not restore access to private data.

Coverage includes each deletion status, a different session of the same subject, foreign identity, mismatched subject/token, wrong request/grant, active owner, missing identity/session, exact output fields and recovery after the sensitive grant row is removed.

This permits an authenticated original session to obtain the account partition for later browser-cleanup recovery. It does not implement that cleanup or establish recovery after Clerk has removed the session. UI journal wiring and live verification remain open. Nothing was deployed.
