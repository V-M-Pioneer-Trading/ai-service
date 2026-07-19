export interface Knob {
  name: string;
  value: number;
  default: number;
  min: number;
  max: number;
}

export interface EventLogEntry {
  id: string;
  occurredAt: string;
  type: string;
  detail: Record<string, unknown>;
}

export interface MetricsRollup {
  windowStart: string;
  windowEnd: string;
  creditsPerHour: number;
  extractionUnits: number;
  errorRate: number;
}

export interface Anomaly {
  id: string;
  type: string;
  dedupeKey: string;
  detectedAt: string;
  detail: Record<string, unknown>;
}

export class AutomationServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === "string") return body.error;
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Thin fetch client for automation-service's admin API — same unauthenticated
 * posture command-interface's automationService.js already relies on
 * (automation-service's admin API takes no bearer token).
 */
export class AutomationServiceClient {
  constructor(private baseUrl: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
    if (!res.ok) throw new AutomationServiceError(res.status, await parseErrorMessage(res));
    return res.json() as Promise<T>;
  }

  async getKnobs(): Promise<Knob[]> {
    const { knobs } = await this.call<{ knobs: Knob[] }>("/planner/knobs");
    return knobs;
  }

  async setKnob(name: string, value: number): Promise<Knob> {
    const { knob } = await this.call<{ knob: Knob }>(`/planner/knobs/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
    return knob;
  }

  async triggerReplan(): Promise<void> {
    await this.call<{ requested: boolean }>("/planner/replan", { method: "POST" });
  }

  async appendEvent(type: string, detail: Record<string, unknown>): Promise<void> {
    await this.call<{ ok: boolean }>("/events", {
      method: "POST",
      body: JSON.stringify({ type, detail }),
    });
  }

  async getMetricsContext(): Promise<{ rollups: MetricsRollup[]; events: EventLogEntry[] }> {
    return this.call("/metrics/context");
  }

  async getAnomaliesDigest(windowMinutes: number): Promise<{ anomalies: Anomaly[]; events: EventLogEntry[] }> {
    return this.call(`/anomalies/digest?windowMinutes=${windowMinutes}`);
  }
}
