# Connecting sign-in and private storage

The guest comparison works without provider credentials. Member routes use the
approved development Clerk application for email OTP and the approved Convex
deployment for account-owned data.

## Development environment

Copy `.env.example` to `.env.local` and fill the existing development values:

| Name | Scope |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser Clerk key |
| `CLERK_SECRET_KEY` | Server and Convex administration |
| `NEXT_PUBLIC_CONVEX_URL` | Browser Convex cloud URL |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex Clerk issuer |

Keep secret values out of source control. Do not use production identities or
real borrower data in local checks.

## Sign-in

Clerk email OTP is the only supported authentication method. Phone and SMS
authentication are deferred. The app keeps comparison intent through sign-in,
then writes private records through the account-bound Convex transport.

## Verify the local flow

1. Run `npm run dev` with the development values loaded.
2. Compare two offers as a guest.
3. Sign in with a disposable Clerk email code.
4. Save, reload, sign out, and confirm the private record is unavailable.
5. Use the browser verification scripts and evidence plans in `docs/` for
   authenticated, offline, deletion, and account-switch checks.

The old Supabase modules, schema, and dependencies are intentionally absent.
