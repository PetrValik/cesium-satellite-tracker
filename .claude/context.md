# ORBITAL OPS — survives compaction (re-injected by the kit after /compact and on resume)
- Satellite/ship/aircraft tracker on a CesiumJS globe; npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`); live at orbit.irminsul.uk, a merge to `main` deploys.
- Trunk `main`; branch `feat|fix|chore|docs/<kebab>`, PR into main, merges are manual (a merge is a deploy).
- Check gate: `npm run lint && npm test`. Neither catches the two bugs that matter: a Cesium leak after minutes of runtime, a plausible wrong position — run it and watch.
- Cesium machinery stays out of React (`core/engine/`); every create has a destroy; km→m conversion happens exactly once.
- Specialists: `@cesium-engine`, `@orbital-mechanics`, `@hud-designer`; rule-set `frontend-slice-architecture` on `apps/web/src/features/**`.
- Per-module docs: `apps/web/src/features/*/CLAUDE.md`, `apps/web/src/core/engine/CLAUDE.md`, `apps/api/src/*/CLAUDE.md`.
