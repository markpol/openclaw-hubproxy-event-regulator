#!/bin/bash
set -euo pipefail

LOGFILE="/var/log/hubproxy-regulator.log"
CHECKPOINT="/home/openclaw/.hubproxy-checkpoint"
QUEUE_DIR="/home/openclaw/.openclaw/delivery-queue"
HUBPROXY_API="http://hubproxy:8081/api/replay"
TARGET_URL="http://openclaw-gateway:18789/webhook"   # ← must match your HubProxy path
REPLAY_LIMIT=6                                       # max events per cycle (keep low)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') - $*" | tee -a "$LOGFILE"; }

# 1. Check OpenClaw queue backpressure
QUEUE_COUNT=$(find "$QUEUE_DIR" -type f 2>/dev/null | wc -l || echo 0)

if [ "$QUEUE_COUNT" -gt 3 ]; then
    log "Queue busy ($QUEUE_COUNT tasks) → skipping replay"
    exit 0
fi

# 2. Load or initialise checkpoint
if [ -f "$CHECKPOINT" ]; then
    SINCE=$(cat "$CHECKPOINT")
else
    SINCE=$(date -u -d '2 hours ago' +"%Y-%m-%dT%H:%M:%SZ")
fi
UNTIL=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

log "Idle. Replaying events since $SINCE (limit $REPLAY_LIMIT)"

# 3. Replay filtered batch
RESPONSE=$(curl -s -X POST "$HUBPROXY_API" \
    -H "Content-Type: application/json" \
    -d '{
        "since": "'"$SINCE"'",
        "until": "'"$UNTIL"'",
        "types": ["pull_request", "workflow_run", "issues"],
        "limit": '"$REPLAY_LIMIT"',
        "target_url": "'"$TARGET_URL"'"
    }')

REPLAYED=$(echo "$RESPONSE" | jq -r '.replayed_count // 0' 2>/dev/null || echo 0)

log "Replayed $REPLAYED events → new checkpoint $UNTIL"

# 4. Advance checkpoint only on success
if [ "$REPLAYED" != "null" ]; then
    echo "$UNTIL" > "$CHECKPOINT"
fi