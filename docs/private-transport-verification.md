# Session-bound private requests

TASK-007 integration foundation, 16 September 2026. Implemented and locally tested; React integration and real-provider verification remain open.

`lib/private-storage/transport.ts` adapts the saved-loan API to the sync controller. Each request uses a new Convex HTTP client with one captured Clerk token. The adapter checks the current runtime identity before and after token acquisition, before network access and after the response. It compares the token's subject, session, audience and expiry against the captured context. These client checks prevent accidental credential mixing; Convex remains responsible for token verification and server-derived ownership.

Save payloads and identity are captured before the first asynchronous boundary. Requests omit browser credentials and disable caching and provider console logs. Network operations have a 15-second abort signal, including response-body consumption. Provider exception text never reaches the UI. A receipt must name the exact request, operation and expected next revision. Conflicts, deleted records and invalid receipts cannot become successful saves.

## Evidence

At dirty revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2`, `npx vitest run tests/private-transport.test.ts` passed **16/16 tests** at 02:01 BST. These use the actual Convex HTTP client with synthetic token claims and a substituted HTTP boundary. They cover request headers, subject/session/audience/expiry mismatch, account switching during token acquisition, late acknowledgement rejection, input mutation during an await, invalid receipts, conflict classification, deletion replay and safe errors.

The tests do not verify token signatures, actual Clerk delivery, cloud authorization or a mounted app. [Development saved-loan evidence](saved-loan-backend-verification.md) covers the backend separately. A combined browser and provider check must follow the React integration.

## Caller obligations

- Create a separate adapter/controller for each verified private lifetime. Compare subject, session, epoch and the local unlock generation in `isCurrent`.
- Obtain a Convex-audience token from Clerk: default session token for the enabled Convex integration, otherwise the configured `convex` template.
- Never restore an unlocked context solely from persisted account IDs or the browser's online flag. A cold reload requires online identity/profile verification.
- A request already sent under account A may finish on the server for account A. Its response must not update account B's view. Locking the UI cannot promise to retract a completed server operation.
