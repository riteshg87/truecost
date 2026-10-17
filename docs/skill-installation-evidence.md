# Selected skill installation evidence

Verified: 15 September 2026  
Repository: `C:\Users\RajeshShinde\OneDrive - Electracom Projects (UK) Ltd\Documents\ChatGPT\truecost`  
Task scope: project-scoped setup for the four selected Michael Shimeles skills

## Source review

- Source repository: `https://github.com/michaelshimeles/skills`
- Immutable source revision: `513f8a24aae6383b00356fa285144b1bc3730dc1`
  (`main` at inspection time).
- Selected source paths: `new-feature/`, `code-structure/`,
  `evidence-driven-testing/`, and `before-and-after/`.
- `new-feature`, `code-structure`, and `evidence-driven-testing` contain their
  `SKILL.md` instructions. `evidence-driven-testing` also contains
  `scripts/evidence.py` and has no third-party Python imports; it requires
  Python 3 plus FFmpeg/ffprobe at runtime.
- `before-and-after` contains its `SKILL.md`, capture/upload shell scripts, and
  the three adapters (`0x0st`, `blob`, and `gist`). Its `LICENSE` is the
  PolyForm Shield License 1.0.0 and was preserved with the installed skill.
- No selected skill had a package manifest, requirements file, or additional
  install dependency in the inspected source tree.

The source tree was fetched and inspected at the pinned commit before
installation. No source instructions were executed as installation hooks.

## Existing installation check

Before installation, no matching `SKILL.md` existed in:

- the TrueCost project `.agents/skills/` directory (the directory was absent),
- `C:\Users\RajeshShinde\.codex\skills`, or
- `C:\Users\RajeshShinde\.agents\skills`.

## Installation and artifact verification

The reviewed installer was read from
`C:\Users\RajeshShinde\.codex\skills\.system\skill-installer\SKILL.md` and
its `install-skill-from-github.py` helper. The exact install command was:

```text
python C:\Users\RajeshShinde\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py --repo michaelshimeles/skills --path new-feature code-structure evidence-driven-testing before-and-after --ref 513f8a24aae6383b00356fa285144b1bc3730dc1 --dest .agents/skills --method auto
```

Result: exit code 0; all four skills installed under `.agents/skills/`.
The installed tree contains 11 source files. A read-only comparison against
the inspected source reported that all 11 files match after line-ending
normalization (the source clone used CRLF while the downloaded installation
used LF). No symlinks or extra files were found in the selected directories.

Installed paths:

- `.agents/skills/new-feature/SKILL.md`
- `.agents/skills/code-structure/SKILL.md`
- `.agents/skills/evidence-driven-testing/SKILL.md`
- `.agents/skills/evidence-driven-testing/scripts/evidence.py`
- `.agents/skills/before-and-after/SKILL.md`
- `.agents/skills/before-and-after/LICENSE`
- `.agents/skills/before-and-after/scripts/capture.sh`
- `.agents/skills/before-and-after/scripts/upload-and-copy.sh`
- `.agents/skills/before-and-after/scripts/adapters/0x0st.sh`
- `.agents/skills/before-and-after/scripts/adapters/blob.sh`
- `.agents/skills/before-and-after/scripts/adapters/gist.sh`

## Runtime preflight

`python --version` returned `Python 3.14.2`. Running the installed recorder's
read-only doctor command returned exit code 1 with `capture_ready: false`:

- FFmpeg: unavailable
- ffprobe: unavailable
- `libx264`: unavailable
- ASS subtitle filter: unavailable
- Windows `gdigrab`: unavailable

This blocks screen recording until the host provides those tools. The skill's
headless evidence route remains documented for later use. No synthetic test
recording, browser upload, public image host, `npx` recording, or global package
installation was performed.

## TrueCost adaptations and guardrails

- `new-feature`: adapt its fresh-worktree guidance to the assigned shared
  Codex checkout. Preserve existing untracked docs and teammate edits; do not
  reset, stash, overwrite, or replace `AGENTS.md`.
- `code-structure`: apply its actions/service distinction only where repeated
  mechanics justify extraction. In TrueCost, generic actions are not Convex
  actions; keep finance rules and Convex transaction semantics in their proper
  boundaries.
- `evidence-driven-testing`: retain exact revision, branch, environment and
  assertion evidence. Never expose secrets or private finance data, and use
  headless or local evidence when screen capture is unavailable.
- `before-and-after`: treat `--markdown` and its upload adapters as external
  writes that require explicit authorization. Keep captures local by default,
  do not disable browser security, do not start a dev server implicitly, and do
  not auto-commit, push, publish, or run Greptile.

No application source, `AGENTS.md`, `CLAUDE.md`, `docs/SKILLS.md`, or execution
log was edited by this setup task. The only owned changes are the four
project-scoped skill directories and this report.

