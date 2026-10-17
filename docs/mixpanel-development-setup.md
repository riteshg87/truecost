# Mixpanel development setup

Status: created and verified on 16 September 2026 under the user-approved scope. Local implementation remains authorized.

## Proposed action

Create one project named `TrueCost Development` in the user-selected Mixpanel account, on the Free plan, using US residency for disposable synthetic test events. Do not add billing details, enable paid options, invite anyone, create a production project or send real-user activity. If the console cannot provide this setup at no cost, leave creation pending.

The initial verification dataset will use only the approved event names and opaque synthetic identities. Keep autocapture, automatic pageviews, marketing capture, geolocation enrichment and session replay disabled. Application tracking stays off before explicit consent. Store the project token in local settings and keep administrative credentials out of source and chat.

Verify ingestion and the agreed funnel using independently counted test events. Clear the disposable events through the supported deletion procedure and retain its acknowledgement. Production region, retention and publication remain separate decisions.

## Verified facts and unresolved checks

Mixpanel currently advertises a Free plan with no credit card, up to one million events per month, funnels/retention and five saved reports per seat. This supports a small synthetic verification project, subject to checking the actual account plan. Source: [Mixpanel pricing](https://mixpanel.com/pricing/).

India residency must not be assumed free: the [Mixpanel DPA](https://mixpanel.com/legal/dpa/) describes India hosting as purchased. A documented India API endpoint alone does not establish free-plan eligibility. No paid residency is authorized.

Custom retention is advertised under Enterprise. The proposed 90-day production analytics retention is therefore unverified on the Free plan; it remains a launch decision rather than a promise in the privacy notice. No production event collection will be enabled on the strength of this proposal.

## Authorization boundary

Project creation needs the user's applicable approval under AGENTS.md. Local implementation and payload tests can continue without a provider project. This proposal does not change the ₹0 budget or choose a production region.


## Verified development project

Project: [TrueCost Development](https://mixpanel.com/project/4064154/view/4560599/app/home), ID 4064154, view 4560599. Created in the existing TRUE Cost organization with US storage and Asia/Kolkata reporting timezone. The existing TRUE Cost project (4064149) was preserved. The organization Plan Details screen showed Free Plan, up to 1M tracked events, and 0 events tracked. No billing details, paid upgrade, invitations or production project were added. The development ingestion token is now stored in ignored .env.local with NEXT_PUBLIC_ANALYTICS_ENABLED=false. SDK wiring and guest ingestion were subsequently verified; see the dated evidence below and analytics-plan.md for the still-open member verification. Initial organization onboarding returned an already-created-organization error; opening the normal login entry reached the existing organization, so no duplicate organization was created.


The project Identity Merge settings explicitly show Simplified ID Merge API. Project Overview confirmed US residency, Asia/Kolkata timezone, zero events and zero profiles before local token configuration. No identity-setting changes were made. Configuration is a build-time control; changes require rebuilding clients, and user consent remains a separate mandatory gate.


## 17 September 2026: provider access and ingestion recheck

Parent opened the existing TrueCost Development project4064154/view4560599 through the signed-in in-app browser. The saved synthetic board remained accessible. Events showed0 results forToday and2 results with7D selected (Sep10-Sep17, GMT+5:30): comparison_started and comparison_completed from one device identity, both one day old. City, country and operating system columns were unset. No new events, project, report, settings, subscription or sharing were created in this check. This confirms continued access to the historic guest synthetic sample; it does not verify member/save/PDF/feedback events or demonstrate a pilot outcome. TASK015 remains open. The temporary verification tab was marked for continued work.

### 17 September 2026: member-verification preparation

Parent read the existing project settings: project4064154, US, Asia/Kolkata, event count2 and profile count0. The observed dashboard token SHA256 is 3563aba5fa027db27e293f807c44004a8292dbc2c61ed12c3f409fa396ccfb65; the ignored local token matches. No token value was recorded. Preparing a development-only analytics-enabled build using process environment overrides; .env.local and hosted tracking remain unchanged. A new combined synthetic member harness is in progress, not yet run or accepted.
