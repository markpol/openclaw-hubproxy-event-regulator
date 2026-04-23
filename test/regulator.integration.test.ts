import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  let replayRequestBody = "";

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(404).end();
      return;
    }

    if (request.url === "/api/replay" && request.method === "POST") {
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
      },
    },
  };

  try {
    const regulator = new EventRegulator(config, new Logger("error"));
    const cycleTime = new Date("2026-04-23T10:00:00.000Z");
    const result = await regulator.runOnce(cycleTime);

    assert.equal(result.status, "completed");
    assert.equal(result.forwardedCount, 1);
    assert.equal(openClawPayloads.length, 1);

    assert.deepEqual(JSON.parse(openClawPayloads[0]!.body), {
      action: "opened",
      number: 42,
      title: "Release customer fix",
      pr_url: "https://github.com/yourorg/repo1/pull/42",
      repository: {
        full_name: "yourorg/repo1",
      },
      pull_request: {
        user: {
          login: "mark",
        },
        body: "This body is defi...",
      },
      type: "pull_request",
    });

    assert.equal(openClawPayloads[0]!.headers["x-github-event"], "pull_request");
    assert.equal(openClawPayloads[0]!.headers["x-hub-signature-256"], "sha256=deadbeef");

    const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8")) as {
      lastSuccessfulUntil: string;
    };

    assert.equal(checkpoint.lastSuccessfulUntil, cycleTime.toISOString());

    const replayRequest = JSON.parse(replayRequestBody) as { types: string[]; limit: number };
    assert.deepEqual(replayRequest.types, ["pull_request"]);
    assert.equal(replayRequest.limit, 8);
  } finally {
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
