# Repo map: ai-service

AI supervisor. Receives automation-service anomaly webhooks, asks OpenAI (tool use) what to do, may write `policy` knobs within bounds and trigger replans. Never drives ships, holds no SpaceTraders token. Not deployed to production yet (V-M-Pioneer-Trading/meta#53).

| Path | Holds |
|---|---|
| `src/server.ts` | `GET /health`, `POST /webhooks/anomaly` |
| `src/supervisor.ts` | tool-use loop (`MAX_TOOL_ITERATIONS` 5) |
| `src/openaiClient.ts` | Chat Completions (`OPENAI_MODEL`, default gpt-4o-mini) |
| `src/automationServiceClient.ts` | knobs, digest, replan, events |
| `src/hourlyReviewScheduler.ts` | hourly review over a fixed 120-min digest window |
| `src/dedupe.ts` | in-memory dedupe by anomaly `id`; claim released on a thrown run |
| `src/startupToken.ts`, `src/config.ts` | M2M token from auth-service, env |

- Calls: automation-service, auth-service `POST /auth/v1/m2m-token`, OpenAI.
- Called by: automation-service (webhook).
- Port 3004. No DB. No CI, no ESLint. Dockerfile `node:22-alpine` with `npm install`; `engines` says ≥ 18.

## Reference docs

- `README.md` "Configuration": read when deploying.
- `README.md` "Flow", "What's forwarded to OpenAI": read when changing what the supervisor sends or does.
- `README.md` "Authenticating to automation-service": read when changing M2M.
