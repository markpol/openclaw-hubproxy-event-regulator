import type { RegulatorConfig } from "../config.js";
import { Logger } from "../logger.js";
import { HttpStatusError, withRetry } from "../services/retry.js";
import type { JsonObject, ReplayEvent } from "../types.js";

const forwardedHeaders = ["x-github-delivery", "x-hub-signature-256"] as const;
export class OpenClawClient {
  private readonly hooksToken: string;

  public constructor(
    private readonly config: RegulatorConfig,
    private readonly logger: Logger,
  ) {
    this.hooksToken = resolveHooksToken(process.env);
  }

  public async forward(event: ReplayEvent, payload: JsonObject): Promise<void> {
    await withRetry(
      async () => {
        const headers = new Headers({
          Authorization: `Bearer ${this.hooksToken}`,
          "Content-Type": "application/json",
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
          body: JSON.stringify(buildOpenClawMessage(payload)),
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

export function resolveHooksToken(env: NodeJS.ProcessEnv): string {
  const token = env.OPENCLAW_HOOKS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "OPENCLAW_HOOKS_TOKEN is required to forward events to OpenClaw.",
    );
  }

  return token;
}

export function buildOpenClawMessage(payload: JsonObject): { text: string; mode: "now" } {
  return {
    text: `A github event has ocurrend. Here are the details: \n${JSON.stringify(payload)}`,
    mode: "now",
  };
}
