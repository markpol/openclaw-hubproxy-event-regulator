import type { EventTransformationConfig } from "../config.js";
import type { JsonObject, JsonValue } from "../types.js";
import { cloneJsonValue, coerceText, deleteAtPath, getAtPath, pickPaths, setAtPath } from "../utils/json-path.js";

export function transformPayload(
  payload: JsonObject,
  rule: EventTransformationConfig,
): JsonObject {
  const result = pickPaths(payload, rule.keep);

  for (const computed of rule.computed) {
    const rawValue = getAtPath(payload, computed.from);
    if (rawValue === undefined) {
      continue;
    }

    const computedValue = applyComputedValue(rawValue, computed.operation, computed.maxLength, computed.suffix);
    if (computedValue !== undefined) {
      setAtPath(result, computed.field, computedValue);
    }
  }

  for (const shorten of rule.shorten) {
    const currentValue = getAtPath(result, shorten.field);
    const text = coerceText(currentValue);
    if (text !== undefined) {
      setAtPath(result, shorten.field, shortenText(text, shorten.maxLength, shorten.suffix));
    }
  }

  for (const [from, to] of Object.entries(rule.rename)) {
    const currentValue = getAtPath(result, from);
    if (currentValue === undefined) {
      continue;
    }

    setAtPath(result, to, currentValue);
    deleteAtPath(result, from);
  }

  for (const [field, value] of Object.entries(rule.add)) {
    setAtPath(result, field, cloneJsonValue(value));
  }

  return result;
}

function applyComputedValue(
  value: JsonValue,
  operation: "copy" | "shorten",
  maxLength: number | undefined,
  suffix: string,
): JsonValue | undefined {
  if (operation === "copy") {
    return cloneJsonValue(value);
  }

  const text = coerceText(value);
  if (text === undefined || maxLength === undefined) {
    return undefined;
  }

  return shortenText(text, maxLength, suffix);
}

function shortenText(value: string, maxLength: number, suffix: string): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliceLength = Math.max(0, maxLength - suffix.length);
  return `${value.slice(0, sliceLength)}${suffix}`;
}
