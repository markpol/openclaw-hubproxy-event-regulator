import assert from "node:assert/strict";
import test from "node:test";
import { regulatorConfigSchema } from "../src/config.js";

test("rejects default message templates that are not last", () => {
  assert.throws(
    () => {
      regulatorConfigSchema.parse({
        checkpointFile: "/tmp/checkpoint.json",
        queueDir: "/tmp/queue",
        replayBatchSize: 8,
        hubproxyReplayUrl: "http://127.0.0.1:9999/api/replay",
        openclawWebhookUrl: "http://127.0.0.1:9999/webhook",
        defaultSinceHours: 2,
        requestTimeoutMs: 5_000,
        filters: {},
        transformations: {
          workflow_run: {
            keep: ["action"],
            messageTemplates: [
              {
                template: "Default first",
              },
              {
                template: "Specific second",
                filters: {
                  requiredConclusion: ["success"],
                },
              },
            ],
          },
        },
      });
    },
    /must be last/,
  );
});

test("rejects equalsAny in field conditions", () => {
  assert.throws(
    () => {
      regulatorConfigSchema.parse({
        checkpointFile: "/tmp/checkpoint.json",
        queueDir: "/tmp/queue",
        replayBatchSize: 8,
        hubproxyReplayUrl: "http://127.0.0.1:9999/api/replay",
        openclawWebhookUrl: "http://127.0.0.1:9999/webhook",
        defaultSinceHours: 2,
        requestTimeoutMs: 5_000,
        filters: {
          workflow_run: {
            fieldConditions: [
              {
                path: "workflow.name",
                equalsAny: ["Playwright"],
              },
            ],
          },
        },
        transformations: {
          workflow_run: {
            keep: ["action"],
          },
        },
      });
    },
    /unrecognized key.*equalsAny/i,
  );
});
