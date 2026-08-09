# CLAUDE.md

Instructions for Claude when working in this repository. Loaded automatically every session.

---

## Skills and agents — REQUIRED before writing code

**You MUST invoke the Skill tool for the matching skill below, or dispatch the matching
agent, before doing the work — even for a one-line answer.** A rule-set read after the code
is written is not a rule-set. The imperative wording here is deliberate: a table that merely
lists task → skill was measured to change nothing.

| When you are about to…                                          | Invoke / dispatch            |
| ----------------------------------------------------------------- | ---------------------------- |
| touch the Cesium scene graph, viewer lifecycle, camera, primitives | `@cesium-engine` agent       |
| compute positions, TLEs, frames, ground tracks, passes             | `@orbital-mechanics` agent   |
| change anything visual in `apps/web` — panels, HUD, CSS, layout    | `@hud-designer` agent        |
| add or change a frontend feature slice under `src/features/`       | `frontend-slice-architecture` skill |
| write tests for a slice                                            | `frontend-testing` skill     |
| branch, commit, push, or open a PR                                 | `conventions` skill          |
| record finished work in the Obsidian vault                         | `second-brain` skill         |

The three repo-local agents in [`.claude/agents/`](.claude/agents/) exist because this repo's
two hardest failure modes are invisible to a generalist: a Cesium leak that only shows up
after ten minutes of runtime, and a frame/unit bug that produces plausible-looking but wrong
positions. Don't hand-roll either — dispatch the specialist.

---

## Project

**ORBITAL OPS** — a real-time satellite and vessel tracker rendering a full 3D globe in the
browser. npm-workspaces monorepo: `apps/web` (React 19 + Vite + CesiumJS + zustand),
`apps/api` (Node service), `packages/shared` (types shared by both). Satellite positions come
from SGP4 via `satellite.js`; AIS vessel data is optional and degrades cleanly without a key.

Deployed at **orbit.irminsul.uk** from a GHCR image onto the `cloud` box (`/opt/orbital-ops`,
docker network `web`) — see [`docs/DEPLOY.md`](docs/DEPLOY.md). The homelab monorepo carries
its Caddy block and Uptime Kuma monitor.

Key docs:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the vertical-slice rules reviews enforce
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — running it locally
- [`docs/API.md`](docs/API.md) · [`docs/CONTROLS.md`](docs/CONTROLS.md) · [`docs/DEPLOY.md`](docs/DEPLOY.md)

Machine-readable rules (commands, branch policy, risk paths, active packs) live in
`.claude/kit.profile.yaml`. Read it before proposing a command.

---

## Architecture — the rules that actually get enforced

A feature owns its UI, state, and domain logic in **one folder** under `src/features/`.
`docs/ARCHITECTURE.md` is authoritative; the two rules broken most often:

- **No cross-slice imports.** A slice reaches shared code through `core/` or
  `packages/shared`, never into a sibling slice's internals.
- **Cesium machinery stays out of React.** Viewer, camera rig, and primitive collections live
  in `core/engine/` as non-React code. A `useEffect` that news up Cesium objects per render is
  the leak this repo keeps re-learning.

Every Cesium resource created must have a matching destroy path. Per-frame allocation is a
bug at this object count, not a style preference.

---

## Language

All repo artefacts — code, comments, docs, commit messages, PR descriptions — are in
**English**. I write to you in Czech; keep artefacts English.

## Model

Sub-agents run on **`opus`** (the strongest available tier; the alias resolves to the current
Opus). Never set a weaker tier, and never write a dated model id into frontmatter — that is
what goes stale.

## Git workflow

- Branch from **`main`**; never commit directly to it.
- Branch names: `feat/<kebab>`, `fix/<kebab>`, `chore/<kebab>`, `docs/<kebab>`.
- Push the branch and open a PR into `main`. `ci.yml` gates it; `deploy.yml` rolls to the
  `cloud` box, so a merge is a deploy.
- Commit subject: `<type>(<scope>): <summary>` — ≤ 70 chars, imperative, lowercase after the
  colon, no trailing period. Scope is the workspace or slice (`web`, `api`, `shared`,
  `tracking`, `catalog`).
- Commit identity: `PetrValik <petrvalik15.7@gmail.com>`. **No `Co-Authored-By: Claude`** or
  any other AI-authorship marker, in commits or PR bodies.

## Verification

`npm run lint` and `npm test` from the root cover both workspaces. Neither catches the two
failure modes that matter here — a leak and a wrong-but-plausible position — so a change to
the engine or the propagator is verified by **running it and watching**, not by a green suite.

## Second brain

After completing a unit of work, write a note to
`~/Obsidian/SecondBrain/Agents/cesium-satellite-tracker/` in the format from the kit's
`second-brain` skill, and add a link line to that folder's `_index.md`. One note per completed
unit — not per turn.
