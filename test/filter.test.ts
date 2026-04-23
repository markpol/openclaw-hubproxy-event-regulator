import assert from "node:assert/strict";
import test from "node:test";
import type { EventFilterConfig } from "../src/config.js";
import { evaluateEventFilter } from "../src/rules/filter.js";
import type { ReplayEvent } from "../src/types.js";

const baseEvent: ReplayEvent = {
  event: "pull_request",
  action: "opened",
  headers: {},
  payload: {
    action: "opened",
    title: "Release customer fix",
    repository: {
      full_name: "yourorg/repo1",
    },
    sender: {
      login: "mark",
    },
    pull_request: {
      title: "Release customer fix",
      body: "This is a customer-facing PR body",
      user: {
        login: "mark",
      },
      labels: [{ name: "priority" }],
    },
  },
};

test("allows events that satisfy configured rules", () => {
  const filter: EventFilterConfig = {
    allowedActions: ["opened"],
    allowedRepositories: ["yourorg/repo1"],
    requiredLabels: ["priority"],
    excludeLabels: ["ignore"],
    allowedSenders: ["mark"],
    requiredConclusion: [],
    titleIncludesAny: ["release"],
    bodyIncludesAny: ["customer"],
    fieldConditions: [{ path: "pull_request.title", includesAny: ["customer"] }],
  };

  assert.deepEqual(evaluateEventFilter(baseEvent, filter), { allowed: true });
});

test("rejects events when a required label is missing", () => {
  const filter: EventFilterConfig = {
    allowedActions: ["opened"],
    allowedRepositories: ["yourorg/repo1"],
    requiredLabels: ["bug"],
    excludeLabels: [],
    allowedSenders: [],
    requiredConclusion: [],
    titleIncludesAny: [],
    bodyIncludesAny: [],
    fieldConditions: [],
  };

  assert.equal(evaluateEventFilter(baseEvent, filter).allowed, false);
});
