#!/usr/bin/env python3
"""Iris build pipeline daemon.

Runs the Claude build pipeline in a continuous loop. Only pauses when:
  - Token budget >= 95% of configured limit   →  sleeps until window resets
  - Active model's usage limit is exhausted   →  falls back to the next model in
                                                 CLAUDE_MODEL_CHAIN (sonnet → opus → fable);
                                                 sleeps only when every model is exhausted
  - The task queue is exhausted               →  sleeps 1 hour then researches new tasks
  - Unexpected Claude exit                    →  retries after 2 minutes
"""

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

IRIS        = Path(__file__).resolve().parent.parent
STATE_FILE  = IRIS / "pipeline" / "state.json"
DAEMON_FILE = IRIS / "pipeline" / "daemon.json"
USAGE_FILE  = IRIS / "pipeline" / "usage.json"
QUEUE_MD    = IRIS / "pipeline" / "queue.md"
LOG_DIR     = IRIS / "logs"
CLAUDE      = Path.home() / ".local" / "bin" / "claude"
ENV_FILE    = IRIS / ".env"

SLEEP_QUEUE_EMPTY   = 3600   # 1 hour
SLEEP_UNEXPECTED    = 120    # 2 min
SLEEP_MODEL_SWITCH  = 30     # brief pause before relaunching on a fallback model

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

# ── token budget ─────────────────────────────────────────────────────────────
# Set CLAUDE_TOKEN_BUDGET in .env.local to match your plan's per-window limit.
# Set CLAUDE_BUDGET_WINDOW_HOURS to match the rate-limit reset window (default: 5h).
BUDGET_LIMIT        = int(float(os.environ.get("CLAUDE_TOKEN_BUDGET", "2000000")))
BUDGET_WINDOW_HOURS = float(os.environ.get("CLAUDE_BUDGET_WINDOW_HOURS", "5"))
BUDGET_THRESHOLD    = 0.95   # stop at 95%

BASE_PROMPT = """\
Run the Iris build pipeline as defined in CLAUDE.md. This is a wake-up trigger \
— resume any in-flight work or start fresh if idle.

Rules:
- Read pipeline/state.json first and resume from the recorded phase and active task
- Run all phases in direct sequence for each task: Plan → Implement → Test → Commit → next task
- After committing a task, immediately pick the next UNWORKED High task and continue — do NOT stop
- Spawn the task-researcher subagent whenever fewer than 3 UNWORKED items remain in pipeline/queue.md
- If you find the queue has no UNWORKED High or Medium tasks, write current_phase=IDLE and exit.
- Only stop if: (a) the Claude API returns a rate-limit error, (b) no UNWORKED tasks remain, \
or (c) the token budget is at or above 95% of the session limit (see TOKEN BUDGET below)
- On rate-limit: write rate_limit_hit=true and current phase/task to pipeline/state.json, then exit
- On queue exhausted: write current_phase=IDLE to pipeline/state.json, then exit
- On budget threshold reached: write current phase/task to pipeline/state.json, then exit cleanly \
(do NOT start a new task if you estimate it cannot complete within the remaining budget)
- Write pipeline/state.json after every phase transition so a crash is recoverable

Do not treat this as a one-task-per-invocation boundary. Drive all work forward until genuinely blocked.\
"""

_running     = True
_wake_early  = False
_current_proc: subprocess.Popen | None = None
_started_at  = datetime.now(timezone.utc).isoformat()

# shared token counter updated by the stdout-reader thread
_session_tokens_lock   = threading.Lock()
_session_input_tokens  = 0
_session_output_tokens = 0
_budget_kill_triggered = False

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


# ── usage file ────────────────────────────────────────────────────────────────

def read_usage() -> dict:
    try:
        return json.loads(USAGE_FILE.read_text())
    except Exception:
        return {"sessions": []}


def write_usage(usage: dict) -> None:
    tmp = USAGE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(usage, indent=2))
    tmp.replace(USAGE_FILE)


def get_window_tokens(usage: dict) -> int:
    """Sum tokens from sessions that fall inside the current budget window."""
    cutoff = time.time() - (BUDGET_WINDOW_HOURS * 3600)
    return sum(
        s.get("input_tokens", 0) + s.get("output_tokens", 0)
        for s in usage.get("sessions", [])
        if s.get("timestamp", 0) > cutoff
    )


def record_session(input_tokens: int, output_tokens: int) -> None:
    usage    = read_usage()
    sessions = usage.get("sessions", [])
    sessions.append({
        "timestamp":     time.time(),
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
    })
    # Prune entries older than 2× the window
    cutoff   = time.time() - (BUDGET_WINDOW_HOURS * 3600 * 2)
    sessions = [s for s in sessions if s.get("timestamp", 0) > cutoff]
    usage["sessions"] = sessions
    write_usage(usage)


def budget_status() -> tuple[int, int, float]:
    """Return (used_tokens, limit, pct_used) for the current window."""
    used = get_window_tokens(read_usage())
    pct  = used / BUDGET_LIMIT if BUDGET_LIMIT > 0 else 0.0
    return used, BUDGET_LIMIT, pct


def is_near_budget() -> bool:
    _, _, pct = budget_status()
    return pct >= BUDGET_THRESHOLD


def seconds_until_window_resets() -> float:
    """Seconds until the oldest in-window session falls out of scope."""
    usage     = read_usage()
    cutoff    = time.time() - (BUDGET_WINDOW_HOURS * 3600)
    in_window = [s for s in usage.get("sessions", []) if s.get("timestamp", 0) > cutoff]
    if not in_window:
        return 60  # window already clear
    oldest    = min(s["timestamp"] for s in in_window)
    resets_at = oldest + (BUDGET_WINDOW_HOURS * 3600)
    return max(60.0, resets_at - time.time())


# ── helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_daemon(status: str, message: str, sleep_until: str | None = None) -> None:
    used, limit, pct = budget_status()
    payload = {
        "pid":         os.getpid(),
        "status":      status,
        "message":     message,
        "started_at":  _started_at,
        "updated_at":  _now_iso(),
        "sleep_until": sleep_until,
        "model":       _active_model,
        "token_budget": {
            "used":         used,
            "limit":        limit,
            "pct":          round(pct * 100, 1),
            "window_hours": BUDGET_WINDOW_HOURS,
        },
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


def build_prompt() -> str:
    used, limit, pct = budget_status()
    remaining = limit - used
    budget_line = (
        f"\n\nTOKEN BUDGET: {used:,} / {limit:,} tokens used in the last "
        f"{BUDGET_WINDOW_HOURS:.0f}h ({pct * 100:.1f}%). "
        f"Hard stop before {BUDGET_THRESHOLD * 100:.0f}% — approximately {remaining:,} tokens remain. "
        f"Do not start a new task if you estimate it cannot complete within the remaining budget."
    )
    return BASE_PROMPT + budget_line


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
    - Updates shared session token counters.
    - Triggers a SIGTERM if the combined (historical + session) budget is hit.
    """
    global _session_input_tokens, _session_output_tokens, _budget_kill_triggered

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
                msg     = event.get("message", {})
                content = msg.get("content", [])
                usage   = msg.get("usage", {})

                text = _extract_text(content)
                if text:
                    lf.write(f"[claude] {text[:500]}\n")

                with _session_tokens_lock:
                    _session_output_tokens += usage.get("output_tokens", 0)
                    # input_tokens grows with context — keep the running max
                    _session_input_tokens = max(
                        _session_input_tokens,
                        usage.get("input_tokens", 0),
                    )

            elif etype == "result":
                if event.get("is_error") or str(event.get("subtype", "")).startswith("error"):
                    _scan_for_limit(json.dumps(event))
                usage = event.get("usage", {})
                cost  = event.get("cost_usd", 0)
                dur   = event.get("duration_ms", 0)
                with _session_tokens_lock:
                    # Authoritative totals override running estimates
                    _session_input_tokens  = usage.get("input_tokens",  _session_input_tokens)
                    _session_output_tokens = usage.get("output_tokens", _session_output_tokens)
                    sess_in  = _session_input_tokens
                    sess_out = _session_output_tokens
                lf.write(
                    f"[budget] Session total — in: {sess_in:,}  out: {sess_out:,}  "
                    f"cost: ${cost:.4f}  dur: {dur / 1000:.1f}s\n"
                )

            # Mid-session budget check after every event
            with _session_tokens_lock:
                session_total = _session_input_tokens + _session_output_tokens

            historical = get_window_tokens(read_usage())
            combined   = historical + session_total
            pct        = combined / BUDGET_LIMIT if BUDGET_LIMIT > 0 else 0.0

            if pct >= BUDGET_THRESHOLD and not _budget_kill_triggered:
                _budget_kill_triggered = True
                lf.write(
                    f"\n[budget] ⚠  {pct * 100:.1f}% of {BUDGET_LIMIT:,}-token window used "
                    f"({combined:,} tokens). Sending SIGTERM to Claude.\n"
                )
                if proc.poll() is None:
                    proc.terminate()


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
    global _current_proc, _session_input_tokens, _session_output_tokens, _budget_kill_triggered
    global BUDGET_LIMIT, BUDGET_WINDOW_HOURS
    global MODEL_CHAIN, MODEL_EXHAUSTED_HOLD, _active_model, _limit_hit_detected, _limit_reset_epoch

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    load_env()

    # Re-read budget + model config now that env is loaded
    BUDGET_LIMIT        = int(float(os.environ.get("CLAUDE_TOKEN_BUDGET",        str(BUDGET_LIMIT))))
    BUDGET_WINDOW_HOURS = float(os.environ.get("CLAUDE_BUDGET_WINDOW_HOURS", str(BUDGET_WINDOW_HOURS)))
    MODEL_CHAIN          = parse_model_chain()
    MODEL_EXHAUSTED_HOLD = float(os.environ.get("CLAUDE_MODEL_EXHAUSTED_HOLD", str(MODEL_EXHAUSTED_HOLD)))

    write_daemon("starting", "Daemon initializing")

    while _running:
        # ── pre-flight budget check ───────────────────────────────────────────
        if is_near_budget():
            wait_sec       = seconds_until_window_resets()
            used, limit, pct = budget_status()
            msg = (
                f"Token budget at {pct * 100:.1f}% ({used:,}/{limit:,}) — "
                f"sleeping {wait_sec / 3600:.1f}h until window resets"
            )
            write_daemon("sleeping", msg, wake_iso(wait_sec))
            interruptible_sleep(wait_sec)
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

        log_file = LOG_DIR / f"daemon-{datetime.now().strftime('%Y%m%d')}.log"

        write_daemon("running", f"Pipeline running on {model}")

        with open(log_file, "a") as lf:
            lf.write(f"\n[{datetime.now().isoformat()}] === Pipeline run starting (model: {model}) ===\n")

        # Reset per-session state
        _session_input_tokens  = 0
        _session_output_tokens = 0
        _budget_kill_triggered = False
        _limit_hit_detected    = False
        _limit_reset_epoch     = 0.0

        _current_proc = subprocess.Popen(
            [
                str(CLAUDE),
                "--dangerously-skip-permissions",
                "--output-format", "stream-json",
                "--verbose",  # required by the CLI for stream-json in --print mode
                "--model", model,
                "-p", build_prompt(),
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

        with open(log_file, "a") as lf:
            lf.write(f"[{datetime.now().isoformat()}] === Pipeline run ended (exit {returncode}) ===\n")

        # Persist this session's token usage
        with _session_tokens_lock:
            sess_in  = _session_input_tokens
            sess_out = _session_output_tokens
        if sess_in + sess_out > 0:
            record_session(sess_in, sess_out)

        if not _running:
            break

        # ── post-run decision ─────────────────────────────────────────────────
        state        = read_state()
        rate_limited = state.get("rate_limit_hit", False) or _limit_hit_detected
        phase        = state.get("current_phase", "")
        budget_hit   = _budget_kill_triggered or is_near_budget()

        if budget_hit:
            wait_sec         = seconds_until_window_resets()
            used, limit, pct = budget_status()
            write_daemon(
                "sleeping",
                f"Token budget at {pct * 100:.1f}% — sleeping {wait_sec / 3600:.1f}h until window resets",
                wake_iso(wait_sec),
            )
            interruptible_sleep(wait_sec)
        elif rate_limited:
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
        else:
            write_daemon("sleeping", f"Unexpected exit (code {returncode}) — retrying in 2 minutes", wake_iso(SLEEP_UNEXPECTED))
            interruptible_sleep(SLEEP_UNEXPECTED)

    write_daemon("stopped", "Daemon loop exited cleanly")


if __name__ == "__main__":
    main()
