export interface ServiceConfig {
  port: number;
  automationServiceUrl: string;
  // auth-service's POST /auth/v1/m2m-token, and this caller's own secret for it.
  authM2mTokenUrl: string;
  authM2mCallerSecret: string;
  openaiApiKey: string;
  // Overridable so tests point this at a local stub instead of the real API.
  openaiBaseUrl: string;
  openaiModel: string;
  // Caps how many tool-call round-trips one supervisor run can make against
  // the model before giving up and logging whatever rationale/actions it has
  // so far — the model is never allowed to loop indefinitely against a live
  // fleet.
  maxToolIterations: number;
  // Cadence for the hourly digest review that catches anomalies whose webhook
  // delivery never arrived (or arrived while this service was down).
  hourlyReviewIntervalMs: number;
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
};

export const configFromEnv = (): ServiceConfig => ({
  port: Number(process.env.PORT ?? 3004),
  automationServiceUrl: requireEnv("AUTOMATION_SERVICE_URL"),
  authM2mTokenUrl: requireEnv("AUTH_M2M_TOKEN_URL"),
  authM2mCallerSecret: requireEnv("AUTH_M2M_CALLER_SECRET"),
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  maxToolIterations: Number(process.env.MAX_TOOL_ITERATIONS ?? 5),
  hourlyReviewIntervalMs: Number(process.env.HOURLY_REVIEW_INTERVAL_MS ?? 3_600_000),
});
