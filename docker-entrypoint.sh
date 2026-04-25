#!/bin/sh
set -eu

log() {
  printf '%s\n' "$*"
}

run_regulator() {
  log "[regulator] Starting run: node dist/index.js $*"
  log "[regulator] Config directory: ${REGULATOR_CONFIG_PATH:-/app/data}"
  node dist/index.js "$@"
}

sleep_interval_ms() {
  node -e 'setTimeout(() => process.exit(0), Number(process.argv[1]))' "$1"
}

if [ "$#" -eq 0 ]; then
  set -- --once
fi

case "${1:-}" in
  --help)
    exec node dist/index.js "$@"
    ;;
esac

if [ -z "${REGULATOR_SYNC_INTERVAL:-}" ]; then
  exec node dist/index.js "$@"
fi

case "$REGULATOR_SYNC_INTERVAL" in
  *[!0-9]*|'')
    log "[regulator] REGULATOR_SYNC_INTERVAL must be a positive integer in milliseconds"
    exit 1
    ;;
esac

if [ "$REGULATOR_SYNC_INTERVAL" -le 0 ]; then
  log "[regulator] REGULATOR_SYNC_INTERVAL must be greater than zero"
  exit 1
fi

shutdown_requested=0
trap 'shutdown_requested=1' INT TERM

log "[regulator] Interval: ${REGULATOR_SYNC_INTERVAL}ms"
log "[regulator] Running initial cycle"
run_regulator "$@"

while [ "$shutdown_requested" -eq 0 ]; do
  log "[regulator] Sleeping for ${REGULATOR_SYNC_INTERVAL}ms"
  sleep_interval_ms "$REGULATOR_SYNC_INTERVAL" &
  sleep_pid=$!
  wait "$sleep_pid"

  if [ "$shutdown_requested" -ne 0 ]; then
    break
  fi

  log "[regulator] Starting scheduled cycle"
  if ! run_regulator "$@"; then
    log "[regulator] Scheduled cycle failed; waiting for next interval"
  fi
done

log "[regulator] Shutdown requested, exiting"