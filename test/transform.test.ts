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

test("transforms payloads using wildcard array paths in keep rules", () => {
  const rule: EventTransformationConfig = {
    keep: [
      "workflow_run.id",
      "workflow_run.pull_requests[].number",
      "workflow_run.jobs[].steps[].name",
    ],
    shorten: [],
    rename: {},
    add: {},
    computed: [],
  };

  const result = transformPayload(
    {
      workflow_run: {
        id: 24,
        pull_requests: [
          {
            id: 1,
            url: "https://example.test/pulls/315",
            number: 315,
          },
          {
            id: 2,
            url: "https://example.test/pulls/316",
            number: 316,
          },
        ],
        jobs: [
          {
            id: 10,
            steps: [
              { name: "checkout", conclusion: "success" },
              { name: "test", conclusion: "failure" },
            ],
          },
        ],
      },
    },
    rule,
  );

  assert.deepEqual(result, {
    workflow_run: {
      id: 24,
      pull_requests: [{ number: 315 }, { number: 316 }],
      jobs: [
        {
          steps: [{ name: "checkout" }, { name: "test" }],
        },
      ],
    },
  });
});
