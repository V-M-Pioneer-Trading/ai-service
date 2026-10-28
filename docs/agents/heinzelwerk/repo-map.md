# Repo map: ai-service

Facts verified against origin/main 0377480 on 2026-10-27, each with `path:line`. Line numbers drift: open the file before relying on one.

1. PURPOSE: Anomaly-triggered OpenAI supervisor loop; may only write policy knobs and trigger replan on automation-service: package.json:4, README.md:3-9
2. ENTRY POINTS
- GET /health -> {status:"ok"}; no auth: src/server.ts:44-46
- POST /webhooks/anomaly (body {id,type,dedupeKey,detectedAt,detail?}; 400 invalid, 200 {deduped:true} repeat id, 202 {rationale,actions}, 500 {error:{message}}): src/server.ts:55-84, 16-26, 86-88
- No other routes; no auth middleware (only express.json at src/server.ts:30)
- Process entry: src/server.ts:93-104 (config, central M2M token source, startup token fetch, then hourly scheduler + listen)
3. UNAUTHENTICATED: /health (src/server.ts:44) and /webhooks/anomaly (src/server.ts:55): no credential check. Anyone reaching the port can trigger a paid OpenAI run plus knob writes/replan; each fresh `id` is a new run (src/server.ts:69). introspection-client used only for outbound M2M token (src/server.ts:2, 95).
4. MONEY / SPEND
- No game credits moved; never holds a SpaceTraders token: README.md:107.
- OpenAI Chat Completions POST {OPENAI_BASE_URL}/chat/completions, Bearer OPENAI_API_KEY: src/openaiClient.ts:38-51. Defaults https://api.openai.com/v1, gpt-4o-mini: src/config.ts:49-50
- Up to MAX_TOOL_ITERATIONS (default 5) calls per run: src/config.ts:51, src/supervisor.ts:117-118. One run per new anomaly id from webhook (src/server.ts:69-76) and per unclaimed digest anomaly each hourly tick (src/hourlyReviewScheduler.ts:56-61).
- Dedupe in-memory; failed run releases claim, so retries re-bill: src/dedupe.ts:18-32; src/server.ts:80, src/hourlyReviewScheduler.ts:68. Knob writes/replan already applied before a failure (e.g. appendEvent) repeat on retry: src/supervisor.ts:130-138, 150-155
- Indirect game writes: PUT /planner/knobs/:name, POST /planner/replan: src/automationServiceClient.ts:98-108
5. CALLS / CALLED BY
- automation-service via AUTOMATION_SERVICE_URL: src/config.ts:45, README.md:86. Paths GET /planner/knobs, GET /planner/knobs?class=policy, PUT /planner/knobs/:name, POST /planner/replan, POST /events, GET /metrics/context, GET /anomalies/digest?windowMinutes=: src/automationServiceClient.ts:83,94,99,107,111,118,122
- auth-service POST /auth/v1/m2m-token via AUTH_M2M_TOKEN_URL + AUTH_M2M_CALLER_SECRET: src/config.ts:46-47, src/server.ts:95, README.md:87-88. Bearer on every automation call: src/automationServiceClient.ts:69-76
- Called by automation-service WebhookDelivery (retries up to 3): src/server.ts:48-50, src/dedupe.ts:3-4; self-timer src/hourlyReviewScheduler.ts:34
- Intended scopes events:write, planner:advise don't exist yet (meta#59, auth-service#11): README.md:119-125.
6. BUILD: npm install (README.md:145); npm run build / start / dev / typecheck, npm test (jest): package.json:9-15. Required env AUTOMATION_SERVICE_URL, AUTH_M2M_TOKEN_URL, AUTH_M2M_CALLER_SECRET, OPENAI_API_KEY: src/config.ts:45-48; PORT default 3004 etc src/config.ts:44,49-52. Node >=18: package.json:7. Docker node:22-alpine, EXPOSE 3004: Dockerfile:1,9,15-16
7. CI: .github/workflows/heinzelwerk-checks.yml, one job `test` on pull_request and push to main: npm ci, typecheck, build, test (no audit while meta#119 is open, no deploy). No lint config, no eslint dep: package.json:16-29.
8. PERSISTENCE: none; dedupe in-memory Set, no eviction: src/dedupe.ts:8-15.
9. PATTERNS: direct fetch clients, OpenAI baseUrl overridable (src/openaiClient.ts:29-36); asyncHandler (src/server.ts:11-14); createApp factory (src/server.ts:28,90); three-gate policy-knob guard (src/supervisor.ts:43-48, 187-209); local HTTP stubs + supertest (src/testSupport/testStubs.ts:26,110; src/__tests__/webhook.test.ts:1); never log token/secret (src/startupToken.ts:5-10, 23-26)
10. TRAPS: webhook unauthenticated; dedupe keyed on id not dedupeKey (src/server.ts:48-54); only metrics.rollups sent to OpenAI, never metrics events — don't "simplify" (src/supervisor.ts:105-111, README.md:97-105); hourly window fixed 120 min no cursor (src/hourlyReviewScheduler.ts:8, README.md:73-79); startup exits 1 only on unknown-caller M2M error (src/server.ts:98, src/startupToken.ts:19-27); single-instance (src/dedupe.ts:8-9); depends on introspection-client v1.2.0 tarball (old name of clerk-client) (package.json:17); supervisor digest 60 min vs scheduler 120 (src/supervisor.ts:98); trigger_replan unconditional (src/supervisor.ts:165-168); 500 echoes err.message, may include OpenAI error body (src/server.ts:87, src/openaiClient.ts:53-54)
11. DOCS: README.md only.

## Reference docs

- `README.md` "What's forwarded to OpenAI, and what isn't": read before changing the context sent off-box.
