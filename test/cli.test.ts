import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfigPath } from "../src/index.js";

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
