import type { RegulatorConfig } from "../config.js";
import { Logger } from "../logger.js";
import type { JsonObject, ReplayEvent, ReplayResult } from "../types.js";
import { getAtPath, isJsonObject } from "../utils/json-path.js";
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

function normalizeReplayResponse(input: unknown): ReplayResult {
  const record = isJsonObject(input) ? input : undefined;
  const eventsSource = Array.isArray(input)
    ? input
    : Array.isArray(record?.events)
      ? record.events
      : Array.isArray(record?.items)
        ? record.items
        : undefined;

  if (!eventsSource) {
    const replayedCount = typeof record?.replayed_count === "number" ? record.replayed_count : undefined;
    if (replayedCount !== undefined) {
      throw new Error(
        "HubProxy replay returned only 'replayed_count'. The regulator requires replayable events to filter, transform, and forward.",
      );
    }

    throw new Error("HubProxy replay response must be an event array or an object containing 'events' or 'items'.");
  }

  return {
    events: eventsSource.map(normalizeReplayEvent),
    replayedCount:
      typeof record?.replayed_count === "number" ? record.replayed_count : eventsSource.length,
  };
}

function normalizeReplayEvent(input: unknown): ReplayEvent {
  if (!isJsonObject(input)) {
    throw new Error("Replay event must be an object.");
  }

  const payload = normalizePayload(input.payload ?? input.body ?? input.data);
  const headers = normalizeHeaders(input.headers);
  const event = getString(input.event) ?? getString(input.type) ?? getString(input.name) ?? headers["x-github-event"];

  if (!event) {
    throw new Error("Replay event is missing an event name.");
  }

  const replayEvent: ReplayEvent = {
    event,
    payload,
    headers,
  };

  const id = getString(input.id);
  const deliveryId =
    getString(input.deliveryId) ?? getString(input.delivery_id) ?? headers["x-github-delivery"];
  const action = getString(input.action) ?? getString(getAtPath(payload, "action"));
  const timestamp =
    getString(input.timestamp) ?? getString(input.receivedAt) ?? getString(input.deliveredAt);

  if (id) {
    replayEvent.id = id;
  }

  if (deliveryId) {
    replayEvent.deliveryId = deliveryId;
  }

  if (action) {
    replayEvent.action = action;
  }

  if (timestamp) {
    replayEvent.timestamp = timestamp;
  }

  return replayEvent;
}

function normalizePayload(input: unknown): JsonObject {
  if (typeof input === "string") {
    const parsed = JSON.parse(input) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error("Replay event payload must parse to an object.");
    }

    return parsed;
  }

  if (!isJsonObject(input)) {
    throw new Error("Replay event payload must be an object.");
  }

  return input;
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (!isJsonObject(input)) {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      headers[key.toLowerCase()] = value;
    }
  }

  return headers;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
