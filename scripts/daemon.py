#!/usr/bin/env python3
"""Iris build pipeline daemon.

Runs the Claude build pipeline in a continuous loop. Only pauses when:
  - Active model's usage limit is exhausted   →  falls back to the next model in
                                                 CLAUDE_MODEL_CHAIN (sonnet → opus → fable);
                                                 sleeps only when every model is exhausted
  - The task queue is exhausted               →  sleeps 1 hour then researches new tasks
  - Unexpected Claude exit                    →  retries after 2 minutes

There is NO token-budget throttling: the daemon never estimates usage or
pre-emptively sleeps. It runs tasks whenever there is work, and only backs
off when the API itself rejects a request with a usage-limit error.
"""

import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

IRIS        = Path(__file__).resolve().parent.parent
STATE_FILE  = IRIS / "pipeline" / "state.json"
DAEMON_FILE = IRIS / "pipeline" / "daemon.json"
WORKER_LOCK  = IRIS / "pipeline" / "worker.lock"           # shared with heartbeat.sh
QUEUE_MD    = IRIS / "pipeline" / "queue.md"
LOG_DIR     = IRIS / "logs"
CLAUDE      = Path.home() / ".local" / "bin" / "claude"
ENV_FILE    = IRIS / ".env"

SLEEP_QUEUE_EMPTY   = 3600   # 1 hour
SLEEP_UNEXPECTED    = 120    # 2 min
SLEEP_MODEL_SWITCH  = 30     # brief pause before relaunching on a fallback model
SLEEP_LOCK_BUSY     = 300    # another worker (heartbeat) holds the tree — retry in 5 min
SLEEP_CI_PENDING    = 60     # CI run in progress — poll again shortly (costs zero tokens)
SLEEP_NEXT_SESSION  = 15     # session finished its task batch — respawn fresh

# ── model fallback chain ─────────────────────────────────────────────────────
# When the active model's usage limit is exhausted (CLI usage-limit error or the
# pipeline writing rate_limit_hit), the daemon marks that model exhausted and
# relaunches on the next model in the chain. Subagents without a `model:` pin in
# their frontmatter inherit the session model, so the fallback covers them too.
# Override with CLAUDE_MODEL_CHAIN (comma-separated, preferred first) in .env/.env.local.
DEFAULT_MODEL_CHAIN  = "claude-sonnet-4-6,claude-opus-4-8,claude-fable-5"
MODEL_CHAIN: list[str] = []   # populated in main() after env is loaded
# Hold an exhausted model out of rotation for this long when the error message
# carries no reset timestamp (CLAUDE_MODEL_EXHAUSTED_HOLD overrides, seconds):
MODEL_EXHAUSTED_HOLD = 3600.0

BASE_PROMPT = """\
Run the Iris build pipeline as defined in CLAUDE.md. This is a wake-up trigger \
— resume any in-flight work or start fresh if idle.

Rules:
- Read pipeline/state.json first and resume from the recorded phase and active task
- Run all phases in direct sequence for each task: Plan → Implement → Test → Commit → next task
- After committing a task, immediately pick the next UNWORKED High task and continue
- After committing your THIRD task this session, exit cleanly instead (write state and stop) — \
the daemon respawns a fresh session in seconds; short sessions keep context lean and cheap
- Never poll CI with gh in-session — the daemon verifies CI between sessions for free and tells \
you the result at the top of this prompt
- Spawn the task-researcher subagent whenever fewer than 3 UNWORKED items remain in pipeline/queue.md
- If you find the queue has no UNWORKED High or Medium tasks, write current_phase=IDLE and exit.
- Only stop if: (a) the Claude API returns a rate-limit error, or (b) no UNWORKED tasks remain
- On rate-limit: write rate_limit_hit=true and current phase/task to pipeline/state.json, then exit
- On queue exhausted: write current_phase=IDLE to pipeline/state.json, then exit
- Write pipeline/state.json after every phase transition so a crash is recoverable

Do not treat this as a one-task-per-invocation boundary. Drive all work forward until genuinely blocked.\
"""

_running     = True
_wake_early  = False
_current_proc: subprocess.Popen | None = None
_started_at  = datetime.now(timezone.utc).isoformat()

# model fallback state (reader thread sets the flags; main loop consumes them)
_model_exhausted_until: dict[str, float] = {}   # model id → epoch when usable again
_active_model: str | None = None
_limit_hit_detected = False
_limit_reset_epoch  = 0.0


# ── model fallback ───────────────────────────────────────────────────────────

def parse_model_chain() -> list[str]:
    raw = os.environ.get("CLAUDE_MODEL_CHAIN", DEFAULT_MODEL_CHAIN)
    return [m.strip() for m in raw.split(",") if m.strip()]


def pick_model() -> str | None:
    """First model in the chain whose exhaustion hold has expired, else None."""
    now = time.time()
    for model in MODEL_CHAIN:
        if _model_exhausted_until.get(model, 0.0) <= now:
            return model
    return None


def mark_model_exhausted(model: str, reset_epoch: float = 0.0) -> None:
    """Take a model out of rotation until its limit resets (or a default hold)."""
    now = time.time()
    _model_exhausted_until[model] = reset_epoch if reset_epoch > now else now + MODEL_EXHAUSTED_HOLD


def seconds_until_any_model() -> float:
    earliest = min((_model_exhausted_until.get(m, 0.0) for m in MODEL_CHAIN), default=0.0)
    return max(60.0, earliest - time.time())


_LIMIT_MARKERS = (
    "usage limit reached",
    "rate_limit_error",
    "exceeded your rate limit",
    "hit your usage limit",
    "weekly limit",
)


def _scan_for_limit(text: str) -> None:
    """Detect usage/rate-limit errors in CLI error output.

    Only called for non-JSON output lines and error result events — never for
    assistant text, so the pipeline talking *about* rate limiting can't trigger
    a false positive. Usage-limit messages may carry a '...|<epoch>' reset
    timestamp; capture it so the model is held out exactly until its reset.
    """
    global _limit_hit_detected, _limit_reset_epoch
    lowered = text.lower()
    if not any(marker in lowered for marker in _LIMIT_MARKERS):
        return
    _limit_hit_detected = True
    match = re.search(r"\|(\d{10,13})", text)
    if match:
        epoch = float(match.group(1))
        if epoch > 1e12:  # milliseconds → seconds
            epoch /= 1000.0
        _limit_reset_epoch = epoch
        return
    # Human-readable form: "resets 9pm (America/New_York)" / "resets 9:30am"
    match = re.search(
        r"resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?", text, re.I
    )
    if match:
        try:
            hour   = int(match.group(1)) % 12 + (12 if match.group(3).lower() == "pm" else 0)
            minute = int(match.group(2) or 0)
            tz     = ZoneInfo(match.group(4)) if match.group(4) else None
            now_dt = datetime.now(tz)
            reset  = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if reset <= now_dt:
                reset += timedelta(days=1)
            _limit_reset_epoch = reset.timestamp()
        except Exception:
            pass  # unparseable timezone/format — fall back to the default hold


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
        "model":       _active_model,
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
    for env_path in [ENV_FILE, IRIS / ".env.local"]:
        if not env_path.exists():
            continue
        for raw in env_path.read_text().splitlines():
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


def github_ci_status() -> tuple[str, str]:
    """Check the latest GitHub Actions run from the daemon (zero tokens).

    Returns (state, detail) where state is green | red | pending | unknown.
    This replaces in-session `gh` polling, which burned a tool call + turn
    per poll for minutes at a time.
    """
    try:
        out = subprocess.run(
            ["gh", "run", "list", "--limit", "1",
             "--json", "status,conclusion,databaseId,workflowName"],
            cwd=str(IRIS), capture_output=True, text=True, timeout=30,
        )
        runs = json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else []
    except Exception:
        return "unknown", "gh unavailable"
    if not runs:
        return "green", "no runs found"
    run = runs[0]
    rid = run.get("databaseId", "?")
    if run.get("status") != "completed":
        return "pending", f"run {rid} is {run.get('status')}"
    if run.get("conclusion") == "success":
        return "green", f"run {rid} succeeded"
    return "red", f"run {rid} concluded: {run.get('conclusion')}"


def build_prompt(ci_state: str = "unknown", ci_detail: str = "") -> str:
    # Volatile lines go LAST so the prompt prefix stays byte-identical across
    # rapid respawns — that keeps the Anthropic prompt cache warm (5-min TTL)
    # instead of re-ingesting the full context each spawn.
    if ci_state == "red":
        ci_line = (
            f"\n\nCI STATUS (verified by the daemon just now): RED — {ci_detail}. "
            f"Fixing CI is your first and only priority until it is green."
        )
    elif ci_state == "green":
        ci_line = (
            "\n\nCI STATUS (verified by the daemon just now): GREEN. "
            "Skip the Phase 0 gh check and proceed directly to task selection."
        )
    else:
        ci_line = ""

    return BASE_PROMPT + ci_line


def acquire_worker_lock(model: str):
    """Exclusive advisory lock shared with heartbeat.sh — guarantees a single
    pipeline worker per working tree. Returns the held file object, or None if
    another worker owns the tree. Auto-released by the OS if the holder dies."""
    fd = open(WORKER_LOCK, "a+")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fd.close()
        return None
    fd.seek(0)
    fd.truncate()
    fd.write(f"daemon pid {os.getpid()} model {model} started {_now_iso()}\n")
    fd.flush()
    return fd


def release_worker_lock(fd) -> None:
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
        fd.close()
    except Exception:
        pass


# ── stream-json stdout reader ─────────────────────────────────────────────────

def _extract_text(content: list) -> str:
    """Pull plaintext from a Claude message content array."""
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(p for p in parts if p)


def _stdout_reader(proc: subprocess.Popen, log_file_path: Path) -> None:
    """
    Read stream-json stdout line by line.
    - Writes human-readable output to the log file alongside raw JSON-L.
    - Scans CLI/error output for usage-limit errors (drives the model fallback).
    """
    with open(log_file_path, "a", buffering=1) as lf:
        for raw_line in proc.stdout:  # type: ignore[union-attr]
            lf.write(raw_line)

            line = raw_line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                # Non-JSON output is CLI/stderr text — where fatal usage-limit
                # errors land (stderr is merged into stdout).
                _scan_for_limit(line)
                continue

            etype = event.get("type", "")

            if etype == "assistant":
                content = event.get("message", {}).get("content", [])
                text = " ".join(_extract_text(content).split())  # single line — keeps the log greppable
                if text:
                    lf.write(f"[claude] {text[:500]}\n")

            elif etype == "result":
                if event.get("is_error") or str(event.get("subtype", "")).startswith("error"):
                    _scan_for_limit(json.dumps(event))
                dur = event.get("duration_ms", 0)
                lf.write(f"[session] Run ended — dur: {dur / 1000:.1f}s\n")


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
    global MODEL_CHAIN, MODEL_EXHAUSTED_HOLD, _active_model, _limit_hit_detected, _limit_reset_epoch

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    load_env()

    # Re-read model config now that env is loaded
    MODEL_CHAIN          = parse_model_chain()
    MODEL_EXHAUSTED_HOLD = float(os.environ.get("CLAUDE_MODEL_EXHAUSTED_HOLD", str(MODEL_EXHAUSTED_HOLD)))

    write_daemon("starting", "Daemon initializing")

    while _running:
        # ── CI gate (daemon-side, zero tokens) ────────────────────────────────
        ci_state, ci_detail = github_ci_status()
        if ci_state == "pending":
            write_daemon("sleeping", f"Waiting for CI ({ci_detail})", wake_iso(SLEEP_CI_PENDING))
            interruptible_sleep(SLEEP_CI_PENDING)
            continue

        # ── model selection ───────────────────────────────────────────────────
        model = pick_model()
        if model is None:
            wait_sec = seconds_until_any_model()
            write_daemon(
                "sleeping",
                f"All models exhausted ({', '.join(MODEL_CHAIN)}) — "
                f"sleeping {wait_sec / 3600:.1f}h until the earliest limit resets",
                wake_iso(wait_sec),
            )
            interruptible_sleep(wait_sec)
            continue
        _active_model = model

        # ── single-worker guarantee (shared flock with heartbeat.sh) ──────────
        lock_fd = acquire_worker_lock(model)
        if lock_fd is None:
            owner = ""
            try:
                owner = WORKER_LOCK.read_text().strip()
            except Exception:
                pass
            write_daemon(
                "sleeping",
                f"Tree busy — another pipeline worker holds the lock ({owner or 'unknown'}); retrying in 5 minutes",
                wake_iso(SLEEP_LOCK_BUSY),
            )
            interruptible_sleep(SLEEP_LOCK_BUSY)
            continue

        log_file = LOG_DIR / f"daemon-{datetime.now().strftime('%Y%m%d')}.log"

        write_daemon("running", f"Pipeline running on {model}")

        with open(log_file, "a") as lf:
            lf.write(f"\n[{datetime.now().isoformat()}] === Pipeline run starting (model: {model}) ===\n")

        # Reset per-session state
        _limit_hit_detected = False
        _limit_reset_epoch  = 0.0

        _current_proc = subprocess.Popen(
            [
                str(CLAUDE),
                "--dangerously-skip-permissions",
                "--output-format", "stream-json",
                "--verbose",  # required by the CLI for stream-json in --print mode
                "--model", model,
                "-p", build_prompt(ci_state, ci_detail),
            ],
            cwd=str(IRIS),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merged so the reader can scan CLI errors for limit hits
            env=os.environ.copy(),
            text=True,
            bufsize=1,
        )

        reader = threading.Thread(
            target=_stdout_reader,
            args=(_current_proc, log_file),
            daemon=True,
        )
        reader.start()
        returncode = _current_proc.wait()
        reader.join(timeout=5)
        _current_proc = None
        release_worker_lock(lock_fd)

        with open(log_file, "a") as lf:
            lf.write(f"[{datetime.now().isoformat()}] === Pipeline run ended (exit {returncode}) ===\n")

        if not _running:
            break

        # ── post-run decision ─────────────────────────────────────────────────
        state        = read_state()
        rate_limited = state.get("rate_limit_hit", False) or _limit_hit_detected
        phase        = state.get("current_phase", "")

        if rate_limited:
            mark_model_exhausted(model, _limit_reset_epoch)
            if state.get("rate_limit_hit"):
                # Clear the flag so the next run isn't misread as still limited
                state["rate_limit_hit"] = False
                STATE_FILE.write_text(json.dumps(state, indent=2))
            next_model = pick_model()
            if next_model:
                write_daemon(
                    "sleeping",
                    f"{model} usage exhausted — falling back to {next_model}",
                    wake_iso(SLEEP_MODEL_SWITCH),
                )
                interruptible_sleep(SLEEP_MODEL_SWITCH)
            else:
                wait_sec = seconds_until_any_model()
                write_daemon(
                    "sleeping",
                    f"All models exhausted — sleeping {wait_sec / 3600:.1f}h until the earliest limit resets",
                    wake_iso(wait_sec),
                )
                interruptible_sleep(wait_sec)
        elif phase == "IDLE":
            write_daemon("sleeping", "Queue exhausted — resuming in 1 hour for task research", wake_iso(SLEEP_QUEUE_EMPTY))
            interruptible_sleep(SLEEP_QUEUE_EMPTY)
        elif returncode == 0 and phase == "COMMITTED":
            # Clean exit after a completed task batch — respawn a fresh session
            write_daemon("sleeping", "Task batch committed — respawning fresh session", wake_iso(SLEEP_NEXT_SESSION))
            interruptible_sleep(SLEEP_NEXT_SESSION)
        else:
            write_daemon("sleeping", f"Unexpected exit (code {returncode}) — retrying in 2 minutes", wake_iso(SLEEP_UNEXPECTED))
            interruptible_sleep(SLEEP_UNEXPECTED)

    write_daemon("stopped", "Daemon loop exited cleanly")


if __name__ == "__main__":
    main()
