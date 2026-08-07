import request from "supertest";
import { createApp } from "../server";
import { ServiceConfig } from "../config";
import { AutomationServiceStub, OpenAiStub, makeAlertKnob, makeKnob, startAutomationServiceStub, startOpenAiStub } from "../testSupport/testStubs";

function makeConfig(automationServiceUrl: string, openaiBaseUrl: string, overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    port: 0,
    automationServiceUrl,
    openaiApiKey: "test-key",
    openaiBaseUrl,
    openaiModel: "gpt-test",
    maxToolIterations: 5,
    hourlyReviewIntervalMs: 3_600_000,
    ...overrides,
  };
}

function makeAnomalyPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "anomaly-1",
    type: "consecutive_failures",
    dedupeKey: "consecutive_failures:MINING-1",
    detectedAt: "2026-07-19T00:00:00Z",
    detail: { shipSymbol: "MINING-1", failureCount: 5 },
    ...overrides,
  };
}

describe("ai-service webhook boundary", () => {
  let automationService: AutomationServiceStub;
  let openai: OpenAiStub;

  afterEach(async () => {
    await automationService?.close();
    await openai?.close();
  });

  it("runs the supervisor loop, applies an in-bounds knob write, and logs an ai_intervention rationale", async () => {
    automationService = startAutomationServiceStub([makeKnob({ value: 3, min: 1, max: 20 })]);
    openai = startOpenAiStub([
      {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "set_knob",
              arguments: JSON.stringify({ name: "mine.failureRetryLimit", value: 5 }),
            },
          },
        ],
      },
      { content: "Raised the failure limit because this looks like a transient market blip." },
    ]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.setKnobCalls).toEqual([{ name: "mine.failureRetryLimit", value: 5 }]);
    expect(automationService.events).toHaveLength(1);
    expect(automationService.events[0].type).toBe("ai_intervention");
    expect(automationService.events[0].detail).toMatchObject({ anomalyId: "anomaly-1" });
  });

  it("refuses an out-of-bounds knob write without ever calling automation-service's PUT endpoint", async () => {
    automationService = startAutomationServiceStub([makeKnob({ value: 3, min: 1, max: 20 })]);
    openai = startOpenAiStub([
      {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "set_knob",
              arguments: JSON.stringify({ name: "mine.failureRetryLimit", value: 500 }),
            },
          },
        ],
      },
      { content: "Attempted a change but it was out of bounds; taking no further action." },
    ]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.setKnobCalls).toHaveLength(0);
    // A refused-only action set is not an intervention — nothing about the
    // fleet's configuration actually changed.
    expect(automationService.events).toHaveLength(1);
    expect(automationService.events[0].type).toBe("ai_no_action");
  });

  /**
   * The reason knobs have classes at all. `anomaly.errorRateThreshold` can
   * legally be set to 1, which would stop the error-rate check ever firing
   * again — a perfectly in-bounds way for the supervisor to make its own alarm
   * go away instead of addressing what tripped it. It must be unreachable.
   */
  it("refuses to write an alert threshold, so it cannot silence the alarm it is responding to", async () => {
    automationService = startAutomationServiceStub([makeKnob(), makeAlertKnob()]);
    openai = startOpenAiStub([
      {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "set_knob",
              // In bounds for that knob, and would permanently disable the check.
              arguments: JSON.stringify({ name: "anomaly.errorRateThreshold", value: 1 }),
            },
          },
        ],
      },
      { content: "Could not adjust the threshold; leaving it for an operator." },
    ]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));
    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.setKnobCalls).toHaveLength(0);
    expect(automationService.events[0].type).toBe("ai_no_action");
    const actions = (automationService.events[0].detail as { actions: { reason?: string }[] }).actions;
    expect(actions[0].reason).toContain("not a policy knob");
  });

  it("only offers policy knobs as tool options, while still showing the model every knob for context", async () => {
    automationService = startAutomationServiceStub([makeKnob(), makeAlertKnob()]);
    openai = startOpenAiStub([{ content: "Nothing to do." }]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));
    await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    const sent = openai.requests[0] as {
      tools: { function: { name: string; parameters: { properties: { name: { enum: string[] } } } } }[];
      messages: { role: string; content: string }[];
    };
    const setKnob = sent.tools.find((t) => t.function.name === "set_knob");
    expect(setKnob?.function.parameters.properties.name.enum).toEqual(["mine.failureRetryLimit"]);

    // The alert knob is still in the context the model reads — it just isn't
    // something the model can act on.
    const context = sent.messages.find((m) => m.role === "user")?.content ?? "";
    expect(context).toContain("anomaly.errorRateThreshold");
  });

  it("logs ai_no_action when the model takes no tool calls at all", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    openai = startOpenAiStub([{ content: "Nothing here warrants a knob change or a replan." }]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.setKnobCalls).toHaveLength(0);
    expect(automationService.replanCalls).toBe(0);
    expect(automationService.events).toHaveLength(1);
    expect(automationService.events[0].type).toBe("ai_no_action");
  });

  it("logs a non-empty fallback rationale even when the model's final message has empty content", async () => {
    automationService = startAutomationServiceStub([makeKnob({ value: 3, min: 1, max: 20 })]);
    openai = startOpenAiStub([
      {
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "set_knob",
              arguments: JSON.stringify({ name: "mine.failureRetryLimit", value: 5 }),
            },
          },
        ],
      },
      { content: "" },
    ]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.events[0].type).toBe("ai_intervention");
    expect(automationService.events[0].detail.rationale).toBeTruthy();
  });

  it("dedupes a webhook redelivery of the same anomaly id — only one supervisor run", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    openai = startOpenAiStub([{ content: "No action needed." }]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));
    const payload = makeAnomalyPayload();

    const first = await request(app).post("/webhooks/anomaly").send(payload);
    const second = await request(app).post("/webhooks/anomaly").send(payload);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ deduped: true });
    expect(automationService.events).toHaveLength(1);
    expect(openai.requests).toHaveLength(1);
  });

  it("rejects a malformed anomaly payload with 400 before ever calling automation-service or OpenAI", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    openai = startOpenAiStub([{ content: "unused" }]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send({ type: "consecutive_failures" });

    expect(res.status).toBe(400);
    expect(automationService.events).toHaveLength(0);
    expect(openai.requests).toHaveLength(0);
  });

  it("triggers a replan when the model calls trigger_replan", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    openai = startOpenAiStub([
      {
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "trigger_replan", arguments: "{}" } }],
      },
      { content: "Requested a replan since the fleet's assignments look stale." },
    ]);

    const { app } = createApp(makeConfig(automationService.url, openai.url));

    const res = await request(app).post("/webhooks/anomaly").send(makeAnomalyPayload());

    expect(res.status).toBe(202);
    expect(automationService.replanCalls).toBe(1);
    expect(automationService.events[0].type).toBe("ai_intervention");
  });
});
