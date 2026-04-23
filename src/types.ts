export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ReplayEvent {
  event: string;
  payload: JsonObject;
  headers: Record<string, string>;
  id?: string;
  deliveryId?: string;
  action?: string;
  timestamp?: string;
}

export interface ReplayResult {
  events: ReplayEvent[];
  replayedCount: number;
}

export interface CycleResult {
  status: "skipped" | "completed";
  since?: string;
  until?: string;
  queueDepth: number;
  replayedCount: number;
  forwardedCount: number;
  droppedCount: number;
  reason?: string;
}
