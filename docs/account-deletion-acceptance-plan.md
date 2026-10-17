# Account deletion acceptance run

Prepared 17 September 2026. TASK-014 is incomplete. This is a test plan, not execution evidence.

## Target and safety boundary

Use only the configured TrueCost development Clerk instance and Convex deployment after Astra reviews the integrated diff. Create separately identified synthetic accounts A and B for the run, using Clerk's documented reserved test-address route. Record only disposable user/record references needed for cleanup in local access-controlled evidence; never include OTPs, bearer credentials or financial payloads. Do not select existing real users from dashboard lists. No production configuration or publishing is part of this run.

## Required observations

| Case | Action | Evidence needed |
| --- | --- | --- |
| Complete owner flow | A saves a loan, comparison, feedback and dismissal; confirms account deletion and recent authentication | Accepted durable request; immediate denial using A's previously issued token; all application scopes empty; provider stages recorded separately |
| Foreign account | B holds independent saved records throughout A's deletion | B's records remain readable and unchanged; B cannot query A's progress or submit A's grant |
| Lost acknowledgement | Interrupt the response after acceptance, then retry the same request and grant in the same session | One owner job, stable replay, no second side effect, progress survives component unmount |
| Browser cleanup after revocation | Revoke private access by accepting deletion before local cleanup resolves | Captured A partition can still be erased; no grant is restored; B's new session and data survive |
| Storage failure | Fail one local cleanup transaction after server acceptance; then retry | Explicit cleanup-pending state; no account-deleted claim; successful later removal and revoked old writer generation |
| Another tab | Keep A's private comparison and loan open in a second tab, including an offline tab | Drafts and report URLs removed, analytics stopped, queued writes cannot repopulate deleted data; verify fallback without BroadcastChannel |
| Provider ambiguity | Simulate an accepted Mixpanel POST whose response is lost | Durable needs-attention state; no automatic duplicate create; Clerk not deleted prematurely |
| Provider confirmation | Persist Mixpanel tracking ID, observe exact successful status, then remove synthetic Clerk identity | No completion on acceptance alone; no credentials or raw provider responses exposed |
| Worker interruption | Stop or delay an executing job until its lease expires | Safe polling/Clerk retries recover; stale responses cannot overwrite a newer attempt; ambiguous create requires reconciliation |
| Authentication cancellation | Cancel recent-auth challenge or switch accounts during it | No deletion accepted and no other account cleanup |
| Restoration | Restore a snapshot predating deletion in an isolated recovery environment | Access stays closed until the external deletion ledger is replayed; simulated tests alone do not close TASK-019 |

## Evidence boundaries

Transport mocks prove response handling. Convex unit tests prove the modeled transactions. Neither proves actual provider cleanup, delivered webhooks, deletion of a Mixpanel identity cluster or recovery of a deployed scheduler. Record these as separate pass/fail/not-run results. A provider credential that is missing leaves provider verification not run; do not silently skip the stage and mark completion.

Clerk identity deletion ends the session. The UI must distinguish the last server-confirmed state from a later signed-out state; loss of authentication alone is not proof that every provider or browser copy has been removed. Keep minimal job/recovery evidence until its retention policy is approved.

## Development configuration preflight, 17 September

Root inspected only presence/type in .env.local and used the installed CLI's `npx convex env list --names-only` (exit 0). No secret values were printed. Local Clerk publishable key is development; local Clerk secret and Convex URL are present. The development Convex deployment currently lists only CLERK_JWT_ISSUER_DOMAIN, TRUECOST_PRIVACY_AUDIENCE and TRUECOST_PRIVACY_VERIFICATION_KEYS.

Consequently live deletion needs CLERK_SECRET_KEY, CLERK_WEBHOOK_SIGNING_SECRET, TRUECOST_MIXPANEL_PROJECT_TOKEN and TRUECOST_MIXPANEL_PRIVACY_API_TOKEN configured in that development backend. The latter three are also absent from .env.local. This is observed missing configuration, not proof that no provider account holds those credentials. Reuse authorized development resources; configure only after integrated review and do not select real users for testing. Local tests remain separate from provider evidence.
