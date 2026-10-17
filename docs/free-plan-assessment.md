# TrueCost ₹0 service assessment

Checked 15 September 2026. The user selected free plans only and named Rajesh and Ritesh as joint release, privacy, support and financial-methodology owners. This is a launch feasibility review, not permission to buy, upgrade, publish or change provider accounts.

## Verified constraints

| Service | Current published entitlement or constraint | Consequence for TrueCost |
| --- | --- | --- |
| Clerk Hobby | Up to 50,000 monthly retained users and three dashboard seats; custom-domain support is included. [Pricing](https://clerk.com/pricing) | Email-code development can continue. A paid Clerk plan is not established as necessary for the pilot. |
| Clerk production | Requires an owned domain and DNS access. [Deployment prerequisites](https://clerk.com/docs/guides/development/deployment/production) | The user confirmed no suitable domain is available. Production activation remains blocked. Including custom-domain support in a plan does not supply a domain registration. |
| Convex Free | Free includes built-in resources; Starter can bill beyond included limits. [Pricing](https://www.convex.dev/pricing) | Keep the development project on the free plan with no paid usage upgrade. Check actual account limits before launch; a zero base price on Starter is not a zero-spend guarantee. |
| Convex recovery | Manual backups/export are supported. Periodic scheduled backups require Pro. Free/Starter stores up to two backups per deployment. Code, environment configuration and pending scheduled functions are excluded from data backups. [Backup guide](https://docs.convex.dev/database/backup-restore) | Test an operator-run export/restore process within free limits. Prove cadence, protected storage, deletion-ledger replay and measured recovery before accepting the proposed 24-hour RPO and four-hour RTO. An export command alone does not establish those targets. |
| Mixpanel Free | Up to one million monthly events and five saved reports per seat; unlimited seats shown. [Pricing](https://mixpanel.com/pricing/) | TASK-015 can target the actual Free plan, with a small report set. Keep session replay off even though the provider includes it. Account/project access, approved data region and real event/dashboard verification remain pending. |
| Vercel Hobby | Restricted to personal, non-commercial use. Exceeding free resource limits can pause service. [Plan documentation](https://vercel.com/docs/plans/hobby) | The user confirmed commercial use, so Hobby is unsuitable for launch. The actual reference deployment plan remains unverified. No upgrade or host move has occurred. |

## Free hosting candidate

Assess Netlify Free first as a possible alternative. Netlify explicitly permits [commercial projects on Free](https://www.netlify.com/blog/introducing-netlify-free-plan/); its current [credit-based documentation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) lists 300 credits/month with a hard cap and no auto-recharge. The same page allows only one team owner on Free. This is a candidate, not a verified deployment fit.

Before proposing a move, test the exact Next.js 16.3.4 candidate, Clerk proxy/callbacks, private response headers and offline assets through the supported adapter; inspect current terms, quota-exhaustion behavior and required branding. Review Rajesh/Ritesh operating access without shared credentials. Netlify's [current Next.js guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/) is the implementation starting point. A hosting subdomain does not remove Clerk's owned-domain prerequisite.

Rechecked 16 September 2026: the current credit-based Free plan still lists 300 credits per month. Published production deploys consume 15 credits each; traffic, bandwidth and function execution draw from the same allowance. Exhausting the allowance pauses projects until the next cycle unless the owner upgrades. This protects the ₹0 spending ceiling but creates an availability limit that Rajesh and Ritesh must accept before choosing this host. These terms describe new credit-based accounts; an existing legacy account needs its own check. No Netlify account, adapter installation or deployment has been created for this assessment.

The inspected adapter guide lists App Router, server components and middleware support, but notes that headers/redirects run after middleware and Node.js middleware cannot use filesystem or C++ addons. Those differences need explicit verification for this candidate's Clerk proxy and private-response headers. Published feature support alone is not deployment evidence.

Cloudflare is another possible investigation, but no compatibility verdict is recorded. Its current [Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) recommends a different runtime path; changing frameworks or adapters merely to obtain free hosting needs its own measured review. Do not add that migration to the active auth patch.

## Remaining checks

- Resolve a suitable owned domain without exceeding the approved budget, or prepare a concrete change for the owners to decide.
- Verify current Vercel plan and eligibility, provider regions, retention and account access.
- Prove a free monitoring/alert path. Sentry is proposed; free-plan entitlement and delivery to the named operators have not been verified.
- Set documented usage checks and a graceful response to provider limits. No automatic paid overage or upgrade.
- Check Chronicle/Runway credits, export rights and available tools before media generation. Neither a subscription nor paid credits are approved.

The app can continue through local and synthetic development verification now. Production publication remains a separate decision after these dependencies and the release evidence are complete.

Read-only account check: the connected Vercel tool returned no accessible teams, and this checkout has no .vercel/project.json link. The reference deployment's actual plan therefore remains unverified; no account or project settings were changed.
