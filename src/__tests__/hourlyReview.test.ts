import { AutomationServiceClient } from "../automationServiceClient";
import { AnomalyDedupe } from "../dedupe";
import { HourlyReviewScheduler } from "../hourlyReviewScheduler";
import { OpenAiClient } from "../openaiClient";
import { Supervisor } from "../supervisor";
import { AutomationServiceStub, OpenAiStub, makeKnob, startAutomationServiceStub, startOpenAiStub } from "../testSupport/testStubs";

function anomaly(id: string) {
  return {
    id,
    type: "consecutive_failures",
    dedupeKey: `consecutive_failures:${id}`,
    detectedAt: "2026-07-19T00:00:00Z",
    detail: {},
  };
}

describe("ai-service hourly review", () => {
  let automationService: AutomationServiceStub;
  let openai: OpenAiStub;

  afterEach(async () => {
    await automationService?.close();
    await openai?.close();
  });

  it("processes every unclaimed anomaly in the digest exactly once per tick, driven manually instead of the real interval", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    automationService.anomalies = [anomaly("a1"), anomaly("a2")];
    openai = startOpenAiStub([{ content: "No action needed." }]);

    const automationClient = new AutomationServiceClient(automationService.url);
    const openaiClient = new OpenAiClient("test-key", openai.url, "gpt-test");
    const dedupe = new AnomalyDedupe();
    const supervisor = new Supervisor(automationClient, openaiClient, 5);
    const scheduler = new HourlyReviewScheduler(automationClient, supervisor, dedupe, 3_600_000);

    await scheduler.tick();

    expect(automationService.events).toHaveLength(2);
    expect(dedupe.has("a1")).toBe(true);
    expect(dedupe.has("a2")).toBe(true);

    // A second tick sees the same two anomalies still in the digest window,
    // but both are already claimed — no new supervisor runs.
    await scheduler.tick();
    expect(automationService.events).toHaveLength(2);
  });

  it("releases the dedupe claim when a supervisor run fails, so the next tick retries it", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    automationService.anomalies = [anomaly("a1")];
    // No OpenAI stub started — the fetch to it will fail outright, simulating
    // a down/unreachable OpenAI API.
    const automationClient = new AutomationServiceClient(automationService.url);
    const openaiClient = new OpenAiClient("test-key", "http://127.0.0.1:1", "gpt-test");
    const dedupe = new AnomalyDedupe();
    const supervisor = new Supervisor(automationClient, openaiClient, 5);
    const errors: unknown[] = [];
    const scheduler = new HourlyReviewScheduler(automationClient, supervisor, dedupe, 3_600_000, (err) => errors.push(err));

    await scheduler.tick();

    expect(errors).toHaveLength(1);
    expect(dedupe.has("a1")).toBe(false);
    expect(automationService.events).toHaveLength(0);
  });
});
