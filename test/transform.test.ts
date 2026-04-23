import assert from "node:assert/strict";
import test from "node:test";
import type { EventTransformationConfig } from "../src/config.js";
import { transformPayload } from "../src/rules/transform.js";

test("transforms payloads using keep, shorten, rename, add, and computed rules", () => {
  const rule: EventTransformationConfig = {
    keep: ["action", "html_url", "pull_request.body", "repository.full_name"],
    shorten: [{ field: "pull_request.body", maxLength: 12, suffix: "..." }],
    rename: { html_url: "pr_url" },
    add: { type: "pull_request" },
    computed: [
      {
        field: "body_summary",
        from: "pull_request.body",
        operation: "shorten",
        maxLength: 10,
        suffix: "...",
      },
    ],
  };

  const result = transformPayload(
    {
      action: "opened",
      html_url: "https://github.com/yourorg/repo1/pull/42",
      repository: {
        full_name: "yourorg/repo1",
      },
      pull_request: {
        body: "Very long body text",
      },
    },
    rule,
  );

  assert.deepEqual(result, {
    action: "opened",
    pr_url: "https://github.com/yourorg/repo1/pull/42",
    repository: {
      full_name: "yourorg/repo1",
    },
    pull_request: {
      body: "Very long...",
    },
    body_summary: "Very lo...",
    type: "pull_request",
  });
});
