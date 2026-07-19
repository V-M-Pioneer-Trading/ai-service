/**
 * Tracks anomaly ids this service has already started a supervisor run for —
 * automation-service's WebhookDelivery retries up to 3 times on delivery
 * failure, and the hourly review can also re-observe an anomaly the webhook
 * already delivered, so without this the same anomaly could trigger more
 * than one (real, side-effecting) supervisor run.
 *
 * v1 simplification: in-memory only, no persistence or eviction — same
 * "assumes exactly one running instance" tradeoff automation-service's own
 * metrics-rollup resume logic already accepts. A restart re-processes
 * anything the hourly review still finds unhandled in the digest, which is
 * safe (idempotent knob writes, an extra replan trigger) rather than lossy.
 */
export class AnomalyDedupe {
  private seen = new Set<string>();

  /** Returns true if this is the first time `anomalyId` has been seen. */
  claim(anomalyId: string): boolean {
    if (this.seen.has(anomalyId)) return false;
    this.seen.add(anomalyId);
    return true;
  }

  /**
   * Undoes a claim after its supervisor run failed (a down OpenAI API, a
   * transient automation-service error) — without this, a failed run would
   * be permanently treated as "handled" and never retried by a webhook
   * redelivery or the next hourly review.
   */
  release(anomalyId: string): void {
    this.seen.delete(anomalyId);
  }

  has(anomalyId: string): boolean {
    return this.seen.has(anomalyId);
  }
}
