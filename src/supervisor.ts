import { AutomationServiceClient, Anomaly, Knob } from "./automationServiceClient";
import { ChatMessage, OpenAiClient, ToolDefinition } from "./openaiClient";

export interface SupervisorAction {
  tool: "set_knob" | "trigger_replan";
  name?: string;
  value?: number;
  applied: boolean;
  reason?: string;
}

export interface SupervisorResult {
  rationale: string;
  actions: SupervisorAction[];
}

const SYSTEM_PROMPT = [
  "You are an automated supervisor for an unattended SpaceTraders mining fleet.",
  "You are given a fired anomaly plus recent fleet context (metrics rollups, recent",
  "events, current knob values). You may call set_knob to adjust a tunable planner",
  "or anomaly-detection knob within its declared [min, max] bounds, and/or",
  "trigger_replan to ask the fleet to re-plan its current assignments against the",
  "current knobs. These are your ONLY two effects on the world — you cannot drive",
  "ships directly. Prefer taking no action over a speculative change when the",
  "anomaly doesn't clearly call for one. When you are done (with or without taking",
  "any action), reply with a final plain-text message explaining your reasoning —",
  "that message is the audit-trail rationale for this run.",
].join(" ");

function buildTools(knobs: Knob[]): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "set_knob",
        description: "Set a planner or anomaly-detection knob to a new value, within its declared bounds.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", enum: knobs.map((k) => k.name) },
            value: { type: "number" },
          },
          required: ["name", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "trigger_replan",
        description: "Ask the fleet to re-plan its current ship assignments against the current knob values.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
}

function contextMessage(anomaly: Anomaly, knobs: Knob[], rollups: unknown, digest: unknown): string {
  return JSON.stringify({ anomaly, knobs, rollups, digest }, null, 2);
}

export class Supervisor {
  constructor(
    private automationService: AutomationServiceClient,
    private openai: OpenAiClient,
    private maxToolIterations: number
  ) {}

  async run(anomaly: Anomaly): Promise<SupervisorResult> {
    const [knobs, metrics, digest] = await Promise.all([
      this.automationService.getKnobs(),
      this.automationService.getMetricsContext(),
      this.automationService.getAnomaliesDigest(60),
    ]);
    const knobsByName = new Map(knobs.map((k) => [k.name, k]));
    const tools = buildTools(knobs);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      // Only rollups from getMetricsContext() are forwarded, not its unfiltered
      // events list — that list has no type restriction (unlike the digest's
      // events, scoped to NOTABLE_EVENT_TYPES), so forwarding it verbatim would
      // send every event's `detail` off-box to OpenAI on every anomaly, with no
      // redaction beyond eventLog.ts's comment-only "no token-shaped values"
      // convention. The digest's already-filtered events are enough context.
      { role: "user", content: contextMessage(anomaly, knobs, metrics.rollups, digest) },
    ];

    const actions: SupervisorAction[] = [];
    let rationale = "";

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      const message = await this.openai.chatCompletion(messages, tools);
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // `content` can legitimately be an empty string (not just null/undefined)
        // on a valid API response — `??` alone wouldn't catch that, and an
        // ai_intervention event with no rationale defeats the point of logging one.
        rationale = message.content || "The model ended its turn without a final rationale.";
        break;
      }

      for (const call of toolCalls) {
        const action = await this.executeToolCall(call.function.name, call.function.arguments, knobsByName);
        actions.push(action);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(action),
        });
      }

      if (iteration === this.maxToolIterations - 1) {
        rationale = message.content || "Reached the maximum number of tool-call iterations for this run.";
      }
    }

    // "Intervention" means something was actually applied — a tool call that
    // was attempted but refused (out-of-bounds, unknown knob) is still worth
    // logging for the rationale, but shouldn't be reported as an intervention
    // when nothing about the fleet's configuration actually changed.
    const anyApplied = actions.some((a) => a.applied);
    await this.automationService.appendEvent(anyApplied ? "ai_intervention" : "ai_no_action", {
      anomalyId: anomaly.id,
      anomalyType: anomaly.type,
      rationale,
      actions,
    });

    return { rationale, actions };
  }

  private async executeToolCall(
    name: string,
    rawArguments: string,
    knobsByName: Map<string, Knob>
  ): Promise<SupervisorAction> {
    if (name === "trigger_replan") {
      await this.automationService.triggerReplan();
      return { tool: "trigger_replan", applied: true };
    }

    if (name === "set_knob") {
      let args: { name?: unknown; value?: unknown };
      try {
        args = JSON.parse(rawArguments);
      } catch {
        return { tool: "set_knob", applied: false, reason: "arguments were not valid JSON" };
      }
      const knobName = typeof args.name === "string" ? args.name : undefined;
      const value = typeof args.value === "number" ? args.value : undefined;
      if (knobName === undefined || value === undefined || !Number.isFinite(value)) {
        return { tool: "set_knob", name: knobName, value, applied: false, reason: "name/value missing or not a finite number" };
      }
      const knob = knobsByName.get(knobName);
      if (knob === undefined) {
        return { tool: "set_knob", name: knobName, value, applied: false, reason: `unknown knob "${knobName}"` };
      }
      // Refused here, before ever reaching automation-service — the model's
      // only side effects on the world are a knob write within bounds or a
      // replan trigger, nothing else, and an out-of-bounds write never leaves
      // this process.
      if (value < knob.min || value > knob.max) {
        return {
          tool: "set_knob",
          name: knobName,
          value,
          applied: false,
          reason: `${value} is outside [${knob.min}, ${knob.max}]`,
        };
      }
      await this.automationService.setKnob(knobName, value);
      return { tool: "set_knob", name: knobName, value, applied: true };
    }

    return { tool: name as "set_knob" | "trigger_replan", applied: false, reason: `unknown tool "${name}"` };
  }
}
