# Team rules

How heinzelwerk agents work in this repo. Mode rules (single repo vs workspace) live in the `heinzelwerk:team-modes` skill. This file holds only what is specific to this repo.

- **Autonomy**: full. Agents merge and apply on their own; breakages are learnings. Secrets are never published (name the variable, never the value), and the gate never merges its own policy.
- **Backend paths**: whole repo (`src/`)
- **Worktree setup**: `npm ci`
- **Checks** (`.github/workflows/heinzelwerk-checks.yml`, added by heinzelwerk setup; the repo had no CI before):
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- **Checks verified on main**: 0377480 2026-10-28
- **Coding standards**: none (no lint config): smell baseline
- **Risk areas** (validator reviews diffs touching these on Opus):
  - `src/server.ts` `POST /webhooks/anomaly`: unauthenticated; each new anomaly `id` triggers a paid OpenAI run and knob writes/replan; the 500 handler echoes upstream error text to the caller
  - `src/openaiClient.ts`, `src/supervisor.ts`: OpenAI spend (up to `MAX_TOOL_ITERATIONS` calls per run) and the policy-only knob gates
  - Not deployed: no infrastructure stack and no CloudFront origin (V-M-Pioneer-Trading/meta#53)
- **Contracts** (see team-modes **Contract changes**):
  - Consumed: automation-service knobs, replan, `POST /events`, metrics, anomaly digest (`src/automationServiceClient.ts`) · provider automation-service; auth-service `POST /auth/v1/m2m-token` · provider auth-service; scopes `events:write planner:advise` (meta `auth-design.md` decision 22)
  - Shared package: `@v-m-pioneer-trading/introspection-client` 1.2.0, the pre-rename clerk-client (`package.json:17`) · provider clerk-client (V-M-Pioneer-Trading/meta#126)
