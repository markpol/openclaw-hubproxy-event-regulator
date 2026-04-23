import type { RegulatorConfig } from "../config.js";
import { Logger } from "../logger.js";
import { HttpStatusError, withRetry } from "../services/retry.js";
import type { JsonObject, ReplayEvent } from "../types.js";

const forwardedHeaders = ["x-github-delivery", "x-github-event", "x-hub-signature-256"] as const;

export class OpenClawClient {
  public constructor(
    private readonly config: RegulatorConfig,
    private readonly logger: Logger,
  ) {}

  public async forward(event: ReplayEvent, payload: JsonObject): Promise<void> {
    await withRetry(
      async () => {
        const headers = new Headers({
          "content-type": "application/json",
          "x-github-event": event.event,
        });

        if (event.deliveryId) {
          headers.set("x-github-delivery", event.deliveryId);
        }

        for (const headerName of forwardedHeaders) {
          const headerValue = event.headers[headerName];
          if (headerValue) {
            headers.set(headerName, headerValue);
          }
        }

        const response = await fetch(this.config.openclawWebhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });

        if (!response.ok) {
          throw new HttpStatusError(
            this.config.openclawWebhookUrl,
            response.status,
            await response.text(),
          );
        }
      },
      this.config.retry,
      (attempt, error, delayMs) => {
        this.logger.warn("Retrying OpenClaw forward", {
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
          event: event.event,
          deliveryId: event.deliveryId,
        });
      },
    );
  }
}
