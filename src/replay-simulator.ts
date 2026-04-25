import { readFile } from "node:fs/promises";
import type { RegulatorConfig } from "./config.js";
import { buildOpenClawMessage } from "./clients/openclaw-client.js";
import { normalizeReplayResponse } from "./replay-events.js";
import { evaluateEventFilter } from "./rules/filter.js";
import { transformPayload } from "./rules/transform.js";
import type { JsonObject, ReplayEvent } from "./types.js";

export interface SimulatedForwardedEvent {
  event: string;
  id?: string;
  deliveryId?: string;
  action?: string;
  transformedPayload: JsonObject;
  openClawMessage: ReturnType<typeof buildOpenClawMessage>;
}

export interface SimulatedDroppedEvent {
  event: string;
  id?: string;
  deliveryId?: string;
  action?: string;
  reason: string;
}

export interface ReplaySimulationResult {
  replayedCount: number;
  forwardedCount: number;
  droppedCount: number;
  forwarded: SimulatedForwardedEvent[];
  dropped: SimulatedDroppedEvent[];
}

export async function simulateReplayFile(
  inputPath: string,
  config: RegulatorConfig,
): Promise<ReplaySimulationResult> {
  const raw = await readFile(inputPath, "utf8");
  return simulateReplayPayload(JSON.parse(raw) as unknown, config);
}

export function simulateReplayPayload(
  input: unknown,
  config: RegulatorConfig,
): ReplaySimulationResult {
  const replayResult = normalizeReplayResponse(input);
  const forwarded: SimulatedForwardedEvent[] = [];
  const dropped: SimulatedDroppedEvent[] = [];

  for (const event of replayResult.events) {
    const filterResult = evaluateEventFilter(event, config.filters[event.event]);
    if (!filterResult.allowed) {
      dropped.push({
        ...pickEventMetadata(event),
        reason: filterResult.reason ?? "filtered_out",
      });
      continue;
    }

    const transformation = config.transformations[event.event];
    if (!transformation) {
      dropped.push({
        ...pickEventMetadata(event),
        reason: "missing_transformation",
      });
      continue;
    }

    const transformedPayload = transformPayload(event.payload, transformation);
    forwarded.push({
      ...pickEventMetadata(event),
      transformedPayload,
      openClawMessage: buildOpenClawMessage(transformedPayload),
    });
  }

  return {
    replayedCount: replayResult.replayedCount,
    forwardedCount: forwarded.length,
    droppedCount: dropped.length,
    forwarded,
    dropped,
  };
}

function pickEventMetadata(event: ReplayEvent): {
  event: string;
  id?: string;
  deliveryId?: string;
  action?: string;
} {
  return {
    event: event.event,
    ...(event.id ? { id: event.id } : {}),
    ...(event.deliveryId ? { deliveryId: event.deliveryId } : {}),
    ...(event.action ? { action: event.action } : {}),
  };
}
