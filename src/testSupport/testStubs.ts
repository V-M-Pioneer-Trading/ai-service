import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { Knob } from "../automationServiceClient";
// Not itself a test file (moved out of __tests__/ so jest's default testMatch
// doesn't pick it up as one) — reusable stub servers shared by the actual
// __tests__/*.test.ts files.

export interface AutomationServiceStub {
  url: string;
  knobs: Knob[];
  anomalies: unknown[];
  events: { type: string; detail: Record<string, unknown> }[];
  setKnobCalls: { name: string; value: number }[];
  replanCalls: number;
  close: () => Promise<void>;
}

export function startAutomationServiceStub(initialKnobs: Knob[]): AutomationServiceStub {
  const stub: AutomationServiceStub = {
    url: "",
    knobs: initialKnobs,
    anomalies: [],
    events: [],
    setKnobCalls: [],
    replanCalls: 0,
    close: async () => {},
  };

  const app = express();
  app.use(express.json());

  // Mirrors automation-service's own /api/automation/v1 mount.
  const apiRouter = express.Router();

  // Mirrors automation-service's class filter, which is what narrows the
  // supervisor's tool surface to policy knobs.
  apiRouter.get("/planner/knobs", (req, res) => {
    const requested = req.query.class;
    const knobs = requested === undefined ? stub.knobs : stub.knobs.filter((k) => k.class === requested);
    res.json({ knobs });
  });
  apiRouter.put("/planner/knobs/:name", (req, res) => {
    const knob = stub.knobs.find((k) => k.name === req.params.name);
    if (knob === undefined) {
      res.status(404).json({ error: { message: "unknown knob" } });
      return;
    }
    const value = req.body.value;
    if (value < knob.min || value > knob.max) {
      res.status(400).json({ error: { message: "out of range" } });
      return;
    }
    stub.setKnobCalls.push({ name: req.params.name, value });
    knob.value = value;
    res.json({ knob });
  });
  apiRouter.post("/planner/replan", (_req, res) => {
    stub.replanCalls++;
    res.json({ requested: true });
  });
  apiRouter.post("/events", (req, res) => {
    stub.events.push({ type: req.body.type, detail: req.body.detail ?? {} });
    res.status(201).json({ ok: true });
  });
  apiRouter.get("/metrics/context", (_req, res) => res.json({ rollups: [], events: [] }));
  apiRouter.get("/anomalies/digest", (_req, res) => res.json({ anomalies: stub.anomalies, events: [] }));

  app.use("/api/automation/v1", apiRouter);

  const server = http.createServer(app);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  stub.url = `http://localhost:${port}/api/automation/v1`;
  stub.close = () => new Promise((resolve) => server.close(() => resolve()));

  return stub;
}

export interface OpenAiTurn {
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface OpenAiStub {
  url: string;
  requests: unknown[];
  close: () => Promise<void>;
}

/** Replies with the next entry in `turns`, in order, one per POST /chat/completions call. */
export function startOpenAiStub(turns: OpenAiTurn[]): OpenAiStub {
  const stub: OpenAiStub = { url: "", requests: [], close: async () => {} };
  let callIndex = 0;

  const app = express();
  app.use(express.json());
  app.post("/chat/completions", (req, res) => {
    stub.requests.push(req.body);
    const turn = turns[Math.min(callIndex, turns.length - 1)];
    callIndex++;
    res.json({ choices: [{ message: { role: "assistant", ...turn } }] });
  });

  const server = http.createServer(app);
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  stub.url = `http://localhost:${port}`;
  stub.close = () => new Promise((resolve) => server.close(() => resolve()));

  return stub;
}

/** A policy knob by default — the only class the supervisor is allowed to write. */
export function makeKnob(overrides: Partial<Knob> = {}): Knob {
  return {
    name: "mine.failureRetryLimit",
    class: "policy",
    value: 3,
    default: 3,
    min: 1,
    max: 20,
    description: "Consecutive failures on one target before the planner gives up on it.",
    ...overrides,
  };
}

/** An alert threshold — listed for the model's context, never offered as a tool. */
export function makeAlertKnob(overrides: Partial<Knob> = {}): Knob {
  return makeKnob({
    name: "anomaly.errorRateThreshold",
    class: "alert",
    value: 0.1,
    default: 0.1,
    min: 0,
    max: 1,
    description: "Fraction of recent mining events that must be errors before the fleet is flagged as failing.",
    ...overrides,
  });
}
