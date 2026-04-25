import assert from "node:assert/strict";
import test from "node:test";
import type { RegulatorConfig } from "../src/config.js";
import { simulateReplayPayload } from "../src/replay-simulator.js";

const config: RegulatorConfig = {
  checkpointFile: "/tmp/checkpoint.json",
  queueDir: "/tmp/queue",
  maxQueueThreshold: 3,
  replayBatchSize: 8,
  hubproxyReplayUrl: "http://127.0.0.1:9999/api/replay",
  openclawWebhookUrl: "http://127.0.0.1:9999/webhook",
  defaultSinceHours: 2,
  requestTimeoutMs: 5_000,
  replayEventTypes: [],
  retry: {
    attempts: 2,
    baseDelayMs: 10,
    maxDelayMs: 20,
    backoffFactor: 2,
  },
  logging: {
    level: "error",
  },
  filters: {
    issues: {
      allowedActions: ["assigned"],
      allowedRepositories: ["netabit/liber-flux"],
      requiredLabels: [],
      excludeLabels: [],
      allowedSenders: ["markpol"],
      requiredConclusion: [],
      titleIncludesAny: ["quick start"],
      bodyIncludesAny: ["workspace"],
      fieldConditions: [],
    },
  },
  transformations: {
    issues: {
      keep: [
        "action",
        "issue.number",
        "issue.title",
        "issue.body",
        "repository.full_name",
      ],
      shorten: [{ field: "issue.body", maxLength: 24, suffix: "..." }],
      rename: {
        "issue.title": "issue.summary",
      },
      add: {
        type: "issues",
      },
      computed: [],
    },
  },
};

test("simulates local replay processing and returns forwarded OpenClaw messages", () => {
  const result = simulateReplayPayload(
    {
      events: [
        {
          id: "event-1",
          type: "issues",
          headers: {
            "X-Github-Delivery": ["delivery-123"],
          },
          payload: {
            action: "assigned",
            issue: {
              number: 304,
              title: "Relocate Quick Start scenario cards",
              body: "Move Quick Start into the workspace and keep onboarding optional.",
            },
            repository: {
              full_name: "netabit/liber-flux",
            },
            sender: {
              login: "markpol",
            },
          },
        },
        {
          id: "event-2",
          type: "issues",
          payload: {
            action: "closed",
            issue: {
              title: "Relocate Quick Start scenario cards",
              body: "Move Quick Start into the workspace and keep onboarding optional.",
            },
            repository: {
              full_name: "netabit/liber-flux",
            },
            sender: {
              login: "markpol",
            },
          },
        },
      ],
      replayed_count: 2,
    },
    config,
  );

  assert.equal(result.replayedCount, 2);
  assert.equal(result.forwardedCount, 1);
  assert.equal(result.droppedCount, 1);
  assert.deepEqual(result.forwarded, [
    {
      event: "issues",
      id: "event-1",
      deliveryId: "delivery-123",
      action: "assigned",
        transformedPayload: {
          action: "assigned",
          issue: {
            number: 304,
            summary: "Relocate Quick Start scenario cards",
            body: "Move Quick Start into...",
          },
          repository: {
            full_name: "netabit/liber-flux",
          },
          type: "issues",
        },
        openClawMessage: {
          text:
            'A github event has ocurrend. Here are the details: \n{"action":"assigned","issue":{"number":304,"body":"Move Quick Start into...","summary":"Relocate Quick Start scenario cards"},"repository":{"full_name":"netabit/liber-flux"},"type":"issues"}',
          mode: "now",
        },
      },
  ]);
  assert.deepEqual(result.dropped, [
    {
      event: "issues",
      id: "event-2",
      action: "closed",
      reason: "action_not_allowed",
    },
  ]);
});
