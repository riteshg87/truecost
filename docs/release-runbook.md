# TrueCost release, rollback and recovery runbook

**Status:** preparation only. No production command in this document has been run.

**Owners:** Rajesh and Ritesh own the release decision. Actual operator, backup operator, privacy reviewer, finance reviewer, incident owner and support owner remain to be named before a pilot.

## Candidate record

| Item | Current value | Gate |
| --- | --- | --- |
| Local candidate | `ydMzVTyEiY_q6uNn7FXx1` | Current checkout after the metadata-only history refresh. The 24-check history/report run, 32-check integrated flow, 8-check recovery flow, 70 provider-focused tests, full 1,059-test suite, typecheck and 19-route build pass. The earlier 2Bu3/LTKX history records remain historical in [the candidate manifest](evidence/release-candidate-manifest-2026-10-02.json). |
| Hosted review | `https://truecost-ebon.vercel.app/` | Development Clerk/Convex only. Do not treat it as production. |
| Offline shell | `8ecaf70f4be9b1ec` | Rebuild and record the final asset hash before release. |
| Analytics | Normal local configuration keeps Mixpanel disabled | Production token, region, consent, dashboard and deletion review remain open. |
| Release decision | `NO-GO pending evidence` | Do not publish until the launch checklist is signed. |

The manifest is the source of truth for this dirty checkout's build identity, evidence boundaries, open gates and actions that were deliberately not taken. The 1,061-test baseline and older 2Bu3/LTKX records remain tied to their recorded builds; they are not relabelled as `ydMzVTyEiY_q6uNn7FXx1`. Re-run the full preflight after any source change before requesting release approval.

## Pre-release hold point

1. Record the exact source revision, calculation version, schema version, environment names, deployment IDs and evidence register.
2. Confirm the production Vercel project, Clerk app, Convex deployment, Mixpanel project and Sentry project with their owners. Record region, plan, limits, support tier and billing owner. Do not create a project or change a plan from this runbook.
3. Confirm a domain with DNS access, Clerk origins and redirects, Convex issuer settings, webhook verification, email OTP delivery and environment separation. A preview URL is not production access.
4. Confirm a current Convex backup entitlement and the external deletion ledger location. The ledger must not be stored only in the database being restored.
5. Complete the finance, privacy, security, accessibility, recovery, support and provider evidence in [launch-checklist.md](launch-checklist.md). A missing human sign-off is a no-go.

## Local preflight

Run these from the approved final checkout after the source freeze. Save stdout, stderr, date, Node version and build ID in the evidence register.

```powershell
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run build:offline
git diff --check
```

Then run the agreed browser smoke suite against the exact candidate. Check anonymous comparison with cloud integrations disabled, authenticated save and report flows with development data, account isolation, sign-out cleanup, offline reload and the provider outage boundary. Do not use a test login to claim production access.

## Vercel release sequence

The commands below are an approval-gated operator script. They are references, not instructions to run now.

```powershell
# Link only after the owner confirms the exact Vercel project and scope.
vercel link

# Create a preview deployment and capture the returned URL.
vercel deploy

# Verify the preview before promotion.
vercel curl / --deployment <preview-url>
vercel logs --deployment <preview-url> --level error

# Publish only after the signed release decision.
vercel deploy --prod
vercel logs --environment production --status-code 5xx --since 5m
```

The preview must pass the browser smoke suite and the release checklist before the production command is approved. Record the production deployment URL and ID, then verify the canonical domain, redirects, Clerk return path, Convex requests, report download and anonymous calculation.

## Frontend rollback

Use the smallest recovery action that restores service and keeps the backend compatible with the last good client.

```powershell
# Confirm the incident in the production logs.
vercel logs --environment production --status-code 5xx --since 30m

# Return to the previous production deployment.
vercel rollback
vercel rollback status

# After the fix is reviewed, promote a known-good deployment if needed.
vercel promote <known-good-deployment-url>
vercel promote status
```

After rollback, verify anonymous calculation, public offline fallback, authenticated access boundaries and the absence of new client errors. Keep the failed deployment ID and incident evidence. Do not rollback the backend just to match an older client unless compatibility has been tested.

## Convex backend and data recovery

1. Deploy additive backend changes first only after the compatibility check proves that the current and candidate clients can read the schema and receipts.
2. Before any restore, take a fresh backup and preserve it with the incident record. Convex restore replaces deployment data, so record the selected backup, start/end times and operator.
3. Keep access blocked while the restored deployment is checked. Replay the external deletion ledger before reopening private access. An account deleted after the backup was created must remain deleted.
4. Verify row counts, ownership, idempotency receipts, queued writes, feedback and deletion state for synthetic accounts A and B. Record RPO and RTO against the approved 24-hour and 4-hour targets.
5. Prefer a forward code fix for an irreversible schema change. Restore data only for confirmed corruption, then preserve the pre-restore snapshot and reconcile writes since the recovery point.

The Convex dashboard backup and restore action is destructive. It does not restore application code, environment variables or scheduled functions, so those must come from the frozen source and provider configuration record.

## Stop conditions

Stop and keep the release at **NO-GO** when any of these occurs: wrong finance output, foreign-account access, false save acknowledgement, stale data returning after deletion, prohibited analytics payloads, an unverified restore, missing domain or email delivery, provider permission failure, a critical accessibility or performance defect, or missing reviewer approval.

## Authoritative references

- Vercel rollback: https://vercel.com/docs/cli/rollback
- Vercel production rollback guide: https://vercel.com/docs/deployments/rollback-production-deployment
- Vercel CLI deployment: https://vercel.com/docs/cli/deploying-from-cli
- Convex backup and restore: https://docs.convex.dev/database/backup-restore
- Convex deploy command: https://docs.convex.dev/cli/reference/deploy

This runbook prepares the operator path. It does not grant production access, change provider data, publish a deployment, or complete the launch gates.

## Evidence register boundary

The complete current TASK-001 through TASK-034 register is [task-status-2026-10-02.json](evidence/task-status-2026-10-02.json). The exact `ydMzVTyEiY_q6uNn7FXx1` candidate's analytics-disabled configuration is recorded separately from enabled development Mixpanel evidence; [the boundary diagnostic](evidence/analytics-mixpanel-browser-2026-10-02T15-14-51-585Z.json) sent zero provider requests. The local source-map scan covers public and .next/static; hosted and production checks remain approval-gated.

The local demo machine check is [demo-artifact-machine-check-2026-10-02.json](evidence/demo-artifact-machine-check-2026-10-02.json): one renderable one-pager page and two fully decoded 180.68-second video candidates. Human listening, caption review and submission approval remain open.

### Current full-suite rerun, 4 October 2026

The current checkout passed `npm test -- --maxWorkers=2`: 112 files and 1,063 tests in 61.48 seconds against build `1iwP4oc_H3NlGLD2I7W_j` at source revision `b9e53c00219f778294a904e9b3175a9bb5bb26c2`. The two expected JSDOM unsupported-navigation diagnostics did not affect the zero-exit result. Evidence: `docs/evidence/current-full-suite-rerun-2026-10-04.json`. Hosted provider ingestion, production configuration, installed-app and signed release gates stay open.

### Current MVP demo-flow evidence, 4 October 2026

The current source-equivalent build 1iwP4oc_H3NlGLD2I7W_j passed 17/17 disposable Chrome checks for the real MVP path, including guest comparison, email OTP return, save acknowledgement, history/detail, PDF parity, sign-out privacy and cleanup. A current 85.84-second redacted rehearsal was created from the raw capture; the 180-240 second final assembly and human review remain open. Evidence: docs/evidence/clerk-browser-mvp-demo-current-2026-10-04.json and docs/evidence/demo-edits/demo-capture-current-1iwP4oc_H3NlGLD2I7W_j-redaction.json.

### Current-build demo assembly, 4 October 2026

The current-build local assembly is [documented here](evidence/demo-edits/truecost-current-1iwP4oc_H3NlGLD2I7W_j-assembly.json). It contains 16:9 and 9:16 MP4 candidates, each 180.68 seconds, with the accepted narration and captions, and both outputs passed full decode. The [machine check](evidence/demo-assembly-machine-check-2026-10-04.json) also found zero black segments of at least 250 ms. The source revision and build are recorded in the assembly evidence. Full playback and listening, normal-playback caption review, reviewer access and final acceptance remain open. No upload, Runway or other external submission was made.
