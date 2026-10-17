# TrueCost development setup

Verified in the signed-in provider dashboards on 15 September 2026. These are fresh development resources under the user's chosen Google login. Production publishing and paid services remain unapproved.

## Clerk

- Personal workspace, Hobby plan; application **TrueCost**.
- Application ID: `app_3JNf42cZqBbIIrI0xuExUtr2XJh`.
- Development instance: `ins_3JNf41jvXpIlujiTrRm9phaZyc1`.
- [Development configuration](https://dashboard.clerk.com/apps/app_3JNf42cZqBbIIrI0xuExUtr2XJh/instances/ins_3JNf41jvXpIlujiTrRm9phaZyc1/integrations).
- Required email, verification by email code and email-code sign-in enabled. Email links are off. Password sign-up and adding a password are disabled and saved. Phone, username and Google social sign-in were disabled during creation. Google is the owner's dashboard login, not a TrueCost end-user sign-in method.
- Convex integration enabled. The setup page confirms the signed session token includes audience `convex`.
- Public issuer: `https://live-tarpon-2666.clerk.accounts.dev`.

No production instance was activated. Valid signed development sessions, expiry denial and backend profile isolation are verified below. Browser email-code sign-in, real delivery and cancellation remain untested.

## Convex

- Team: **Rajesh Shinde's team** (`rajesh-shinde`).
- Project: **TrueCost** (`truecost`). Existing unrelated project left untouched.
- Development deployment: **dutiful-fly-37**, reference `dev/rajesh-shinde`.
- [Development dashboard](https://dashboard.convex.dev/t/rajesh-shinde/truecost/dutiful-fly-37).
- Cloud endpoint: `https://dutiful-fly-37.convex.cloud`.
- HTTP endpoint: `https://dutiful-fly-37.convex.site`.
- Region: **US East, N. Virginia**, explicitly selected by the user after the Ireland option disclosed usage billing plus a 30% regional surcharge. No paid upgrade was selected. The team-wide region default was not changed.
- `CLERK_JWT_ISSUER_DOMAIN` saved in this deployment, pointing to the Clerk development issuer above.

The reviewed minimal identity functions were synced to this development deployment on 15 September 2026. Anonymous reads/provisioning and invalid tokens were denied. Two real Clerk-signed synthetic identities subsequently passed profile isolation, concurrent provisioning, forged-owner rejection and expired-token denial. Temporary sessions were revoked; synthetic users/profiles remain available for further checks. No backup/recovery proof exists yet. See [identity foundation evidence](identity-foundation-verification.md).

## Remaining implementation and proof

1. Local development configuration is saved in ignored `.env.local`. After requesting manual entry initially, the user explicitly asked the agent to copy and save the two existing TrueCost development keys. The Clerk dashboard's Quick copy control supplied both values; only the two Clerk lines were updated, their development format and saved equality were checked without printing them, and the existing Convex URL was preserved. The key was hidden again and the clipboard cleared. This verifies configuration transfer, not successful provider authentication.
2. SDK dependencies, minimal profiles and `convex/auth.config.ts` are installed and development-synced, with audience `convex`. Connect the app providers and replace the legacy demo sign-in while preserving guest access and account-safe storage.
3. Verify browser email-code sign-in and private financial-record authorization with disposable test data against `dutiful-fly-37`. The completed signed-token profile checks do not replace these flows.
4. Prove recent authentication for account export/deletion. Convex excludes Clerk's `fva` claim from `getUserIdentity`; do not assume it is available there. Keep the proposed server-verified bridge unimplemented until replay, owner and operation binding are proved.
5. Review production regions, retention, free-plan entitlements, backup/recovery and operating coverage before a real-user pilot. Monthly service budget is ₹0; Rajesh and Ritesh jointly own release, privacy, support and methodology review.

## Production domain dependency

The user confirmed that neither owner has a suitable domain available for TrueCost. [Clerk's production deployment guide](https://clerk.com/docs/guides/development/deployment/production) requires an owned domain and access to its DNS settings. Production Clerk activation therefore remains blocked under the current ₹0 setup. The existing Vercel reference URL is not evidence that this prerequisite is met. No purchase, DNS change or replacement authentication provider is authorized by this finding. Continue local/development work and present a concrete domain option before requesting any changed budget or publishing approval.

Official guidance checked: [Clerk integration](https://clerk.com/docs/guides/development/integrations/databases/convex), [Convex integration and factor verification age](https://docs.convex.dev/auth/clerk#factor-verification-age), [Clerk reverification](https://clerk.com/docs/guides/secure/reverification), and [Clerk CLI](https://clerk.com/docs/cli).

All IDs and endpoints above are configuration identifiers, not credentials. No secret key, OTP, session token or deployment-admin key belongs in this document.

## CLI access note

The Clerk CLI's workspace-wide authorization was not used to retrieve keys. After the user selected manual entry, the controlled authorization tab was denied. The waiting CLI nevertheless reported a completed login, so `clerk auth logout` was run and reported success, removing its locally stored credentials. Remote OAuth-grant revocation has not been verified. No `env pull`, application linking or initialization command was run. The later dashboard-to-file transfer followed the user's separate explicit request above.
