import type { RegulatorConfig } from "../config.js";
import { Logger } from "../logger.js";
import { normalizeReplayResponse } from "../replay-events.js";
import type { JsonObject, ReplayEvent, ReplayResult } from "../types.js";
import { HttpStatusError, withRetry } from "../services/retry.js";

interface ReplayRequest {
  since: string;
  until: string;
  limit: number;
  types: string[];
}

export class HubProxyClient {
  public constructor(
    private readonly config: RegulatorConfig,
    private readonly logger: Logger,
  ) {}

  public async replay(request: ReplayRequest): Promise<ReplayResult> {
    return withRetry(
      async () => {
        const replayUrl = buildReplayUrl(this.config.hubproxyReplayUrl, request);
        const response = await fetch(replayUrl, {
          method: "POST",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });

        if (response.status === 404) {
          return emptyReplayResult();
        }

        if (!response.ok) {
          throw new HttpStatusError(
            replayUrl,
            response.status,
            await response.text(),
          );
        }

        const json = (await response.json()) as unknown;
        return normalizeReplayResponse(json);
      },
      this.config.retry,
      (attempt, error, delayMs) => {
        this.logger.warn("Retrying HubProxy replay request", {
          attempt,
          delayMs,
          error: toErrorMessage(error),
        });
      },
    );
  }
}

function buildReplayUrl(baseUrl: string, request: ReplayRequest): string {
  const url = new URL(baseUrl);
  url.searchParams.set("since", request.since);
  url.searchParams.set("until", request.until);
  url.searchParams.set("limit", String(request.limit));

  for (const type of request.types) {
    url.searchParams.append("types", type);
  }

  return url.toString();
}

function emptyReplayResult(): ReplayResult {
  return {
    events: [],
    replayedCount: 0,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
