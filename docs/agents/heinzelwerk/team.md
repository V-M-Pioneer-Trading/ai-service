# Team rules

How heinzelwerk agents work in this repo. Mode rules (single repo vs workspace) live in the `heinzelwerk:team-modes` skill. This file holds only what is specific to this repo.

- **Role**: backend (Node / TS / Express, no DB). AI supervisor: bounded policy-knob writes and replans; never drives ships
- **Backend paths**: `src/`, `Dockerfile`
- **Worktree setup**: `npm ci --no-audit --no-fund`
- **Checks** (validator runs every one, in order; this repo has no CI and no lint script):
  1. `npm audit --audit-level=high`
  2. `npm run typecheck --silent`
  3. `npm test --silent -- --silent`
- **Security**: no secret scan runs yet: gitleaks is not installed and no pre-commit hook exists (planned: `gitleaks git --pre-commit --staged` in `.git/hooks/pre-commit`), so check every diff for secrets by eye · dependency audit in checks
- **Coding standards**: none written: smell baseline only; `README.md` holds the boundary rules
- **Risk areas** (validator reviews diffs touching these on Opus):
  - `POST /webhooks/anomaly` (`src/server.ts`) is unauthenticated: anyone who reaches :3004 triggers OpenAI spend and policy-knob writes and replans under the service's M2M token; dedupe keys on the caller-chosen `id`; the error handler echoes `err.message`
  - what reaches OpenAI (`src/openaiClient.ts`, `src/supervisor.ts`): the anomaly's `detail`, all knobs, the metrics rollups and events of `NOTABLE_EVENT_TYPES`; raw `/metrics/context` events stay on the box
  - knob writes: `policy` class only, enforced three times (tool enum, local refusal, automation-service); bounded by `[min,max]`
  - `OPENAI_API_KEY`, `AUTH_M2M_CALLER_SECRET`: never logged
- **Contracts**:
  - consumer of automation-service knobs / digest / replan / events; provider of `POST /webhooks/anomaly` (payload owned by automation-service)
  - consumer of auth-service `POST /auth/v1/m2m-token`, through `@v-m-pioneer-trading/introspection-client` 1.2.0 (the predecessor of clerk-client, pinned by release-tarball URL)
