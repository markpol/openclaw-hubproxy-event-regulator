import type {
  EventFilterConfig,
  EventTransformationConfig,
  MessageTemplateConfig,
  RegulatorConfig,
} from "../config.js";
import { Logger } from "../logger.js";
import { evaluateEventFilter } from "../rules/filter.js";
import { HttpStatusError, withRetry } from "../services/retry.js";
import type { JsonObject, ReplayEvent } from "../types.js";
import { getAtPath } from "../utils/json-path.js";

const LEGACY_MESSAGE_PREFIX = "A github event has ocurrend. Here are the details: \n";

export class OpenClawClient {
  private readonly hooksToken: string;

  public constructor(
    private readonly config: RegulatorConfig,
    private readonly logger: Logger,
  ) {
    this.hooksToken = resolveHooksToken(process.env);
  }

  public async forward(
    event: ReplayEvent,
    payload: JsonObject,
    transformation: EventTransformationConfig,
  ): Promise<void> {
    await withRetry(
      async () => {
        const headers = new Headers({
          Authorization: `Bearer ${this.hooksToken}`,
          "Content-Type": "application/json",
          "X-GitHub-Event": event.event,
        });

        const signature = event.headers["x-hub-signature-256"];
        if (signature) {
          headers.set("X-Hub-Signature-256", signature);
        }

        const response = await fetch(this.config.openclawWebhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(buildOpenClawMessage(event, payload, transformation)),
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

export function buildOpenClawMessage(
  event: ReplayEvent,
  payload: JsonObject,
  transformation?: Pick<EventTransformationConfig, "messageTemplates">,
): { text: string; mode: "now" } {
  const template = selectMessageTemplate(event, transformation?.messageTemplates);

  return {
    text: template ? renderMessageTemplate(template, event, payload) : buildLegacyMessage(payload),
    mode: "now",
  };
}

function selectMessageTemplate(
  event: ReplayEvent,
  messageTemplates: MessageTemplateConfig[] | undefined,
): string | undefined {
  if (!messageTemplates || messageTemplates.length === 0) {
    return undefined;
  }

  return messageTemplates.find((messageTemplate) => matchesMessageTemplate(event, messageTemplate))
    ?.template;
}

function matchesMessageTemplate(event: ReplayEvent, messageTemplate: MessageTemplateConfig): boolean {
  if (!hasConfiguredFilterRules(messageTemplate.filters)) {
    return true;
  }

  return evaluateEventFilter(event, messageTemplate.filters).allowed;
}

function renderMessageTemplate(template: string, event: ReplayEvent, payload: JsonObject): string {
  const context = buildTemplateContext(event, payload);

  return template.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const value = getAtPath(context, rawPath.trim());
    return stringifyTemplateValue(value);
  });
}

function buildTemplateContext(event: ReplayEvent, payload: JsonObject): JsonObject {
  return {
    event: {
      event: event.event,
      payload: event.payload,
      headers: event.headers,
      ...(event.id ? { id: event.id } : {}),
      ...(event.deliveryId ? { deliveryId: event.deliveryId } : {}),
      ...(event.action ? { action: event.action } : {}),
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    },
    payload: {
      ...payload,
      json: stringifyPayload(payload),
    },
    transformedPayload: payload,
  };
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function buildLegacyMessage(payload: JsonObject): string {
  return `${LEGACY_MESSAGE_PREFIX}${stringifyPayload(payload)}`;
}

function stringifyPayload(payload: JsonObject): string {
  return JSON.stringify(payload, null, 2);
}

function hasConfiguredFilterRules(filter: EventFilterConfig | undefined): boolean {
  if (!filter) {
    return false;
  }

  return (
    filter.allowedActions.length > 0 ||
    filter.allowedRepositories.length > 0 ||
    filter.requiredLabels.length > 0 ||
    filter.excludeLabels.length > 0 ||
    filter.allowedSenders.length > 0 ||
    filter.requiredConclusion.length > 0 ||
    filter.titleIncludesAny.length > 0 ||
    filter.bodyIncludesAny.length > 0 ||
    filter.fieldConditions.length > 0
  );
}
