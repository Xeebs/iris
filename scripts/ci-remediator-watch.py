#!/usr/bin/env python3
"""Event watcher: spawns the pipeline-remediator agent on CI failure.

Watches GitHub Actions runs on main for the Iris repo and, when a run
completes with conclusion=failure, fires a headless Claude Code session
running the `pipeline-remediator` agent (.claude/agents/pipeline-remediator.md,
default model: Fable) with the failure context in the prompt.

Design notes:
- The local gh token is invalid, so the GitHub REST API is used
  unauthenticated (the repo is public). Polling uses ETag conditional
  requests — 304 responses do not count against the 60 req/h
  unauthenticated rate limit, so the loop is cheap and near-real-time.
- Coordinates with scripts/daemon.py via the shared flock on
  pipeline/worker.lock: a remediation session never runs concurrently
  with a daemon worker session.
- Dedupes by run id (state file survives restarts) and caps remediation
  attempts per workflow per window to prevent fix-loop churn.

Run via systemd: infra/systemd/iris-remediator.service
"""

from __future__ import annotations

import fcntl
import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

IRIS = Path(__file__).resolve().parent.parent
CLAUDE = Path.home() / ".local" / "bin" / "claude"
WORKER_LOCK = IRIS / "pipeline" / "worker.lock"
STATE_DIR = IRIS / "pipeline" / "remediation"
STATE_FILE = STATE_DIR / "state.json"
LOG_DIR = STATE_DIR / "logs"

REPO = "Xeebs/iris"
RUNS_URL = (
    f"https://api.github.com/repos/{REPO}/actions/runs"
    "?branch=main&status=completed&per_page=15"
)

POLL_SECONDS = 60
SESSION_TIMEOUT = 45 * 60          # hard cap on one remediation session
MAX_ATTEMPTS_PER_WINDOW = 3        # per workflow
ATTEMPT_WINDOW_SECONDS = 6 * 3600
LOCK_RETRY_SECONDS = 120           # daemon worker holds the tree — retry soon


def now() -> float:
    return time.time()


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", flush=True)


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {"handled": {}, "attempts": {}}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=1))


def fetch_runs(etag: str | None) -> tuple[list[dict] | None, str | None]:
    """Return (runs, new_etag); runs is None on a 304 (nothing changed)."""
    req = urllib.request.Request(RUNS_URL, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "iris-ci-remediator",
        **({"If-None-Match": etag} if etag else {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.loads(res.read())
            return body.get("workflow_runs", []), res.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return None, etag
        log(f"GitHub API HTTP {e.code}; backing off")
        time.sleep(300)
        return None, etag
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log(f"GitHub API unreachable ({e}); backing off")
        time.sleep(120)
        return None, etag


def branch_head() -> str | None:
    """Current SHA of main, or None if the lookup fails (fail open)."""
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/branches/main",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "iris-ci-remediator"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())["commit"]["sha"]
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        return None


def attempts_in_window(state: dict, workflow: str) -> int:
    cutoff = now() - ATTEMPT_WINDOW_SECONDS
    times = [t for t in state["attempts"].get(workflow, []) if t > cutoff]
    state["attempts"][workflow] = times
    return len(times)


def failed_step_summary(run_id: int) -> str:
    """Best-effort failed-step lookup so the agent starts with context."""
    try:
        out = subprocess.run(
            ["gh", "run", "view", str(run_id), "--json", "jobs", "--jq",
             '[.jobs[] | select(.conclusion=="failure") | '
             '{job: .name, steps: [.steps[] | select(.conclusion=="failure") | .name]}]'],
            capture_output=True, text=True, timeout=60, cwd=IRIS,
        )
        return out.stdout.strip() or "(failed step lookup returned nothing)"
    except (OSError, subprocess.TimeoutExpired):
        return "(failed step lookup unavailable)"


def remediate(run: dict, attempt_no: int) -> None:
    run_id = run["id"]
    workflow = run["name"]
    sha = run["head_sha"]
    steps = failed_step_summary(run_id)

    prompt = (
        f"CI failure event. Workflow: {workflow}. Run id: {run_id}. "
        f"Head SHA: {sha}. Remediation attempt {attempt_no} of "
        f"{MAX_ATTEMPTS_PER_WINDOW} in the current window.\n"
        f"Failed jobs/steps: {steps}\n"
        "Diagnose per your playbook, fix the root cause, verify locally, "
        "commit only your own files, push, and exit."
    )

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    session_log = LOG_DIR / f"run-{run_id}.log"
    log(f"spawning remediator for {workflow} run {run_id} (attempt {attempt_no})")

    with open(session_log, "ab") as lf:
        try:
            subprocess.run(
                [str(CLAUDE), "--agent", "pipeline-remediator",
                 "--dangerously-skip-permissions", "-p", prompt],
                stdout=lf, stderr=subprocess.STDOUT,
                timeout=SESSION_TIMEOUT, cwd=IRIS,
            )
        except subprocess.TimeoutExpired:
            log(f"remediation session for run {run_id} hit the {SESSION_TIMEOUT}s cap")
    log(f"remediator for run {run_id} finished (log: {session_log})")


def main() -> None:
    log(f"watching {REPO} main for failed runs (poll {POLL_SECONDS}s, ETag-conditional)")
    state = load_state()
    etag: str | None = None
    first_poll = True

    while True:
        runs, etag = fetch_runs(etag)
        if runs is not None:
            for run in runs:
                rid = str(run["id"])
                if rid in state["handled"]:
                    continue
                # On the very first poll after startup, absorb history without
                # acting — only react to failures that complete from now on.
                if first_poll:
                    state["handled"][rid] = now()
                    continue
                if run.get("conclusion") != "failure":
                    state["handled"][rid] = now()
                    continue

                # Stale-SHA guard: only remediate failures on the current main
                # HEAD. A failure on an older SHA is either already addressed
                # by a newer commit or will reproduce in that commit's own runs
                # — remediating it just produces churn (and, historically,
                # report-commit loops).
                head = branch_head()
                if head is not None and run.get("head_sha") != head:
                    log(f"run {rid} ({run['name']}) is on stale SHA "
                        f"{str(run.get('head_sha'))[:9]} (main is {head[:9]}); skipping")
                    state["handled"][rid] = now()
                    save_state(state)
                    continue

                workflow = run["name"]
                n = attempts_in_window(state, workflow)
                if n >= MAX_ATTEMPTS_PER_WINDOW:
                    log(f"{workflow} run {rid}: attempt cap reached ({n}); skipping")
                    state["handled"][rid] = now()
                    save_state(state)
                    continue

                # Single-worker guarantee — same flock the daemon uses.
                lock_fd = open(WORKER_LOCK, "a+")
                try:
                    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    lock_fd.close()
                    log(f"worker.lock busy (daemon session running); retrying in {LOCK_RETRY_SECONDS}s")
                    time.sleep(LOCK_RETRY_SECONDS)
                    etag = None  # force a refetch so this failure is revisited
                    break
                try:
                    state["attempts"].setdefault(workflow, []).append(now())
                    state["handled"][rid] = now()
                    save_state(state)
                    remediate(run, n + 1)
                finally:
                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
                    lock_fd.close()

            if first_poll:
                first_poll = False
                save_state(state)

            # keep the handled map from growing unboundedly
            if len(state["handled"]) > 500:
                oldest = sorted(state["handled"], key=state["handled"].get)[:250]
                for k in oldest:
                    del state["handled"][k]
                save_state(state)

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
