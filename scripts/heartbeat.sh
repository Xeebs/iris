#!/bin/bash
# Iris pipeline heartbeat — fallback cron trigger if the daemon goes quiet.
# Normally the daemon runs continuously; this fires hourly as a safety net.

set -euo pipefail

IRIS="/home/xhasan/my-projects/Iris"
LOG_DIR="$IRIS/logs"
LOG_FILE="$LOG_DIR/heartbeat-$(date +%Y%m%d).log"
CLAUDE="/home/xhasan/.local/bin/claude"
LOCK_FILE="$IRIS/pipeline/worker.lock"   # shared with daemon.py — one pipeline worker per tree

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$LOG_DIR"

# The heartbeat is only a fallback: if the daemon process is alive, it owns the
# pipeline — spawning a second worker in the same tree corrupts in-flight edits.
DAEMON_PID=$(python3 -c "import json; print(json.load(open('$IRIS/pipeline/daemon.json')).get('pid', ''))" 2>/dev/null || true)
if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    log "SKIP — daemon alive (pid $DAEMON_PID); heartbeat not needed"
    exit 0
fi

# Mutual exclusion with any pipeline worker (daemon child or an earlier heartbeat).
# flock is advisory and auto-releases if the holder dies — no stale-lock cleanup.
exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
    log "SKIP — another pipeline worker holds $LOCK_FILE"
    exit 0
fi
printf 'heartbeat pid %s started %s\n' "$$" "$(date -Is)" >&9

find "$LOG_DIR" -name "heartbeat-*.log" -mtime +30 -delete 2>/dev/null || true

log "=== Iris pipeline heartbeat starting ==="

source "$IRIS/.env"
export GITHUB_TOKEN

cd "$IRIS"

PROMPT="Run the Iris build pipeline as defined in CLAUDE.md. This is a wake-up trigger — resume any in-flight work or start fresh if idle.

Rules:
- Read pipeline/state.json first and resume from the recorded phase and active task
- Run all phases in direct sequence for each task: Plan → Implement → Test → Commit → next task
- After committing a task, immediately pick the next UNWORKED High task and continue — do NOT stop
- Run task research (spawn the task-researcher subagent) whenever fewer than 3 UNWORKED items remain — no date restriction; researcher will generate the next batch
- Only stop if: (a) the Claude API returns a rate-limit error, or (b) the queue has no UNWORKED High/Medium tasks left AND task research produced 0 new tasks
- On rate-limit: write rate_limit_hit=true and current phase/task to pipeline/state.json, then exit
- On queue exhausted after research: write current_phase=IDLE to pipeline/state.json, then exit
- Write pipeline/state.json after every phase transition so a crash is recoverable

Do not treat this as a one-task-per-invocation boundary. Drive all work forward until genuinely blocked."

"$CLAUDE" \
    --dangerously-skip-permissions \
    -p "$PROMPT" \
    2>&1 | tee -a "$LOG_FILE"

log "=== Iris pipeline heartbeat complete ==="
