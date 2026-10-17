# Dependency advisory audit: 16 September 2026

Environment: local TrueCost dirty worktree, branch codex/truecost-production. Commands run against the existing installed project and npm lockfile; no dependency changes made.

- npm audit --omit=dev --json: exit 0, zero reported advisories at all severities.
- npm audit --json: exit 0, zero reported advisories at all severities, including development dependencies.
- Reported dependency counts: production 119; development 167; optional 127; peer 43; total 350 (categories overlap).

This records npm's advisory response at the time of the check. It does not prove application authorization, provider configuration, absence of unknown vulnerabilities, or security of the deployed candidate. Account-deletion retry/fencing review is ongoing and production Clerk remains deferred.
