import express from "express";
import { Anomaly, AutomationServiceClient } from "./automationServiceClient";
import { ServiceConfig, configFromEnv } from "./config";
import { AnomalyDedupe } from "./dedupe";
import { HourlyReviewScheduler } from "./hourlyReviewScheduler";
import { OpenAiClient } from "./openaiClient";
import { Supervisor } from "./supervisor";

/** Express 4 does not forward async-handler rejections to error middleware on its own. */
type AsyncHandler = (req: express.Request, res: express.Response) => Promise<void>;
const asyncHandler = (fn: AsyncHandler) => (req: express.Request, res: express.Response, next: express.NextFunction) =>
  fn(req, res).catch(next);

function isValidAnomalyPayload(body: unknown): body is {
  id: string;
  type: string;
  dedupeKey: string;
  detectedAt: string;
  detail?: Record<string, unknown>;
} {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.id === "string" && typeof b.type === "string" && typeof b.dedupeKey === "string" && typeof b.detectedAt === "string";
}

export function createApp(config: ServiceConfig) {
  const app = express();
  app.use(express.json());

  const automationService = new AutomationServiceClient(config.automationServiceUrl);
  const openai = new OpenAiClient(config.openaiApiKey, config.openaiBaseUrl, config.openaiModel);
  const supervisor = new Supervisor(automationService, openai, config.maxToolIterations);
  const dedupe = new AnomalyDedupe();
  const hourlyReview = new HourlyReviewScheduler(
    automationService,
    supervisor,
    dedupe,
    config.hourlyReviewIntervalMs,
    (err) => console.error("hourly review tick failed", err)
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // automation-service's WebhookDelivery retries up to 3 times on a non-2xx
  // response, so an anomaly can legitimately arrive here more than once —
  // dedupe on `id` (not `dedupeKey`, which automation-service already uses
  // to suppress *re-firing* the same underlying condition; this is about
  // idempotent *delivery* of one already-fired anomaly) so a redelivery of
  // an anomaly this service already handled is acknowledged without a
  // second supervisor run.
  app.post(
    "/webhooks/anomaly",
    asyncHandler(async (req, res) => {
      if (!isValidAnomalyPayload(req.body)) {
        res.status(400).json({ error: { message: "invalid anomaly payload" } });
        return;
      }
      const anomaly: Anomaly = {
        id: req.body.id,
        type: req.body.type,
        dedupeKey: req.body.dedupeKey,
        detectedAt: req.body.detectedAt,
        detail: req.body.detail ?? {},
      };
      if (!dedupe.claim(anomaly.id)) {
        res.status(200).json({ deduped: true });
        return;
      }
      try {
        const result = await supervisor.run(anomaly);
        res.status(202).json(result);
      } catch (err) {
        // Release the claim so automation-service's webhook redelivery (or
        // the next hourly review) retries a transient failure instead of
        // this anomaly being silently dropped forever.
        dedupe.release(anomaly.id);
        throw err;
      }
    })
  );

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: { message: err.message || "internal error" } });
  });

  return { app, hourlyReview, dedupe };
}

if (require.main === module) {
  const config = configFromEnv();
  const { app, hourlyReview } = createApp(config);
  hourlyReview.start();
  app.listen(config.port, () => {
    console.log(`ai-service listening on http://localhost:${config.port}`);
  });
}
