#!/bin/bash
# Iris pipeline heartbeat — babysitter for the daemon service.
#
# The daemon (iris.service) is the ONLY thing that spawns pipeline workers.
# This cron job just makes sure the service is alive; it must never launch
# its own claude worker — two workers in one tree corrupt each other's
# in-flight edits (observed 2026-06-09).

set -euo pipefail

IRIS="/home/xhasan/my-projects/Iris"
LOG_DIR="$IRIS/logs"
LOG_FILE="$LOG_DIR/heartbeat-$(date +%Y%m%d).log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -name "heartbeat-*.log" -mtime +30 -delete 2>/dev/null || true

if systemctl is-active --quiet iris; then
    log "OK — iris.service active"
    exit 0
fi

# The service may be stopped deliberately while a stray worker finishes
# (transition/maintenance). Never start the daemon under a live worker.
if pgrep -f "Run the Iris build pipeline" >/dev/null 2>&1; then
    log "SKIP — a pipeline worker is active while the service is stopped; not restarting"
    exit 0
fi

log "iris.service not active and no worker running — restarting service"
if sudo -n systemctl restart iris 2>>"$LOG_FILE"; then
    log "iris.service restarted"
else
    log "ERROR — sudo -n systemctl restart iris failed"
    exit 1
fi
