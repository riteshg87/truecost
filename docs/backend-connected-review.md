# Backend-connected review deployment

Status: deployment under the existing Rajesh Vercel plan is authorized. On 16 September, Rajesh confirmed that he upgraded the plan himself and instructed us to use it. No additional paid commitment is authorized. Deployment and hosted acceptance are pending; commit/push authorization remains separate.

## Why the public link still shows a demo

The published reference at https://truecost-lac.vercel.app/ serves the earlier flow. The baseline source at b9e53c00219f778294a904e9b3175a9bb5bb26c2 uses a local sign-in stand-in when Supabase is absent. The current uncommitted candidate instead uses Clerk email OTP and Convex, with private operations closed when configuration or identity is invalid. Local configuration contains Clerk and Convex development values; their presence does not change a Vercel deployment.

## Proposed review candidate

Build the reviewed local candidate with the existing approved development Clerk application and Convex deployment. Restrict use to synthetic review data and label it development. This is a real backend connection, separate from approval for a production pilot. Record the exact build ID and source manifest after final checks. The previous build ID is not a release-commit identifier.

Required hosting settings, without values in documentation:

| Setting | Scope | Purpose |
| --- | --- | --- |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | Browser | Existing TrueCost development Clerk app |
| CLERK_SECRET_KEY | Server secret | Same development Clerk app; never expose to client |
| NEXT_PUBLIC_CONVEX_URL | Browser | Approved TrueCost development deployment |
| NEXT_PUBLIC_ANALYTICS_ENABLED | Browser/build | Enable only after reviewed consent/payload checks |
| NEXT_PUBLIC_ANALYTICS_ENVIRONMENT | Browser/build | development |
| NEXT_PUBLIC_MIXPANEL_TOKEN | Browser/build | Existing TrueCost Development project only |

Convex must retain the matching Clerk issuer and reviewed functions. Sensitive account-action configuration listed in .env.example is still incomplete; account lifecycle acceptance is not established by the table above. Verify exact review origin, redirect behavior, email delivery, save/reopen, identity isolation and privacy flows on the actual hosted target after deployment.

## Remaining deployment prerequisites

- Record dashboard evidence for the existing `rvs006s-projects` Vercel project, its exact paid-plan tier and entitlements, and the currently signed-in account's access. The authorized local Vercel link records project `prj_FKQAIo7ASGxU22xBz1sJ1mAUmrb9` in team `team_rGwwmgySnD2pD34CRtOwxwUr`; the connected list-teams tool still returned an empty list on 16 September, so dashboard access and plan entitlements remain unverified through that connection.
- Finish candidate checks, including analytics and lifecycle requirements, and record an exact artifact/source manifest.
- Use the already-authorized target, record the exact candidate and verify hosted behavior before presenting it as usable. The new project has no earlier deployment to roll back to; preserve the old reference and withdraw a failed review deployment from use.
- Keep the production domain, exact Vercel paid-plan entitlements, production provider settings, methodology review and remaining launch gates separate and open.

Changing or hiding the demo label alone is not an acceptable backend integration.

### Deployment ownership clarified

The earlier reference is understood to belong to Ritesh. On 16 September the agent created a new truecost project under rvs006s-projects after the user authorized publication there. CLI project inspect confirms project prj_FKQAIo7ASGxU22xBz1sJ1mAUmrb9 in team team_rGwwmgySnD2pD34CRtOwxwUr. This new project is separate from the earlier public reference. The connected Vercel tool returned no teams, so that result is not dashboard evidence. The earlier ownership note did not itself authorize deployment; the current authorization is recorded in the publication section below.

### Publication direction updated

On 16 September, the user confirmed that they upgraded Vercel themselves and authorized deployment under the currently signed-in account to the existing `rvs006s-projects` paid plan. No additional purchase, add-on, automatic overage, or unrelated project change is authorized. This resolves the earlier Hobby-plan concern for the hosting target, subject to recording the exact tier, entitlements, account access, and project evidence from the dashboard. The requested hosted review remains a development deployment using the new Clerk and Convex development backends with synthetic data. It does not activate production Clerk/Convex resources or close the production pilot gates.

## Historical free commercial hosting assessment, 16 September 2026

This assessment predates the user's Vercel-only direction and is retained for context; it is not an approved migration path.

Recommended next candidate: Netlify Free, subject to an actual adapter build and hosted acceptance. Netlify explicitly permits commercial projects on its Free plan. Its current pricing has a hard 300-credit monthly limit, with no paid overage on Free; production deploys consume 15 credits each, and traffic/compute share the allowance. Sites pause when limits are exhausted, so this is a constrained pilot option, not guaranteed uninterrupted service. New Free public sites may carry a Netlify badge.

Sources: https://www.netlify.com/blog/introducing-netlify-free-plan/ ; https://www.netlify.com/pricing/ ; https://www.netlify.com/changelog/2026-08-19-pre-launch-toolbar-and-powered-by-netlify-badge/

Netlify's Next.js adapter supports App Router, route handlers, SSR, middleware and Turbopack. Source inspection found TrueCost proxy.ts uses Clerk middleware without direct filesystem/native-addon use, and next.config.ts sets service-worker/offline cache headers. This is a plausible fit, not proof: verify Clerk proxy execution, exact origin, privacy endpoint, Next cache behavior and PWA headers after adapter build. Do not upload .next as a plain static site or discard server routes to make hosting simpler.

Source: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/

Cloudflare Workers remains an alternative, but its OpenNext adaptation and free Worker resource limits need separate package-size/runtime validation; no migration is assumed. No Netlify account, site, Git integration, credential upload, paid plan or publication has been created by this assessment. At the time, the direction preserved ₹0 and requested assessment of an eligible free host. Production Clerk domain and remaining launch gates still apply regardless of frontend host.

### Latest hosting constraint: Vercel only

The user explicitly requires Vercel only. Netlify/Cloudflare assessment is historical and is not an approved migration. Preserve the existing `rvs006s-projects` paid-plan target and the restriction on additional spend. Other services remain within the accepted ₹0/free-plan budget; no add-on, automatic overage, or unrelated provider change is authorized. The development review and its hosted acceptance remain pending, and production domain/provider/release gates remain open.



## Actual first deployment, 16 September 2026
Vercel CLI assigned the new project's first deployment to its production target automatically even though --prod was not passed. Confirmed by inspect: dpl_28oJTdyPrea9YfNWjKccC9PqEBWZ, READY, alias https://truecost-ebon.vercel.app. Its remote compile, TypeScript and 19-page generation passed. Because only Preview environment settings had been populated, this first artifact does not establish a backend-connected deployment and must not be presented as the completed review link. Configuration for the actual hosting target and a replacement build are in progress, using development Clerk/Convex values. Production pilot acceptance remains NO-GO.

## Hosted acceptance result
The replacement deployment dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7 passed the actual hosted guest-to-member comparison flow, server save/read, history/detail, PDF download and scoped cleanup. See docs/evidence/clerk-browser-hosted.json (latest run also records the real hosted screen capture). Clerk test OTP was used, so inbox delivery is not established. The same public alias is the current development review link. Analytics remains off on this deployment; separate local guest test events reached the approved Mixpanel development project. Production domain, full account lifecycle, monitoring, provider retention and owner sign-off gates remain open.

### Current hosted OTP revalidation, 4 October 2026

A fresh run against the approved development alias `https://truecost-ebon.vercel.app/` and deployment `dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7` passed 12 Chrome 154 checks for Clerk SDK readiness, invalid and accepted synthetic OTP handling, account provisioning, explicit sign-out and disposable cleanup. Evidence: `docs/evidence/clerk-browser-hosted-current-2026-10-04.json`. The run does not prove source-candidate parity, comparison save/history/PDF behavior, production inbox delivery, provider reconciliation or release approval. The earlier full hosted comparison record remains historical and is preserved separately.
