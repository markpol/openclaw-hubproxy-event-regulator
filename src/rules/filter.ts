import type { EventFilterConfig } from "../config.js";
import type { ReplayEvent } from "../types.js";
import { coerceText, getAtPath, toStringArray } from "../utils/json-path.js";

export interface FilterResult {
  allowed: boolean;
  reason?: string;
}

export function evaluateEventFilter(
  event: ReplayEvent,
  filter: EventFilterConfig | undefined,
): FilterResult {
  if (!filter) {
    return { allowed: true };
  }

  const action = getFirstString(event, ["action", "payload.action"]);
  if (filter.allowedActions.length > 0 && (!action || !filter.allowedActions.includes(action))) {
    return { allowed: false, reason: "action_not_allowed" };
  }

  const repository = getFirstString(event.payload, ["repository.full_name"]);
  if (
    filter.allowedRepositories.length > 0 &&
    (!repository || !filter.allowedRepositories.includes(repository))
  ) {
    return { allowed: false, reason: "repository_not_allowed" };
  }

  const labels = extractLabels(event);
  if (filter.requiredLabels.length > 0) {
    const missingLabel = filter.requiredLabels.find((label) => !labels.has(label));
    if (missingLabel) {
      return { allowed: false, reason: "required_label_missing" };
    }
  }

  const excludedLabel = filter.excludeLabels.find((label) => labels.has(label));
  if (excludedLabel) {
    return { allowed: false, reason: "excluded_label_present" };
  }

  if (filter.allowedSenders.length > 0) {
    const senders = extractSenders(event);
    const matchedSender = filter.allowedSenders.some((sender) => senders.has(sender));
    if (!matchedSender) {
      return { allowed: false, reason: "sender_not_allowed" };
    }
  }

  if (filter.requiredConclusion.length > 0) {
    const conclusion = getFirstString(event.payload, ["workflow_run.conclusion", "conclusion"]);
    if (!conclusion || !filter.requiredConclusion.includes(conclusion)) {
      return { allowed: false, reason: "conclusion_not_allowed" };
    }
  }

  if (filter.titleIncludesAny.length > 0) {
    const title = getFirstString(event.payload, ["title", "issue.title", "pull_request.title"]);
    if (!containsAny(title, filter.titleIncludesAny)) {
      return { allowed: false, reason: "title_keyword_missing" };
    }
  }

  if (filter.bodyIncludesAny.length > 0) {
    const body = getFirstString(event.payload, ["body", "issue.body", "pull_request.body"]);
    if (!containsAny(body, filter.bodyIncludesAny)) {
      return { allowed: false, reason: "body_keyword_missing" };
    }
  }

  for (const condition of filter.fieldConditions) {
    const value = getAtPath(event.payload, condition.path);

    if (condition.exists !== undefined) {
      const exists = value !== undefined;
      if (exists !== condition.exists) {
        return { allowed: false, reason: "field_exists_mismatch" };
      }
    }

    const text = coerceText(value);

    if (condition.equalsAny && (!text || !condition.equalsAny.includes(text))) {
      return { allowed: false, reason: "field_equals_mismatch" };
    }

    if (condition.includesAny && !containsAny(text, condition.includesAny)) {
      return { allowed: false, reason: "field_includes_mismatch" };
    }

    if (condition.matchesRegex) {
      const regex = new RegExp(condition.matchesRegex, "i");
      if (!text || !regex.test(text)) {
        return { allowed: false, reason: "field_regex_mismatch" };
      }
    }
  }

  return { allowed: true };
}

function getFirstString(source: unknown, paths: string[]): string | undefined {
  for (const currentPath of paths) {
    const value = currentPath.startsWith("payload.")
      ? getAtPath(source, currentPath.replace(/^payload\./, "payload."))
      : getAtPath(source, currentPath);

    const text = coerceText(value);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractLabels(event: ReplayEvent): Set<string> {
  const candidates = [
    getAtPath(event.payload, "labels"),
    getAtPath(event.payload, "issue.labels"),
    getAtPath(event.payload, "pull_request.labels"),
  ];

  const labels = new Set<string>();

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const item of candidate) {
      if (typeof item === "string") {
        labels.add(item);
        continue;
      }

      const name = coerceText(getAtPath(item, "name"));
      if (name) {
        labels.add(name);
      }
    }
  }

  return labels;
}

function extractSenders(event: ReplayEvent): Set<string> {
  const candidates = [
    getAtPath(event.payload, "sender.login"),
    getAtPath(event.payload, "user.login"),
    getAtPath(event.payload, "issue.user.login"),
    getAtPath(event.payload, "pull_request.user.login"),
    getAtPath(event.payload, "workflow_run.actor.login"),
  ];

  return new Set(
    candidates
      .map((candidate) => coerceText(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
}

function containsAny(value: string | undefined, keywords: string[]): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
