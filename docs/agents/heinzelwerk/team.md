# Team rules

How heinzelwerk agents work in this repo. Mode rules (single repo vs workspace) live in the `heinzelwerk:team-modes` skill. This file holds only what is specific to this repo; the workspace is described in V-M-Pioneer-Trading/meta `docs/agents/heinzelwerk/workspace.md`.

- **Autonomy**: full. Agents merge and apply on their own; breakages are learnings. Secrets are never published (name the variable, never the value), and the gate never merges its own policy.
- **Role**: backend
- **Backend paths**: whole repo
- **Worktree setup**: `npm ci`
- **Checks** (validator runs every one, in order; copied from CI, quiet flags only):
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm audit --audit-level=high` (red on main: V-M-Pioneer-Trading/meta#119)
- **Checks verified on main**: 0377480 2026-10-27
- **Coding standards**: `CLAUDE.md` and the shared `@v-m-pioneer-trading/eslint-config`
- **Risk areas** (validator reviews diffs touching these on Opus):
  - `POST /webhooks/anomaly` in `src/server.ts`: unauthenticated; every new anomaly id starts a paid OpenAI run and knob writes
  - `src/openaiClient.ts`, `src/supervisor.ts`: paid API calls, up to MAX_TOOL_ITERATIONS per run; only metrics rollups leave the box
  - `src/dedupe.ts`: in-memory; a failed run is retried and billed again
  - `.github/workflows/**`: a merge to `main` deploys or releases
- **Contracts** (see team-modes **Contract changes**; validator checks every diff touching these):
  - automation-service routes it calls (`/planner/knobs`, `/planner/replan`, `/events`, `/metrics/context`, `/anomalies/digest`) · provider automation-service
