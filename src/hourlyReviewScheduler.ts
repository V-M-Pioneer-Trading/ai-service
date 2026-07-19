import { AutomationServiceClient } from "./automationServiceClient";
import { AnomalyDedupe } from "./dedupe";
import { Supervisor } from "./supervisor";

// Wider than the review cadence itself so a review still catches an anomaly
// that fired shortly before the previous review ran — dedupe (keyed by
// anomaly id) makes re-observing an already-handled anomaly here a no-op.
const DIGEST_WINDOW_MINUTES = 120;

/**
 * Periodically re-pulls automation-service's anomaly digest and runs the
 * supervisor for anything not yet claimed by AnomalyDedupe — the safety net
 * for an anomaly whose webhook delivery never arrived (or arrived while this
 * service was down). Mirrors automation-service's MetricsScheduler: a public
 * tick() lets tests drive a review deterministically via an injected Clock
 * instead of waiting on the real interval.
 */
export class HourlyReviewScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private automationService: AutomationServiceClient,
    private supervisor: Supervisor,
    private dedupe: AnomalyDedupe,
    private intervalMs: number,
    private onError: (err: unknown) => void = () => {}
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.inFlight = this.tick()
        .catch(this.onError)
        .finally(() => {
          this.ticking = false;
          this.inFlight = null;
        });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.inFlight !== null) await this.inFlight;
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    const { anomalies } = await this.automationService.getAnomaliesDigest(DIGEST_WINDOW_MINUTES);
    for (const anomaly of anomalies) {
      if (this.stopped) return;
      if (!this.dedupe.claim(anomaly.id)) continue;
      try {
        await this.supervisor.run(anomaly);
      } catch (err) {
        // Release the claim so a transient failure (a down OpenAI API, a
        // hiccup calling automation-service) gets retried by the next
        // review instead of being silently treated as "handled" forever.
        // One anomaly's failure also shouldn't stop the rest of this
        // review from processing the other anomalies in the digest.
        this.dedupe.release(anomaly.id);
        this.onError(err);
      }
    }
  }
}
