# ai-service

Anomaly-triggered OpenAI supervisor loop for the SpaceTraders fleet
([meta#19](https://github.com/V-M-Pioneer-Trading/meta/issues/19)). Receives
anomaly webhooks from [automation-service](https://github.com/V-M-Pioneer-Trading/automation-service),
composes context, and runs a bounded OpenAI tool-use loop whose only real-world
effects are a knob write within its declared bounds and/or a fleet replan
trigger. The AI never drives ships directly, and when this service is down or
erroring, the fleet keeps operating on its current knob values.

## Flow

1. `POST /webhooks/anomaly` receives `{id, type, dedupeKey, detectedAt, detail}`
   (the same payload shape automation-service's `WebhookDelivery` sends).
2. The anomaly `id` is claimed via an in-memory dedupe set — automation-service
   retries webhook delivery up to 3 times on a non-2xx response, so the same
   anomaly can legitimately arrive here more than once. **Note**: this dedupes
   on the anomaly's `id`, not its `dedupeKey`. automation-service's own
   `dedupeKey` suppresses a condition from *re-firing* at the source; this
   dedupe is about idempotent *delivery* of one already-fired anomaly. Two
   distinct anomaly ids that happen to share a `dedupeKey` (not expected given
   automation-service's cooldown, but not structurally prevented) would each
   get their own supervisor run.
3. The supervisor fetches current knobs, recent metrics rollups, and the
   anomaly digest from automation-service, then runs a tool-calling loop
   (`OPENAI_MODEL`, capped at `MAX_TOOL_ITERATIONS` round-trips) where the
   model may call:
   - `set_knob(name, value)` — refused locally (never reaching automation-service)
     if `value` falls outside that knob's declared `[min, max]`, or if `name`
     isn't a real knob.
   - `trigger_replan()` — requests a fleet replan via `POST /planner/replan`.
4. Once the model returns a final message with no further tool calls (or the
   iteration cap is hit), the run's outcome is logged via `POST /events` on
   automation-service: `ai_intervention` if anything was actually applied,
   `ai_no_action` otherwise — always with a non-empty `rationale`.

## Hourly review

`HourlyReviewScheduler` re-pulls automation-service's anomaly digest on an
interval (`HOURLY_REVIEW_INTERVAL_MS`, default one hour) and runs the
supervisor for anything the dedupe set hasn't already claimed — the safety net
for a webhook that never arrived (or arrived while this service was down). A
supervisor run that throws releases its dedupe claim so the failure is retried
next time, rather than being silently treated as "handled" forever.

**v1 simplification**: each review pulls a fixed 120-minute digest window with
no persisted "since last review" state. An anomaly this service never saw
(webhook lost, and more than 120 minutes of downtime before the next review)
ages out of that window before it's ever claimed, and is never reprocessed —
there's no unbounded backlog scan. Acceptable for the expected downtime
profile of a single-instance deployment; would need persisted review-cursor
state to close this gap for longer outages.

## Configuration

| Env var | Meaning |
|---|---|
| `PORT` | Listen port (default `3004`) |
| `AUTOMATION_SERVICE_URL` | e.g. `http://automation-service:3003` (required) |
| `OPENAI_API_KEY` | OpenAI API key (required) |
| `OPENAI_BASE_URL` | Chat Completions API base URL (default `https://api.openai.com/v1`; overridable for tests/self-hosted-compatible endpoints) |
| `OPENAI_MODEL` | Model name (default `gpt-4o-mini`) |
| `MAX_TOOL_ITERATIONS` | Cap on tool-call round-trips per supervisor run (default `5`) |
| `HOURLY_REVIEW_INTERVAL_MS` | Digest re-pull cadence (default `3600000`) |

## What's forwarded to OpenAI, and what isn't

The context blob sent to the model includes the triggering anomaly, current
knob values, recent metrics rollups, and the anomaly digest's own (already
`NOTABLE_EVENT_TYPES`-filtered) events — deliberately **not**
`GET /metrics/context`'s unfiltered event list, which has no type restriction
and would forward every event's `detail` off-box on every anomaly with no
redaction beyond automation-service's own "never log token-shaped values"
convention. `POST /events` is restricted server-side to the `ai_` type
namespace, so this service can log its own rationale but can never spoof a
lifecycle/planner event type.

This service never holds a SpaceTraders token — automation-service's admin API
(which this calls) is itself unauthenticated by design, same posture
command-interface already relies on.

## Develop

No database — dedupe state and everything else here is in-memory (see the
hourly-review v1 simplification above). Tests stub both automation-service and
the OpenAI API with local HTTP servers and drive the real Express app through
`POST /webhooks/anomaly` via supertest.

```bash
npm install
npm test        # jest + supertest through the webhook boundary, stub HTTP servers
npm run dev      # build + start (needs AUTOMATION_SERVICE_URL + OPENAI_API_KEY)
```
