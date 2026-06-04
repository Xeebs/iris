#!/usr/bin/env python3
"""Iris build pipeline daemon.

Runs the Claude build pipeline in a continuous loop. Only pauses when:
  - The Claude API returns a rate-limit error  →  sleeps 1 hour
  - The task queue is exhausted               →  sleeps 2 hours then researches new tasks
  - Unexpected Claude exit                    →  retries after 2 minutes
"""

import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

IRIS = Path(__file__).resolve().parent.parent
STATE_FILE  = IRIS / "pipeline" / "state.json"
DAEMON_FILE = IRIS / "pipeline" / "daemon.json"
LOG_DIR     = IRIS / "logs"
CLAUDE      = Path.home() / ".local" / "bin" / "claude"
ENV_FILE    = IRIS / ".env"

SLEEP_RATE_LIMITED  = 3600      # 1 hour
SLEEP_QUEUE_EMPTY   = 2 * 3600  # 2 hours — task research will add new items
SLEEP_UNEXPECTED    = 120       # 2 min retry on unexpected exit

PROMPT = """\
Run the Iris build pipeline as defined in CLAUDE.md. This is a wake-up trigger \
— resume any in-flight work or start fresh if idle.

Rules:
- Read pipeline/state.json first and resume from the recorded phase and active task
- Run all phases in direct sequence for each task: Plan → Implement → Test → Commit → next task
- After committing a task, immediately pick the next UNWORKED High task and continue — do NOT stop
- Run task research (spawn the task-researcher subagent) only if: (a) fewer than 3 UNWORKED items remain \
AND (b) last_research is not today; skip otherwise
- Only stop if: (a) the Claude API returns a rate-limit error, or (b) the queue has no UNWORKED \
High or Medium tasks left
- On rate-limit: write rate_limit_hit=true and current phase/task to pipeline/state.json, then exit
- On queue exhausted: write current_phase=IDLE to pipeline/state.json, then exit
- Write pipeline/state.json after every phase transition so a crash is recoverable

Do not treat this as a one-task-per-invocation boundary. Drive all work forward until genuinely blocked.\
"""

_running     = True
_wake_early  = False
_current_proc: subprocess.Popen | None = None
_started_at  = datetime.now(timezone.utc).isoformat()


# ── helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_daemon(status: str, message: str, sleep_until: str | None = None) -> None:
    payload = {
        "pid":         os.getpid(),
        "status":      status,
        "message":     message,
        "started_at":  _started_at,
        "updated_at":  _now_iso(),
        "sleep_until": sleep_until,
    }
    tmp = DAEMON_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(DAEMON_FILE)


def read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def load_env() -> None:
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def wake_iso(seconds_from_now: float) -> str:
    return datetime.fromtimestamp(time.time() + seconds_from_now, tz=timezone.utc).isoformat()


def interruptible_sleep(seconds: float) -> None:
    global _wake_early
    deadline = time.monotonic() + seconds
    while _running and time.monotonic() < deadline:
        if _wake_early:
            _wake_early = False
            return
        time.sleep(1)


# ── signal handling ───────────────────────────────────────────────────────────

def _on_signal(signum, frame) -> None:
    global _running, _current_proc
    _running = False
    if _current_proc and _current_proc.poll() is None:
        _current_proc.terminate()
    write_daemon("stopped", "Daemon stopped by signal")
    sys.exit(0)

def _on_sigusr1(signum, frame) -> None:
    global _wake_early
    _wake_early = True


signal.signal(signal.SIGTERM, _on_signal)
signal.signal(signal.SIGINT,  _on_signal)
signal.signal(signal.SIGUSR1, _on_sigusr1)


# ── main loop ─────────────────────────────────────────────────────────────────

def main() -> None:
    global _current_proc

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    load_env()
    write_daemon("starting", "Daemon initializing")

    while _running:
        log_file = LOG_DIR / f"daemon-{datetime.now().strftime('%Y%m%d')}.log"
        write_daemon("running", "Pipeline running")

        with open(log_file, "a", buffering=1) as lf:
            sep = f"\n[{datetime.now().isoformat()}] === Pipeline run starting ===\n"
            lf.write(sep)

            _current_proc = subprocess.Popen(
                [str(CLAUDE), "--dangerously-skip-permissions", "-p", PROMPT],
                cwd=str(IRIS),
                stdout=lf,
                stderr=subprocess.STDOUT,
                env=os.environ.copy(),
            )
            returncode = _current_proc.wait()
            _current_proc = None

            lf.write(f"[{datetime.now().isoformat()}] === Pipeline run ended (exit {returncode}) ===\n")

        if not _running:
            break

        state = read_state()
        rate_limited = state.get("rate_limit_hit", False)
        phase        = state.get("current_phase", "")

        if rate_limited:
            sleep_sec = SLEEP_RATE_LIMITED
            write_daemon("sleeping", "Rate limited — resuming in 1 hour", wake_iso(sleep_sec))
        elif phase == "IDLE":
            sleep_sec = SLEEP_QUEUE_EMPTY
            write_daemon("sleeping", "Queue exhausted — resuming in 2 hours for task research", wake_iso(sleep_sec))
        else:
            sleep_sec = SLEEP_UNEXPECTED
            write_daemon("sleeping", f"Unexpected exit (code {returncode}) — retrying in 2 minutes", wake_iso(sleep_sec))

        interruptible_sleep(sleep_sec)

    write_daemon("stopped", "Daemon loop exited cleanly")


if __name__ == "__main__":
    main()
