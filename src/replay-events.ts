import type { JsonObject, ReplayEvent, ReplayResult } from "./types.js";
import { getAtPath, isJsonObject } from "./utils/json-path.js";

export function normalizeReplayResponse(input: unknown): ReplayResult {
  const record = isJsonObject(input) ? input : undefined;
  const eventsSource = Array.isArray(input)
    ? input
    : Array.isArray(record?.events)
      ? record.events
      : Array.isArray(record?.items)
        ? record.items
        : undefined;

  if (!eventsSource) {
    const replayedCount =
      typeof record?.replayed_count === "number" ? record.replayed_count : undefined;
    if (replayedCount !== undefined) {
      throw new Error(
        "HubProxy replay returned only 'replayed_count'. The regulator requires replayable events to filter, transform, and forward.",
      );
    }

    throw new Error(
      "HubProxy replay response must be an event array or an object containing 'events' or 'items'.",
    );
  }

  return {
    events: eventsSource.map(normalizeReplayEvent),
    replayedCount:
      typeof record?.replayed_count === "number" ? record.replayed_count : eventsSource.length,
  };
}

export function normalizeReplayEvent(input: unknown): ReplayEvent {
  if (!isJsonObject(input)) {
    throw new Error("Replay event must be an object.");
  }

  const payload = normalizePayload(input.payload ?? input.body ?? input.data);
  const headers = normalizeHeaders(input.headers);
  const event =
    getString(input.event) ??
    getString(input.type) ??
    getString(input.name) ??
    headers["x-github-event"];

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
    getString(input.deliveryId) ??
    getString(input.delivery_id) ??
    headers["x-github-delivery"];
  const action = getString(input.action) ?? getString(getAtPath(payload, "action"));
  const timestamp =
    getString(input.timestamp) ??
    getString(input.receivedAt) ??
    getString(input.deliveredAt);

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
    const normalized = normalizeHeaderValue(value);
    if (normalized) {
      headers[key.toLowerCase()] = normalized;
    }
  }

  return headers;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    if (first) {
      return first;
    }
  }

  return undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
