import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveHooksToken } from "../src/clients/openclaw-client.js";
import { Logger } from "../src/logger.js";
import { EventRegulator } from "../src/regulator.js";
import type { RegulatorConfig } from "../src/config.js";

test("runs one replay cycle and forwards transformed payloads", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-regulator-"));
  const queueDir = path.join(tempDir, "delivery-queue");
  const checkpointFile = path.join(tempDir, "checkpoint.json");
  await mkdir(queueDir, { recursive: true });
  await writeFile(path.join(queueDir, "keep-me.txt"), "");
  await rm(path.join(queueDir, "keep-me.txt"));

  const openClawPayloads: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let replayRequestUrl = "";
  let replayRequestBody = "";

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(404).end();
      return;
    }

    if (request.url?.startsWith("/api/replay?") && request.method === "POST") {
      replayRequestUrl = request.url;
      replayRequestBody = await readRequestBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          events: [
            {
              event: "pull_request",
              deliveryId: "delivery-123",
              headers: {
                "x-hub-signature-256": "sha256=deadbeef",
              },
              payload: {
                action: "opened",
                number: 42,
                html_url: "https://github.com/yourorg/repo1/pull/42",
                title: "Release customer fix",
                repository: {
                  full_name: "yourorg/repo1",
                },
                pull_request: {
                  user: {
                    login: "mark",
                  },
                  body: "This body is definitely longer than the shortened form.",
                },
                sender: {
                  login: "mark",
                },
              },
            },
          ],
          replayed_count: 1,
        }),
      );
      return;
    }

    if (request.url === "/webhook" && request.method === "POST") {
      openClawPayloads.push({
        headers: request.headers,
        body: await readRequestBody(request),
      });
      response.writeHead(202).end();
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const config: RegulatorConfig = {
    checkpointFile,
    queueDir,
    maxQueueThreshold: 3,
    replayBatchSize: 8,
    hubproxyReplayUrl: `${baseUrl}/api/replay`,
    openclawWebhookUrl: `${baseUrl}/webhook`,
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
      pull_request: {
        allowedActions: ["opened"],
        allowedRepositories: ["yourorg/repo1"],
        requiredLabels: [],
        excludeLabels: [],
        allowedSenders: ["mark"],
        requiredConclusion: [],
        titleIncludesAny: ["release"],
        bodyIncludesAny: [],
        fieldConditions: [],
      },
    },
    transformations: {
      pull_request: {
        keep: [
          "action",
          "number",
          "title",
          "html_url",
          "repository.full_name",
          "pull_request.user.login",
          "pull_request.body",
        ],
        shorten: [{ field: "pull_request.body", maxLength: 20, suffix: "..." }],
        rename: {
          html_url: "pr_url",
        },
        add: {
          type: "pull_request",
        },
        computed: [],
        messageTemplates: [
          {
            template:
              "Workflow alert for {{payload.repository.full_name}}: {{payload.title}} by {{payload.pull_request.user.login}} ({{payload.pr_url}})",
            filters: {
              allowedActions: ["opened"],
              allowedRepositories: ["yourorg/repo1"],
              requiredLabels: [],
              excludeLabels: [],
              allowedSenders: [],
              requiredConclusion: [],
              titleIncludesAny: ["release"],
              bodyIncludesAny: [],
              fieldConditions: [],
            },
          },
          {
            template: "Default PR template for {{payload.type}}",
          },
        ],
      },
    },
  };

  try {
    process.env.OPENCLAW_HOOKS_TOKEN = "integration-test-token";
    const regulator = new EventRegulator(config, new Logger("error"));
    const cycleTime = new Date("2026-04-23T10:00:00.000Z");
    const result = await regulator.runOnce(cycleTime);

    assert.equal(result.status, "completed");
    assert.equal(result.forwardedCount, 1);
    assert.equal(openClawPayloads.length, 1);

    assert.deepEqual(JSON.parse(openClawPayloads[0]!.body), {
      text:
        "Workflow alert for yourorg/repo1: Release customer fix by mark (https://github.com/yourorg/repo1/pull/42)",
      mode: "now",
    });

    assert.equal(openClawPayloads[0]!.headers["x-github-event"], "pull_request");
    assert.equal(openClawPayloads[0]!.headers["x-hub-signature-256"], "sha256=deadbeef");
    assert.equal(openClawPayloads[0]!.headers.authorization, "Bearer integration-test-token");

    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8")) as {
      lastSuccessfulUntil: string;
    };

    assert.equal(checkpoint.lastSuccessfulUntil, cycleTime.toISOString());

    assert.equal(replayRequestBody, "");
    const replayUrl = new URL(replayRequestUrl, baseUrl);
    assert.equal(replayUrl.searchParams.get("limit"), "8");
    assert.equal(replayUrl.searchParams.get("since"), "2026-04-23T08:00:00.000Z");
    assert.equal(replayUrl.searchParams.get("until"), cycleTime.toISOString());
    assert.deepEqual(replayUrl.searchParams.getAll("types"), ["pull_request"]);
  } finally {
    delete process.env.OPENCLAW_HOOKS_TOKEN;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("treats a replay 404 as an empty event batch", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-regulator-"));
  const queueDir = path.join(tempDir, "delivery-queue");
  const checkpointFile = path.join(tempDir, "checkpoint.json");
  await mkdir(queueDir, { recursive: true });

  let replayRequestUrl = "";
  let replayCalls = 0;

  const server = http.createServer((request, response) => {
    if (!request.url) {
      response.writeHead(404).end();
      return;
    }

    if (request.url.startsWith("/api/replay?") && request.method === "POST") {
      replayRequestUrl = request.url;
      replayCalls += 1;
      response.writeHead(404).end();
      return;
    }

    if (request.url === "/webhook") {
      response.writeHead(500).end();
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const config: RegulatorConfig = {
    checkpointFile,
    queueDir,
    maxQueueThreshold: 3,
    replayBatchSize: 8,
    hubproxyReplayUrl: `${baseUrl}/api/replay`,
    openclawWebhookUrl: `${baseUrl}/webhook`,
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
    filters: {},
    transformations: {
      pull_request: {
        keep: ["action"],
        shorten: [],
        rename: {},
        add: {},
        computed: [],
      },
    },
  };

  try {
    process.env.OPENCLAW_HOOKS_TOKEN = "integration-test-token";
    const regulator = new EventRegulator(config, new Logger("error"));
    const cycleTime = new Date("2026-04-23T10:00:00.000Z");
    const result = await regulator.runOnce(cycleTime);

    assert.equal(result.status, "completed");
    assert.equal(result.replayedCount, 0);
    assert.equal(result.forwardedCount, 0);
    assert.equal(result.droppedCount, 0);
    assert.equal(replayCalls, 1);

    const replayUrl = new URL(replayRequestUrl, baseUrl);
    assert.equal(replayUrl.searchParams.get("limit"), "8");
    assert.deepEqual(replayUrl.searchParams.getAll("types"), ["pull_request"]);

    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8")) as {
      lastSuccessfulUntil: string;
    };

    assert.equal(checkpoint.lastSuccessfulUntil, cycleTime.toISOString());
  } finally {
    delete process.env.OPENCLAW_HOOKS_TOKEN;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("requires OPENCLAW_HOOKS_TOKEN for OpenClaw forwarding", () => {
  assert.throws(
    () => {
      resolveHooksToken({});
    },
    /OPENCLAW_HOOKS_TOKEN is required/,
  );
});

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}
