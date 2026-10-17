# Clerk flow verification

## Scope

TASK-005B adds the client-only Clerk v7.9.4 email-code flow and the verified
Convex member state. The implementation keeps comparison and guest arithmetic
available when provider configuration is missing or malformed. It adds only
the `currentUser.expectedSubject` and per-session `sessionMarker` consistency
guards in the existing Convex identity query. Loan store, comparison store,
service worker, and runtime provider dependencies are unchanged. The mounted
test harness adds pinned dev dependencies `@testing-library/react@16.3.3` and
`jsdom@26.1.0`.

## Implemented behavior

- `ClerkProvider` is rendered inside the document body, with
  `ConvexProviderWithClerk` directly below it when both public configuration
  values pass validation.
- Sign-in uses Clerk Core 3 `signIn.create({ identifier, signUpIfMissing })`
  and `signIn.emailCode.sendCode/verifyCode`. A transferable first attempt uses
  `signUp.create({ emailAddress, transfer: true })` and
  `signUp.verifications.sendEmailCode/verifyEmailCode`.
- New-user bot protection has a real `#clerk-captcha` mount on the sign-in and
  verification screens. No CAPTCHA bypass is present.
- The email stays in bounded tab session storage and memory. It is not placed
  in the URL, logs, or diagnostics. A reload with no live SDK flow gives an
  honest restart state.
- Verification is six digits, with labeled controls, paste support, visible
  errors, resend retry behavior, and request tokens that reject late sends and
  verifies. Cancellation increments the flow generation, so a deferred SDK
  response cannot navigate or activate a later attempt. Returned and thrown
  provider errors keep a resend recoverable, and a pending finalize task is an
  explicit blocked outcome. Clerk owns an already-started finalize side effect;
  a cancellation race suppresses its navigation and never reports success from
  the stale result. Provider error objects are mapped to stable copy.
- Finalize temporarily preserves the current flow while Clerk activates the
  session, so the identity effect cannot suppress the provider-owned navigate
  callback. A setup task returns the flow to a ready/retry state, and the
  verification page exposes its change-email restart path instead of claiming
  that the task completed. Verify page cleanup defers one microtask to survive
  React StrictMode's development probe, while a real unmount still cancels late
  work. Finalize ownership is tied to its request generation, so cancellation
  or an older completion cannot clear a newer finalize marker.
- Member state requires Clerk sign-in, a stable Convex authenticated session,
  an active current-user profile, and a matching current identity epoch. The
  profile is provisioned at most once per identity until the user explicitly
  retries. Live profile subscription updates surface inactive profiles without
  granting member access, and all async provisioning callbacks compare the
  current identity ref. The exposed `accountKey` is the opaque Convex profile
  id, not a raw identifier hash.
- `currentUser` receives the current Clerk subject as a cache-key consistency
  guard and Convex compares it with the verified `ctx.auth` subject before
  returning a profile. A per-session marker partitions the query cache across
  sign-out/sign-in cycles. The marker is not authority, and the query never
  accepts a client owner id as authority. Provisioning results are accepted
  only through this bound query subscription.
- `safeNext` allows supported app-relative paths and validated `action` /
  `requestId` intent parameters only. It rejects external URLs, protocol
  relative paths, backslashes, controls, encoded escapes, auth loops, and
  malformed intent values.
- `proxy.ts` installs `clerkMiddleware` only when both the decoded public Clerk
  key and the server secret pass validation; malformed, absent, or wrong-type
  config falls back to a pass-through proxy and the app keeps guest access with
  an account-unavailable message.
- Storage getters and writes are contained against `SecurityError` and quota
  failures. Pending records require exactly the known fields, a valid email,
  an allowlisted destination, and an expiry within the bounded fifteen-minute
  window. A storage failure gets a cryptographically generated volatile tab id;
  environments without secure randomness use an unavailable marker rather
  than a predictable pseudo-random identity.
- Member readiness also checks that the loaded Clerk user id matches the
  current Clerk identity. A lagging user object therefore remains outside the
  member surface until it catches up.

## Verification evidence

Environment: Windows, Node 24.14.0, Next.js 16.3.4, React 19.2.8, Clerk
Next.js 7.9.4, Convex 1.45.0, Vitest 5.0.0. Branch:
`codex/truecost-production`, revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2`
plus the working-tree changes listed by `git status`.

| Check | Result |
| --- | --- |
| Mounted auth lifecycle tests | 17 passed in 1 file |
| Auth/access focused tests | 56 passed in 6 files |
| Full Vitest suite | Root ran 212 tests across 22 files, all passed, on 16 September after the final auth/offline changes |
| `npm run typecheck` | Passed after the final mounted auth fixture corrections |
| `npm run build` | Passed at the auth/offline integration checkpoint: 17 generated pages and the proxy |
| `git diff --check` | Existing line-ending warnings only |

The focused tests cover hostile redirect values, safe intent query handling,
public key and Convex URL validation, provider error redaction, storage
failures and bounded pending records, deferred cancellation, stale identity
callbacks, and finalize error/task outcomes. The mounted tests additionally
exercise missing-server-config guest fallback, StrictMode setup and cleanup,
watch-before-provisioning ordering, watch-error retry, deferred send and
resend failures, identity switches, finalize races, current-task recovery, and
the sign-in-to-verify handoff, guest sign-in and sign-up activation, identity
switches, loaded-user/profile mismatch, cancellation during finalize, and the
actual current-task restart path. Mock and static checks do not
prove delivery of an email, a real OTP, CAPTCHA behavior, Clerk session
activation, or Convex production access.

These checks establish the local auth foundation. Actual email delivery and
the integrated browser flow remain separate acceptance checks.

## Remaining live checks

Root must run the real Clerk email OTP and signed-in browser checks after the
private-storage and service-worker cache safeguards land. Current known risks
are the existing global `truecost.loan.v1` read, Supabase loan synchronization,
global comparison state, and private-client integration with the new public-only worker.
Those records must remain intact while that next slice scopes and isolates
member storage. A suitable owned production domain is also still a release
dependency; development keys and development Convex remain the test target.

## 17 September 2026, 14:07 UK: hosted signed-in account observed

Environment: existing development review deployment https://truecost-ebon.vercel.app/account, Codex in-app browser with the user's existing authenticated browser state. No code, key, OTP or account data was entered or changed during this read-only check.

Expected: after identity verification, the private Account route renders the signed-in account rather than returning to sign-in or remaining on the verification screen.

Observed: initial page read showed “Verifying your account. A connection is needed to open private pages.” A subsequent accessibility read rendered Account, “Signed in as” with the user-provided Gmail account, the Sign out control and Saved comparisons link. Current loan was “None shown.” The temporary inspection tab was closed. The user had separately confirmed receipt of the latest sign-in email.

Result: PASS for email receipt (user report) and authenticated hosted Account rendering (direct browser observation). This does not prove every OTP failure/retry case, cloud save success, current local privacy/deletion behavior, production Clerk configuration or full TASK-005 acceptance. No account identifiers or OTP values are stored in this evidence.
