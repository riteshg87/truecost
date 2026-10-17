# Clerk skills installation evidence

Date: 15 September 2026. User request: `npx skills add clerk/skills`.

## Result

Installed 20 public Clerk skills in this TrueCost project's `.agents/skills/` for Codex using copy mode. Verified all 141 installed files against the reviewed source checkout, allowing only CRLF/LF normalization: zero missing or changed files. The CLI also created `skills-lock.json`. Existing custom skills were preserved, and no global installation was requested.

Source: https://github.com/clerk/skills at `7523bd34543de745eed93b29acdf114d33404dfd`. Official npm installer: `skills@1.5.26`, repository `vercel-labs/skills`. The source README and skill frontmatter declare MIT; no separate LICENSE file was present in the inspected checkout. Source notices remain intact.

The executed equivalent of the user's command pinned both installer and reviewed repository revision, limited the target to Codex in the current project, and selected only the public `skills/` subtree:

```powershell
npx --offline --yes skills@1.5.26 add https://github.com/clerk/skills/tree/7523bd34543de745eed93b29acdf114d33404dfd/skills --skill '*' --agent codex --copy --yes --json
```

`--offline` applies to npm's cached installer lookup; the skills CLI fetched the specified repository. Its exit code was zero. The two maintainer audit skills outside the public subtree were not installed. No template application or bundled API script was executed.

## Review and use boundaries

Inspected the router, setup guidance, public skill metadata and the API execution helper. The helper can source environment files and perform writes/deletes; the API skill explicitly says agents should not use that helper. Installation authorizes no Clerk account mutation. Preserve TrueCost's existing development app, manually transferred local keys and the user's choice against workspace-wide Clerk CLI access. Never expose key values in output.

The installer reported third-party scan labels, but those do not prove all skill instructions or scripts safe. Apply the user's current scope over defaults, read the selected skill before using it and review any proposed API action separately. The installed roster and TrueCost sequence are in [SKILLS.md](SKILLS.md). Skills are available for discovery on the next turn; this run can explicitly read their local files already.
