import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { JsonValue } from "./types.js";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const fieldConditionSchema = z
  .object({
    path: z.string().min(1),
    exists: z.boolean().optional(),
    equalsAny: z.array(z.string().min(1)).optional(),
    includesAny: z.array(z.string().min(1)).optional(),
    matchesRegex: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.exists === undefined &&
      !value.equalsAny &&
      !value.includesAny &&
      !value.matchesRegex
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Field conditions must define at least one matcher.",
      });
    }
  });

const filterRuleSchema = z.object({
  allowedActions: z.array(z.string().min(1)).default([]),
  allowedRepositories: z.array(z.string().min(1)).default([]),
  requiredLabels: z.array(z.string().min(1)).default([]),
  excludeLabels: z.array(z.string().min(1)).default([]),
  allowedSenders: z.array(z.string().min(1)).default([]),
  requiredConclusion: z.array(z.string().min(1)).default([]),
  titleIncludesAny: z.array(z.string().min(1)).default([]),
  bodyIncludesAny: z.array(z.string().min(1)).default([]),
  fieldConditions: z.array(fieldConditionSchema).default([]),
});

const shortenRuleSchema = z.object({
  field: z.string().min(1),
  maxLength: z.number().int().positive(),
  suffix: z.string().default("..."),
});

const computedFieldSchema = z
  .object({
    field: z.string().min(1),
    from: z.string().min(1),
    operation: z.enum(["copy", "shorten"]).default("copy"),
    maxLength: z.number().int().positive().optional(),
    suffix: z.string().default("..."),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "shorten" && value.maxLength === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxLength"],
        message: "Computed fields using 'shorten' require maxLength.",
      });
    }
  });

const messageTemplateConfigSchema = z.object({
  template: z.string().min(1),
  filters: filterRuleSchema.optional(),
});

const transformationRuleSchema = z
  .object({
    keep: z.array(z.string().min(1)).min(1),
    shorten: z.array(shortenRuleSchema).default([]),
    rename: z.record(z.string().min(1), z.string().min(1)).default({}),
    add: z.record(z.string().min(1), jsonValueSchema).default({}),
    computed: z.array(computedFieldSchema).default([]),
    messageTemplates: z.array(messageTemplateConfigSchema).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.messageTemplates) {
      return;
    }

    let defaultTemplateIndex: number | undefined;

    for (const [index, messageTemplate] of value.messageTemplates.entries()) {
      if (hasConfiguredFilterRules(messageTemplate.filters)) {
        continue;
      }

      if (defaultTemplateIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["messageTemplates", index],
          message: "Only one default message template is allowed.",
        });
        continue;
      }

      defaultTemplateIndex = index;

      if (index !== value.messageTemplates.length - 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["messageTemplates", index],
          message: "Default message templates without filters must be last.",
        });
      }
    }
  });

const retrySchema = z.object({
  attempts: z.number().int().min(1).default(3),
  baseDelayMs: z.number().int().min(10).default(250),
  maxDelayMs: z.number().int().min(10).default(2_000),
  backoffFactor: z.number().positive().default(2),
});

const loggingSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const regulatorConfigSchema = z
  .object({
    checkpointFile: z.string().min(1),
    queueDir: z.string().min(1),
    maxQueueThreshold: z.number().int().min(0).default(3),
    replayBatchSize: z.number().int().positive().default(8),
    hubproxyReplayUrl: z.string().url(),
    openclawWebhookUrl: z.string().url(),
    defaultSinceHours: z.number().positive().default(2),
    requestTimeoutMs: z.number().int().min(100).default(10_000),
    replayEventTypes: z.array(z.string().min(1)).default([]),
    filters: z.record(z.string().min(1), filterRuleSchema).default({}),
    transformations: z.record(z.string().min(1), transformationRuleSchema),
    retry: retrySchema.default({
      attempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 2_000,
      backoffFactor: 2,
    }),
    logging: loggingSchema.default({
      level: "info",
    }),
  })
  .superRefine((config, ctx) => {
    const transformationKeys = new Set(Object.keys(config.transformations));

    if (transformationKeys.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transformations"],
        message: "At least one event transformation must be configured.",
      });
    }

    for (const eventType of Object.keys(config.filters)) {
      if (!transformationKeys.has(eventType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["filters", eventType],
          message: `Filter '${eventType}' requires a matching transformation.`,
        });
      }
    }
  });

export type RegulatorConfig = z.infer<typeof regulatorConfigSchema>;
export type EventFilterConfig = z.infer<typeof filterRuleSchema>;
export type EventTransformationConfig = z.infer<typeof transformationRuleSchema>;
export type MessageTemplateConfig = z.infer<typeof messageTemplateConfigSchema>;
export type RetryConfig = z.infer<typeof retrySchema>;
export type LogLevel = z.infer<typeof loggingSchema>["level"];

export async function loadConfig(configPath: string): Promise<RegulatorConfig> {
  const raw = await readFile(configPath, "utf8");
  const extension = path.extname(configPath).toLowerCase();

  let parsed: unknown;

  if (extension === ".json") {
    parsed = JSON.parse(raw);
  } else {
    parsed = yaml.load(raw);
  }

  return regulatorConfigSchema.parse(parsed);
}

function hasConfiguredFilterRules(filter: z.infer<typeof filterRuleSchema> | undefined): boolean {
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
