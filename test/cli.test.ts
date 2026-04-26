import assert from "node:assert/strict";
import test from "node:test";
import { formatReplayOutput, parseArgs, resolveConfigPath } from "../src/index.js";

test("uses REGULATOR_CONFIG_PATH when no CLI override is provided", () => {
  assert.equal(
    resolveConfigPath(undefined, { REGULATOR_CONFIG_PATH: "/etc/openclaw/regulator-config.yaml" }),
    "/etc/openclaw/regulator-config.yaml",
  );
});

test("prefers the CLI override over REGULATOR_CONFIG_PATH", () => {
  assert.equal(
    resolveConfigPath("/tmp/custom.yaml", { REGULATOR_CONFIG_PATH: "/etc/openclaw/regulator-config.yaml" }),
    "/tmp/custom.yaml",
  );
});

test("parses replay file CLI options", () => {
  assert.deepEqual(parseArgs(["--config", "./config.yaml", "--replay-file", "./data/test/issues-1.json"]), {
    configPath: "./config.yaml",
    omitDropped: false,
    once: false,
    replayFilePath: "./data/test/issues-1.json",
  });
});

test("parses --omit-dropped for replay file output", () => {
  assert.deepEqual(parseArgs(["--replay-file", "./data/test/issues-1.json", "--omit-dropped"]), {
    omitDropped: true,
    once: false,
    replayFilePath: "./data/test/issues-1.json",
  });
});

test("rejects conflicting execution modes", () => {
  assert.throws(
    () => {
      parseArgs(["--once", "--replay-file", "./data/test/issues-1.json"]);
    },
    /either --once or --replay-file/,
  );
});

test("rejects --omit-dropped without replay mode", () => {
  assert.throws(
    () => {
      parseArgs(["--once", "--omit-dropped"]);
    },
    /--omit-dropped can only be used together with --replay-file/,
  );
});

test("formatReplayOutput omits dropped details while preserving counts", () => {
  assert.deepEqual(
    formatReplayOutput(
      {
        replayedCount: 2,
        forwardedCount: 1,
        droppedCount: 1,
        forwarded: [
          {
            event: "issues",
            action: "assigned",
            transformedPayload: {
              type: "issues",
            },
            openClawMessage: {
              text: "Issue forwarded",
              mode: "now",
            },
          },
        ],
        dropped: [
          {
            event: "issues",
            action: "closed",
            reason: "action_not_allowed",
          },
        ],
      },
      true,
    ),
    {
      replayedCount: 2,
      forwardedCount: 1,
      droppedCount: 1,
      forwarded: [
        {
          event: "issues",
          action: "assigned",
          transformedPayload: {
            type: "issues",
          },
          openClawMessage: {
            text: "Issue forwarded",
            mode: "now",
          },
        },
      ],
    },
  );
});
