import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveConfigPath } from "../src/index.js";

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
