# OpenClaw HubProxy Event Regulator

A TypeScript service that sits between HubProxy replay and OpenClaw webhook ingestion.

It wakes up on demand, checks OpenClaw backpressure, replays a bounded event window from HubProxy, applies declarative filtering and payload transformation, forwards only the cleaned payloads to OpenClaw, and advances a durable checkpoint only after a successful cycle.

## Features

- **Cron-first runtime** with explicit `--once` mode for operational simplicity
- **Backpressure aware** queue gating based on the OpenClaw delivery queue directory
- **Declarative config** via YAML with Zod validation and fail-fast startup errors
- **Fine-grained filtering** by event action, repository, labels, sender, workflow conclusion, and custom field conditions
- **Payload transformation** with keep, shorten, rename, add, and computed-field rules
- **Configurable message templates** with ordered first-match selection and default fallbacks
- **Structured JSON logs** without leaking full webhook payloads
- **Checkpoint persistence** in JSON with legacy plain-text checkpoint migration support
- **Retry logic** for transient HubProxy/OpenClaw failures
- **Docker-ready** image and example configs for single-project and multi-project setups

## Expected HubProxy replay contract

The regulator expects `POST /api/replay` with replay arguments in the query string to return replayable event objects, not just a replay count.

Accepted response shapes:

1. A JSON array of events
2. An object containing `events` or `items`

Each event object should provide:

- `event`, `type`, or `name` for the GitHub event name
- `payload`, `body`, or `data` containing the webhook JSON payload
- optional `headers`
- optional `deliveryId`/`delivery_id`, `id`, `timestamp`, `receivedAt`, or `action`

If HubProxy returns only `replayed_count`, the regulator will fail fast because transformation and forwarding require raw event payloads.

## Configuration

The service loads a single YAML or JSON config file at startup.

See:

- `config/regulator-config.yaml`
- `config/regulator-config.multi-project.yaml`

Example:

```yaml
checkpointFile: "/home/openclaw/.hubproxy-checkpoint.json"
queueDir: "/home/openclaw/.openclaw/delivery-queue"
maxQueueThreshold: 3
replayBatchSize: 8
hubproxyReplayUrl: "http://hubproxy:8081/api/replay"
openclawWebhookUrl: "http://openclaw-gateway:18789/webhook"
defaultSinceHours: 2

filters:
  pull_request:
    allowedActions: ["opened", "synchronize", "ready_for_review", "closed", "reopened"]
    allowedRepositories: ["yourorg/repo1"]
    excludeLabels: ["ignore", "wip"]

transformations:
  pull_request:
    keep:
      - action
      - number
      - title
      - html_url
      - state
      - repository.full_name
      - pull_request.user.login
      - pull_request.body
    shorten:
      - field: pull_request.body
        maxLength: 800
    rename:
      html_url: pr_url
    add:
      type: pull_request
    messageTemplates:
      - template: "PR #{{payload.number}} in {{payload.repository.full_name}}: {{payload.title}}"
        filters:
          allowedActions: ["opened", "reopened"]
      - template: "PR update for {{payload.repository.full_name}}: {{payload.title}} ({{payload.pr_url}})"
```

`messageTemplates` are evaluated in order. The first template whose optional `filters` match the original replay event is used. A final entry with no `filters` acts as the default template and must be last. Template placeholders use `{{...}}` paths and can read from:

- `payload.*` or `transformedPayload.*` for the transformed payload sent to OpenClaw
- `event.*` for the original replay event, including `event.payload.*` for untransformed webhook fields

Transformation paths also support array selectors:

- `workflow_run.pull_requests[].number` keeps `number` from every object in the array
- `workflow_run.pull_requests[0].number` keeps it only from the first array entry

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run locally:

```bash
export REGULATOR_CONFIG_PATH=./config/regulator-config.yaml
node --import tsx src/index.ts --once
```

Replay a local events fixture through the configured filters and transformations:

```bash
npm run replay -- --config ./config/regulator-config.yaml --replay-file ./data/test/issues-1.json
```

Omit the detailed `dropped` event list while keeping `droppedCount` in the summary output:

```bash
npm run replay -- --config ./config/regulator-config.yaml --replay-file ./data/test/issues-1.json --omit-dropped
```

## CLI

```bash
export REGULATOR_CONFIG_PATH=/path/to/regulator-config.yaml
node dist/index.js --once
node dist/index.js --config /path/to/regulator-config.yaml --replay-file ./data/test/issues-1.json
```

Options:

| Flag | Description |
| --- | --- |
| `--once` | Run a single regulator cycle and exit |
| `--config <path>` | Optional override for `REGULATOR_CONFIG_PATH` |
| `--replay-file <path>` | Process a local replay/events JSON file and print the filtered/transformed OpenClaw-bound output |
| `--out <path>` | Write replay-file output to a file instead of stdout |
| `--omit-dropped` | Omit the detailed `dropped` array from replay-file output while preserving `droppedCount` |
| `--help` | Print CLI usage |

Environment:

| Variable | Description |
| --- | --- |
| `REGULATOR_CONFIG_PATH` | Path to the YAML/JSON config file |
| `OPENCLAW_HOOKS_TOKEN` | Bearer token sent as `Authorization: Bearer <token>` when forwarding to OpenClaw |
| `REGULATOR_SYNC_INTERVAL` | Optional repeat interval in milliseconds for the Docker entrypoint. If unset, the container runs only the provided CLI command. |

## Cron deployment

Example cron entry:

```cron
* * * * * REGULATOR_CONFIG_PATH=/etc/openclaw/regulator-config.yaml OPENCLAW_HOOKS_TOKEN=your-token /usr/bin/node /opt/openclaw-hubproxy-event-regulator/dist/index.js --once >> /var/log/openclaw-hubproxy-event-regulator.log 2>&1
```

## Docker

Build:

```bash
docker build -t openclaw-hubproxy-event-regulator .
```

Run:

```bash
docker run --rm \
  -e REGULATOR_CONFIG_PATH=/config/regulator-config.yaml \
  -e OPENCLAW_HOOKS_TOKEN=your-token \
  -e REGULATOR_SYNC_INTERVAL=60000 \
  -v /etc/openclaw/regulator-config.yaml:/config/regulator-config.yaml:ro \
  -v /home/openclaw/.openclaw/delivery-queue:/home/openclaw/.openclaw/delivery-queue:ro \
  -v /home/openclaw:/home/openclaw \
  openclaw-hubproxy-event-regulator
```

With `REGULATOR_SYNC_INTERVAL` set, the container entrypoint runs one startup cycle immediately and then repeats `node dist/index.js --once` on that interval. If the variable is omitted, the image behaves like a plain one-shot CLI container and executes the supplied arguments once.

## Project layout

```text
src/
  clients/
  services/
  rules/
test/
config/
```

## Notes

- Version 1 is intentionally **cron-first**. Daemon mode and metrics endpoints are extension points for a follow-up release.
- The checkpoint file is written atomically as JSON and can read the legacy plain-text timestamp format used by the original shell script.
- OpenClaw forwarding requires `OPENCLAW_HOOKS_TOKEN`; the service fails fast if it is missing.
