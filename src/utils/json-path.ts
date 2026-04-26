import type { JsonObject, JsonValue } from "../types.js";

type PathSegment =
  | { type: "property"; key: string }
  | { type: "array"; selector: "wildcard" | "index"; index?: number };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

export function getAtPath(source: unknown, path: string): JsonValue | undefined {
  return getAtPathSegments(source, parsePath(path));
}

export function setAtPath(target: JsonObject, path: string, value: JsonValue): void {
  const segments = parsePath(path);
  if (segments.length === 0) {
    return;
  }

  setAtPathSegments(target, segments, value);
}

export function deleteAtPath(target: JsonObject, path: string): void {
  const segments = parsePath(path);
  if (segments.length === 0) {
    return;
  }

  deleteAtPathSegments(target, segments);
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

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];

  for (const part of path.split(".").filter(Boolean)) {
    for (const match of part.matchAll(/([^\[\]]+)|\[(\d*|\*)\]/g)) {
      const property = match[1];
      if (property) {
        segments.push({ type: "property", key: property });
        continue;
      }

      const selector = match[2] ?? "";
      if (selector === "" || selector === "*") {
        segments.push({ type: "array", selector: "wildcard" });
        continue;
      }

      segments.push({ type: "array", selector: "index", index: Number(selector) });
    }
  }

  return segments;
}

function getAtPathSegments(source: unknown, segments: PathSegment[]): JsonValue | undefined {
  const segment = segments[0];
  if (!segment) {
    return source as JsonValue | undefined;
  }

  const rest = segments.slice(1);

  if (segment.type === "property") {
    if (!isJsonObject(source)) {
      return undefined;
    }

    return getAtPathSegments(source[segment.key], rest);
  }

  if (!Array.isArray(source)) {
    return undefined;
  }

  if (segment.selector === "index") {
    return getAtPathSegments(source[segment.index ?? -1], rest);
  }

  const values = source
    .map((item) => getAtPathSegments(item, rest))
    .filter((item): item is JsonValue => item !== undefined);

  return values.length > 0 ? values : undefined;
}

function setAtPathSegments(target: JsonObject | JsonValue[], segments: PathSegment[], value: JsonValue): void {
  const segment = segments[0];
  if (!segment) {
    return;
  }

  const rest = segments.slice(1);

  if (segment.type === "property") {
    if (!isJsonObject(target)) {
      return;
    }

    if (rest.length === 0) {
      target[segment.key] = cloneJsonValue(value);
      return;
    }

    const nextSegment = rest[0];
    if (!nextSegment) {
      return;
    }

    const nextTarget = ensureContainer(target[segment.key], nextSegment);
    target[segment.key] = nextTarget;
    setAtPathSegments(nextTarget, rest, value);
    return;
  }

  if (!Array.isArray(target)) {
    return;
  }

  if (segment.selector === "index") {
    const index = segment.index ?? -1;
    if (index < 0) {
      return;
    }

    if (rest.length === 0) {
      target[index] = cloneJsonValue(value);
      return;
    }

    const nextSegment = rest[0];
    if (!nextSegment) {
      return;
    }

    const nextTarget = ensureContainer(target[index], nextSegment);
    target[index] = nextTarget;
    setAtPathSegments(nextTarget, rest, value);
    return;
  }

  if (!Array.isArray(value)) {
    return;
  }

  target.length = value.length;

  if (rest.length === 0) {
    for (const [index, item] of value.entries()) {
      target[index] = cloneJsonValue(item);
    }

    return;
  }

  for (const [index, item] of value.entries()) {
    const nextSegment = rest[0];
    if (!nextSegment) {
      return;
    }

    const nextTarget = ensureContainer(target[index], nextSegment);
    target[index] = nextTarget;
    setAtPathSegments(nextTarget, rest, item);
  }
}

function deleteAtPathSegments(target: JsonObject | JsonValue[], segments: PathSegment[]): void {
  const segment = segments[0];
  if (!segment) {
    return;
  }

  const rest = segments.slice(1);

  if (segment.type === "property") {
    if (!isJsonObject(target)) {
      return;
    }

    if (rest.length === 0) {
      delete target[segment.key];
      return;
    }

    deleteAtPathSegments(target[segment.key] as JsonObject | JsonValue[], rest);
    return;
  }

  if (!Array.isArray(target)) {
    return;
  }

  if (segment.selector === "index") {
    const index = segment.index ?? -1;
    if (index < 0 || index >= target.length) {
      return;
    }

    if (rest.length === 0) {
      target.splice(index, 1);
      return;
    }

    deleteAtPathSegments(target[index] as JsonObject | JsonValue[], rest);
    return;
  }

  if (rest.length === 0) {
    target.length = 0;
    return;
  }

  for (const item of target) {
    deleteAtPathSegments(item as JsonObject | JsonValue[], rest);
  }
}

function ensureContainer(value: JsonValue | undefined, nextSegment: PathSegment): JsonObject | JsonValue[] {
  if (nextSegment.type === "array") {
    return Array.isArray(value) ? value : [];
  }

  return isJsonObject(value) ? value : {};
}
