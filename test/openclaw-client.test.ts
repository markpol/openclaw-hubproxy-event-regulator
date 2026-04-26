import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenClawMessage } from "../src/clients/openclaw-client.js";
import type { EventTransformationConfig } from "../src/config.js";
import type { JsonObject, ReplayEvent } from "../src/types.js";

test("buildOpenClawMessage uses the first matching message template", () => {
  const event: ReplayEvent = {
    event: "workflow_run",
    action: "completed",
    deliveryId: "delivery-123",
    headers: {
      "x-github-event": "workflow_run",
    },
    payload: {
      repository: {
        full_name: "yourorg/repo1",
      },
      workflow_run: {
        html_url: "https://github.com/yourorg/repo1/actions/runs/100",
        conclusion: "success",
      },
    },
  };
  const transformedPayload: JsonObject = {
    type: "workflow_run",
    repository: {
      full_name: "yourorg/repo1",
    },
    conclusion: "success",
  };
  const transformation: EventTransformationConfig = {
    keep: ["action"],
    shorten: [],
    rename: {},
    add: {},
    computed: [],
    messageTemplates: [
      {
        template:
          "Run {{payload.conclusion}} for {{payload.repository.full_name}} at {{event.payload.workflow_run.html_url}}",
        filters: {
          allowedActions: ["completed"],
          allowedRepositories: ["yourorg/repo1"],
          requiredLabels: [],
          excludeLabels: [],
          allowedSenders: [],
          requiredConclusion: ["success"],
          titleIncludesAny: [],
          bodyIncludesAny: [],
          fieldConditions: [],
        },
      },
      {
        template: "Second template should not be used",
        filters: {
          allowedActions: ["completed"],
          allowedRepositories: [],
          requiredLabels: [],
          excludeLabels: [],
          allowedSenders: [],
          requiredConclusion: [],
          titleIncludesAny: [],
          bodyIncludesAny: [],
          fieldConditions: [],
        },
      },
      {
        template: "Default workflow template",
      },
    ],
  };

  assert.deepEqual(buildOpenClawMessage(event, transformedPayload, transformation), {
    text: "Run success for yourorg/repo1 at https://github.com/yourorg/repo1/actions/runs/100",
    mode: "now",
  });
});

test("buildOpenClawMessage falls back to the default message template", () => {
  const event: ReplayEvent = {
    event: "workflow_run",
    action: "completed",
    headers: {},
    payload: {
      workflow_run: {
        conclusion: "success",
      },
    },
  };
  const transformedPayload: JsonObject = {
    type: "workflow_run",
  };
  const transformation: EventTransformationConfig = {
    keep: ["action"],
    shorten: [],
    rename: {},
    add: {},
    computed: [],
    messageTemplates: [
      {
        template: "Failure template",
        filters: {
          allowedActions: [],
          allowedRepositories: [],
          requiredLabels: [],
          excludeLabels: [],
          allowedSenders: [],
          requiredConclusion: ["failure"],
          titleIncludesAny: [],
          bodyIncludesAny: [],
          fieldConditions: [],
        },
      },
      {
        template: "Default template for {{event.event}} using {{payload.type}}",
      },
    ],
  };

  assert.deepEqual(buildOpenClawMessage(event, transformedPayload, transformation), {
    text: "Default template for workflow_run using workflow_run",
    mode: "now",
  });
});

test("buildOpenClawMessage exposes the full transformed payload as payload.json", () => {
  const event: ReplayEvent = {
    event: "issues",
    headers: {},
    payload: {
      action: "opened",
    },
  };
  const transformedPayload: JsonObject = {
    type: "issues",
    issue: {
      number: 42,
      title: "Template payload json",
    },
  };
  const transformation: EventTransformationConfig = {
    keep: [],
    shorten: [],
    rename: {},
    add: {},
    computed: [],
    messageTemplates: [
      {
        template: "Payload dump:\n{{payload.json}}",
      },
    ],
  };

  assert.deepEqual(buildOpenClawMessage(event, transformedPayload, transformation), {
    text:
      'Payload dump:\n{\n  "type": "issues",\n  "issue": {\n    "number": 42,\n    "title": "Template payload json"\n  }\n}',
    mode: "now",
  });
});

test("buildOpenClawMessage preserves the legacy fallback when no message templates are configured", () => {
  const event: ReplayEvent = {
    event: "issues",
    headers: {},
    payload: {
      action: "assigned",
    },
  };
  const transformedPayload: JsonObject = {
    type: "issues",
    action: "assigned",
  };

  assert.deepEqual(buildOpenClawMessage(event, transformedPayload), {
    text:
      'A github event has ocurrend. Here are the details: \n{\n  "type": "issues",\n  "action": "assigned"\n}',
    mode: "now",
  });
});
