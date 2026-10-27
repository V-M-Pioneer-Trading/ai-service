# Team rules

How heinzelwerk agents work in this repo. Mode rules (single repo vs workspace) live in the `heinzelwerk:team-modes` skill. This file holds only what is specific to this repo.

- **Role**: backend (Node / TS / Express, no DB). AI supervisor: bounded policy-knob writes and replans; never drives ships
- **Backend paths**: `src/`, `Dockerfile`
- **Worktree setup**: `npm ci --no-audit --no-fund`
- **Checks** (validator runs every one, in order; this repo has no CI and no lint script):
  1. `npm audit --audit-level=high`
  2. `npm run typecheck --silent`
  3. `npm test --silent -- --silent`
- **Security**: gitleaks pre-commit hook (`gitleaks git --pre-commit --staged` in `.git/hooks/pre-commit`, so every worktree runs it) · dependency audit in checks
- **Coding standards**: none written: smell baseline only; `README.md` holds the boundary rules
- **Risk areas** (validator reviews diffs touching these on Opus):
  - what reaches OpenAI (`src/openaiClient.ts`, `src/supervisor.ts`): `NOTABLE_EVENT_TYPES` only; raw `/metrics/context` events stay on the box
  - knob writes: `policy` class only, enforced three times (tool enum, local refusal, automation-service); bounded by `[min,max]`
  - `OPENAI_API_KEY`, `AUTH_M2M_CALLER_SECRET`: never logged
- **Contracts**:
  - consumer of automation-service knobs / digest / replan / events; provider of `POST /webhooks/anomaly` (payload owned by automation-service)
  - consumer of auth-service `POST /auth/v1/m2m-token`
