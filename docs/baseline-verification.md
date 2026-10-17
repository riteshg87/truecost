# TASK-001 baseline verification

Verified: 15 September 2026  
Working branch: `codex/truecost-production`  
Task: [TASK-001](product-roadmap.md)

## Revision and working-tree record

- Old local revision: `2cf936a` (`main`), two commits behind the refreshed
  `origin/main`.
- Refreshed remote revision: `b9e53c00219f778294a904e9b3175a9bb5bb26c2`.
- New local revision: `b9e53c0`, reached with `git merge --ff-only origin/main`.
- Integrated upstream commits: `557dcb1` (feature naming) and `b9e53c0`
  (email-only sign-in entry and disclosed local demo OTP fallback).
- Initial dirty context: modified `AGENTS.md` and untracked `docs/` files.
- Final dirty context: modified `AGENTS.md`, this baseline correction in
  `README.md`, and the shared untracked `docs/` files. `package-lock.json` and
  application source are unchanged by this task. No commit, push, deployment,
  provider account change, Supabase data change or upload was performed.

The branch was created from the dirty local checkout, so the existing local
instructions and documentation remained present while the application commits
were fast-forwarded. The removed Next.js agent notice was not reinserted by the
build: `AGENTS.md` contains no `nextjs-agent-rules`, `This is NOT the Next.js`,
or `generate-agent-files` marker.

## Runtime and dependency baseline

| Item | Observed value |
| --- | --- |
| Node | `v24.14.0` |
| npm | `11.9.0` |
| `.nvmrc` | `24` |
| Next.js | `16.3.4` |
| React / React DOM | `19.2.8` / `19.2.8` |
| TypeScript | `5.9.3` |
| Vitest | `5.0.0` |
| Supabase SSR / client | `0.12.7` / `2.116.0` |

After the completed installation, root confirmed readable bundled Next guides,
including `dist/docs/01-app/01-getting-started/01-installation.md` and
`02-project-structure.md`. The worker's earlier empty-directory observation was
superseded by this post-install inspection. No framework code changed for
TASK-001; read the relevant installed guides before framework implementation.

`npm ci --no-audit --no-fund` completed with exit code 0 and installed 88
packages in approximately six minutes. A first invocation did not return a
reliable completion signal and left a partial tree; `npm ls` exposed that state,
so the locked install was rerun. The final `npm ls --depth=0 --omit=optional`
resolved every declared dependency without an unmet package.

## Required checks

| Command | Result | Observed evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | Next route types generated successfully; `tsc --noEmit` exited 0. |
| `npm test` | PASS | 10 test files passed; 137 of 137 tests passed; Vitest duration 3.37s. |
| `npm run build` | PASS | Next 16.3.4 Turbopack build compiled successfully, finished TypeScript, generated 17 of 17 static pages, and exited 0. |

The build enumerated these static routes: `/`, `/_not-found`, `/account`,
`/compare`, `/compare/results`, `/home`, `/loan`, `/loan/rate`,
`/loan/setup`, `/loan/transfer`, `/manifest.webmanifest`, `/prepay`,
`/signin`, `/verify`, `/icon.png`, and `/apple-icon.png`. `npm run dev` was
intentionally not started for this baseline.

## Architecture status relevant to the next slices

- The finance engine remains pure and local under `lib/finance/`, with
  comparison, validation, effective-rate, insurance-premium and formatting
  logic covered by the test suite.
- Loan health, transfer, prepayment and tax calculations remain present under
  `lib/health/` and `lib/prepay/`; README limits now describe their explicit
  assumptions instead of claiming that prepayment is absent.
- Comparison and saved-loan state are currently device stores (`lib/store.tsx`
  and `lib/loanStore.tsx`). They are not yet Convex-backed private records.
- Authentication uses the existing Supabase adapter when configured and a
  clearly disclosed on-device demo OTP fallback when it is not. The fallback
  proves neither email ownership nor production membership.
- The PWA manifest and service worker are present, but the public-only cache
  policy and private-cache isolation remain unverified release work.

## README corrections made

`README.md` now records the observed 137-test/10-file baseline, identifies the
local demo sign-in and absent cloud persistence, and describes the implemented
prepayment flow and its assumptions. These corrections keep the setup and
limitations section aligned with the integrated source and this verification.

## Open blockers and next dependency

TASK-001 establishes a reproducible local build, but it does not establish
production readiness. The next blockers are the real Clerk email OTP path,
server-derived Convex ownership and persistence, and the post-first-comparison
auth gate for save/download/new or changed-input recalculation. Mixpanel,
client PDF, feedback, account lifecycle, recovery, and the service-worker cache
policy remain later release work. The disclosed demo fallback must be disabled
for production acceptance.
