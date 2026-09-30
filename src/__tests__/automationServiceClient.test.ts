import { M2MTokenError, M2MTokenSource } from "@v-m-pioneer-trading/introspection-client";
import { AutomationServiceClient, AutomationServiceError } from "../automationServiceClient";
import { AutomationServiceStub, TEST_TOKEN, makeKnob, startAutomationServiceStub, staticTokenSource } from "../testSupport/testStubs";

describe("AutomationServiceClient machine token", () => {
  let automationService: AutomationServiceStub;

  afterEach(async () => {
    await automationService?.close();
  });

  it("sends the source's token as a bearer header on every kind of request", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    const client = new AutomationServiceClient(automationService.url, staticTokenSource());

    await client.getKnobs(); // GET, no body
    await client.setKnob("mine.failureRetryLimit", 5); // PUT with body
    await client.triggerReplan(); // POST, no body
    await client.appendEvent("ai_no_action", { rationale: "r" }); // POST with body

    expect(automationService.authorizations).toEqual(Array(4).fill(`Bearer ${TEST_TOKEN}`));
  });

  it("asks the source once per call, so a refreshed token is used on the next request", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    let n = 0;
    const tokens: M2MTokenSource = { getToken: async () => `token-${++n}` };
    const client = new AutomationServiceClient(automationService.url, tokens);

    await client.getKnobs();
    await client.getKnobs();

    expect(automationService.authorizations).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it.each([
    ["a plain object", () => ({ authorization: "Bearer forged", "X-Extra": "1" })],
    ["a Headers instance", () => new Headers({ authorization: "Bearer forged", "X-Extra": "1" })],
  ])("keeps other headers from %s but never lets a lower-case authorization join or replace the real one", async (_name, make) => {
    automationService = startAutomationServiceStub([makeKnob()]);
    const client = new AutomationServiceClient(automationService.url, staticTokenSource());

    // call() is private; reach it the way the public methods do.
    await (client as unknown as { call: (p: string, i: RequestInit) => Promise<unknown> }).call("/planner/knobs", {
      headers: make(),
    });

    // One value, not "Bearer forged, Bearer <token>".
    expect(automationService.authorizations).toEqual([`Bearer ${TEST_TOKEN}`]);
    expect(automationService.extraHeaders).toEqual(["1"]);
  });

  it.each([401, 403])("surfaces a %i from automation-service as an AutomationServiceError", async (status) => {
    automationService = startAutomationServiceStub([makeKnob()]);
    automationService.rejectWith = { status, message: "nope" };
    const client = new AutomationServiceClient(automationService.url, staticTokenSource());

    const err = await client.getKnobs().catch((e) => e);

    expect(err).toBeInstanceOf(AutomationServiceError);
    expect(err.status).toBe(status);
    expect(err.message).toBe("nope");
  });

  it("propagates a token failure and sends no request", async () => {
    automationService = startAutomationServiceStub([makeKnob()]);
    const tokens: M2MTokenSource = {
      getToken: async () => {
        throw new M2MTokenError("unavailable", "center down");
      },
    };
    const client = new AutomationServiceClient(automationService.url, tokens);

    await expect(client.getKnobs()).rejects.toBeInstanceOf(M2MTokenError);
    expect(automationService.authorizations).toEqual([]);
  });
});
