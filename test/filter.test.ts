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
    fieldConditions: [{ path: "pull_request.title", combineWithPrevious: "AND", includesAny: ["customer"] }],
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

test("supports OR chaining and negated field condition matchers", () => {
  const filter: EventFilterConfig = {
    allowedActions: ["opened"],
    allowedRepositories: ["yourorg/repo1"],
    requiredLabels: [],
    excludeLabels: [],
    allowedSenders: [],
    requiredConclusion: [],
    titleIncludesAny: [],
    bodyIncludesAny: [],
    fieldConditions: [
      {
        path: "pull_request.title",
        combineWithPrevious: "AND",
        includesAny: ["nonexistent"],
      },
      {
        path: "pull_request.body",
        combineWithPrevious: "OR",
        matchesRegex: "customer-facing",
      },
      {
        path: "pull_request.body",
        combineWithPrevious: "AND",
        excludesAny: ["internal only"],
      },
      {
        path: "pull_request.merged_at",
        combineWithPrevious: "AND",
        notExists: true,
      },
      {
        path: "sender.login",
        combineWithPrevious: "AND",
        notMatchesRegex: "^bot-",
      },
    ],
  };

  assert.deepEqual(evaluateEventFilter(baseEvent, filter), { allowed: true });
});

test("rejects events when negated field conditions fail after OR grouping", () => {
  const filter: EventFilterConfig = {
    allowedActions: ["opened"],
    allowedRepositories: ["yourorg/repo1"],
    requiredLabels: [],
    excludeLabels: [],
    allowedSenders: [],
    requiredConclusion: [],
    titleIncludesAny: [],
    bodyIncludesAny: [],
    fieldConditions: [
      {
        path: "pull_request.title",
        combineWithPrevious: "AND",
        includesAny: ["customer"],
      },
      {
        path: "sender.login",
        combineWithPrevious: "AND",
        notMatchesRegex: "^mark$",
      },
    ],
  };

  assert.deepEqual(evaluateEventFilter(baseEvent, filter), {
    allowed: false,
    reason: "field_not_regex_mismatch",
  });
});
