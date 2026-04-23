import type { JsonObject, JsonValue } from "../types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

export function getAtPath(source: unknown, path: string): JsonValue | undefined {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = source;

  for (const segment of segments) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current as JsonValue | undefined;
}

export function setAtPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let current: JsonObject = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isJsonObject(existing)) {
      current[segment] = {};
    }

    current = current[segment] as JsonObject;
  }

  current[segments[segments.length - 1] as string] = cloneJsonValue(value);
}

export function deleteAtPath(target: JsonObject, path: string): void {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let current: JsonObject = target;

  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isJsonObject(next)) {
      return;
    }

    current = next;
  }

  delete current[segments[segments.length - 1] as string];
}

export function pickPaths(source: JsonObject, paths: string[]): JsonObject {
  const target: JsonObject = {};

  for (const path of paths) {
    const value = getAtPath(source, path);
    if (value !== undefined) {
      setAtPath(target, path, value);
    }
  }

  return target;
}

export function toStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function coerceText(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}
