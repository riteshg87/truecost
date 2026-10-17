# Identity foundation verification

Verified: 15 September 2026  
Revision under test: `b9e53c00219f778294a904e9b3175a9bb5bb26c2` on
`codex/truecost-production`  
Scope: exact Clerk/Convex dependency metadata, minimal Convex identity profile,
and provider-independent backend tests

## Working-tree and runtime context

The checkout retained the root-owned modified `AGENTS.md` and `README.md`,
shared untracked `docs/`, `.agents/`, `skills-lock.json`, and the earlier
provider-independent `lib/contracts/` work. This slice added only the files
listed below, plus the `.gitignore` exception and placeholder `.env.example`.
No `.env.local` values were read or printed.

- Runtime: Node `v24.14.0`, npm `11.9.0` on Windows.
- Exact packages: `@clerk/nextjs@7.9.4`, `convex@1.45.0`,
  `convex-test@0.0.58`.
- Installation: `npm ci --no-audit --no-fund` completed successfully after
  repairing the partial package tree left by the first interrupted install.
  `npm ls @clerk/nextjs convex convex-test --depth=0` is clean.

## Implementation

- `convex/schema.ts` defines only `users`, with indexed `authKey` and
  `clerkSubject`, verified `active/deleting/deleted` status, and timestamps.
- `convex/auth.config.ts` configures Clerk's issuer from
  `CLERK_JWT_ISSUER_DOMAIN`, audience `convex`, and throws when the issuer is
  missing.
- `convex/users.ts` exposes `currentUser` and `ensureCurrentUser`. Both use
  `ctx.auth.getUserIdentity()` and derive ownership from the verified
  `tokenIdentifier`; neither accepts an owner argument. Reads use the indexed
  `.unique()` lookup, so an unexpected duplicate fails closed. Inactive rows
  are denied generically and never reactivated. Returned profiles include only
  the safe ID, status, and timestamps.
- `convex/_generated/` contains local API, server, and data-model bindings.
- `.env.example` contains empty placeholders only and is explicitly unignored
  in `.gitignore`.

The authorized command `npx convex codegen --init --typecheck enable` was run
with a temporary `CONVEX_DEPLOYMENT=dev:dutiful-fly-37` process variable so the
CLI could locate the development project. It exited successfully after
generating bindings and typechecking. Its output also said “Uploading
functions to Convex”; this observed CLI behavior is recorded for root review.
No `convex dev` or `convex deploy` command was run, and this report does not
claim a real-provider authentication proof.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Convex identity tests | PASS | `npm test -- --run tests/convex-users.test.ts`; 5/5 tests. |
| Full test suite | PASS | `npm test -- --run`; 155/155 tests in 13 files. |
| Convex TypeScript check | PASS | `npx tsc --noEmit`. |
| Application typecheck | PASS | `npm run typecheck`; Next route type generation and `tsc --noEmit`. |
| Production build | PASS | `npm run build`; 17 static routes generated. |
| Scope/diff check | PASS | `git diff --check`; only line-ending warnings for existing text files. |

The mock tests cover anonymous denial, two-account isolation, same subject with
different issuers, idempotent provisioning, inactive-profile blocking, forged
owner arguments, and omission of `authKey`, `clerkSubject`, and email from the
projection. `convex-test` is provider-independent; Clerk email-code delivery,
JWT validation against the configured issuer, and a real Convex two-account
smoke test were not established by the worker's local tests. The additional
development checks below record what root subsequently verified.

## Root review and development verification

Root inspected the final schema, auth configuration, functions, argument/return validators, generated API and tests using the Convex review checklist. Re-ran the five identity tests successfully. Owner lookup uses a verified token identifier, indexed unique reads and transactional provisioning; the public projection excludes Clerk identifiers and contact details.

The installed Convex 1.45.0 source explains the codegen output: `runCodegen` calls `startComponentsPushAndCodegen`, which uploads for analysis/type generation, but does not call the final deployment step. Before any root sync, an anonymous query to `users:currentUser` reported that the function was not active. This distinguishes remote code analysis from activated application functions.

Root then ran `convex dev --once --typecheck enable --tail-logs disable`, explicitly bound to `dev:dutiful-fly-37`. The CLI identified the approved `rajesh-shinde:truecost:dev/rajesh-shinde` deployment, reported functions ready and exited zero. Local Clerk key values were compared before/after without printing them and remained unchanged. `.env.local` remains ignored. No production deployment was invoked.

Observed checks against `https://dutiful-fly-37.convex.cloud` after sync:

- Anonymous `users:currentUser`: denied by the deployed authentication check.
- Anonymous `users:ensureCurrentUser`: denied by the deployed authentication check.
- An invalid test token: rejected.

These initial checks prove development activation and unauthenticated denial. The subsequent signed-identity checks below cover valid sessions, two disposable accounts, expiry and concurrent provisioning. TASK-005 and TASK-006 are still open. A separate read-only CLI login-status command previously printed successful login then hit a Windows libuv shutdown assertion; the subsequent development sync exited cleanly.

## Signed development identity checks

Root used Clerk's documented development testing session API through the installed backend SDK. Credentials were read only from the ignored local configuration, checked against the expected development issuer/deployment and never printed. Two disposable `+clerk_test@example.com` users supplied real Clerk-signed session tokens with audience `convex`. No email delivery, password, authentication bypass or production instance was used.

| Check against approved development deployment | Observed result |
| --- | --- |
| Valid Clerk issuer and audience | Token accepted; active safe profile returned |
| Six simultaneous provisions for account A | All returned the same profile ID |
| Account B provision and own-profile read | Different ID from A; each account read its own profile |
| Profile projection | Only safe ID, status and creation/update timestamps; no email or raw provider identity |
| B supplying A's ID through forged owner arguments | Both read and provision rejected by argument validation |
| Expired genuine signed token | After token expiry plus six seconds, a fresh client request was denied |
| Temporary session cleanup | Both testing sessions revoked; verification process exited zero |

Only the two synthetic users and minimal profiles remain for subsequent development checks. No financial records were created. These checks establish provider-backed profile authorization, not arbitrary-record access control, browser OTP behavior, email delivery, recent-authentication grants or offline privacy. Those remain separate acceptance work.

Guidance used: [Clerk testing overview](https://clerk.com/docs/guides/development/testing/overview), [test emails](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), and the [official Backend API specification](https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml).

## Files owned by this slice

- `package.json`, `package-lock.json`
- `.gitignore`, `.env.example`
- `convex/schema.ts`, `convex/auth.config.ts`, `convex/users.ts`
- `convex/_generated/api.d.ts`, `convex/_generated/api.js`,
  `convex/_generated/dataModel.d.ts`, `convex/_generated/server.d.ts`,
  `convex/_generated/server.js`, `convex/tsconfig.json`
- `tests/convex-users.test.ts`
- `docs/identity-foundation-verification.md`

No layout, UI, service-worker, finance, store, contract, Supabase, or provider
dashboard code was changed in this slice.
