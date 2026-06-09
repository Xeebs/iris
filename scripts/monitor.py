#!/usr/bin/env python3
"""Iris pipeline monitor — live terminal dashboard.

Usage:
    python3 scripts/monitor.py

Press Ctrl+C to exit.
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from time import sleep

from rich import box
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

IRIS        = Path(__file__).resolve().parent.parent
DAEMON_JSON  = IRIS / "pipeline" / "daemon.json"
STATE_JSON   = IRIS / "pipeline" / "state.json"
USAGE_JSON   = IRIS / "pipeline" / "usage.json"
SESSION_JSON = IRIS / "pipeline" / "session-tokens.json"
QUEUE_MD    = IRIS / "pipeline" / "queue.md"
CHANGE_MD   = IRIS / "pipeline" / "changelog.md"
LOG_DIR     = IRIS / "logs"

REFRESH_SEC = 2
LOG_LINES   = 14

STATUS_COLOR = {
    "running":  "bold green",
    "sleeping": "bold yellow",
    "stopped":  "bold red",
    "starting": "bold cyan",
    "error":    "bold red",
}
TASK_STATUS_COLOR = {
    "UNWORKED":      "white",
    "IN_PROGRESS":   "cyan",
    "TESTING":       "yellow",
    "COMMITTED":     "green",
    "DEPRIORITIZED": "red",
}
PRIORITY_COLOR = {
    "High":   "green",
    "Medium": "yellow",
    "Low":    "dim white",
}
TASK_STATUS_ICON = {
    "UNWORKED":      "·",
    "IN_PROGRESS":   "⟳",
    "TESTING":       "⚙",
    "COMMITTED":     "✓",
    "DEPRIORITIZED": "✗",
}

PHASE_STEPS = {
    "PLAN":      1,
    "IMPLEMENT": 2,
    "TEST":      3,
    "COMMITTED": 4,
}
PHASE_TOTAL = 4

_STATUS_SORT_ORDER = {
    "IN_PROGRESS":   0,
    "TESTING":       1,
    "UNWORKED":      2,
    "DEPRIORITIZED": 3,
    "COMMITTED":     4,
}


def _bar(filled: int, total: int, width: int = 18) -> str:
    if total == 0:
        return "░" * width
    blocks = int(round(filled / total * width))
    return "█" * blocks + "░" * (width - blocks)


# ── data readers ─────────────────────────────────────────────────────────────

def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _parse_queue(path: Path) -> list[dict]:
    tasks: list[dict] = []
    current: dict = {}
    try:
        lines = path.read_text().splitlines()
    except Exception:
        return []
    for line in lines:
        if line.startswith("### Task:"):
            if current.get("title"):
                tasks.append(current)
            current = {"title": line[9:].strip()}
        elif current:
            for field in ("Layer", "Status", "Priority"):
                marker = f"**{field}**:"
                if marker in line:
                    val = line.split(marker, 1)[1].strip()
                    if field == "Layer":
                        # Strip the number prefix, e.g. "0 — Foundation" → "Foundation"
                        val = re.sub(r"^\d+\s*[—–-]+\s*", "", val).strip()
                    current[field.lower()] = val
    if current.get("title"):
        tasks.append(current)
    return tasks


def _parse_changelog(path: Path) -> list[str]:
    entries: list[str] = []
    try:
        lines = path.read_text().splitlines()
    except Exception:
        return []
    for line in lines:
        line = line.strip()
        if line.startswith("- ") and (
            "COMMITTED" in line or re.match(r"- \d{4}-\d{2}-\d{2}", line)
        ):
            entries.append(line[2:])
    return entries


def _window_tokens(usage: dict, window_hours: float) -> int:
    """Sum recorded session tokens inside the rolling budget window."""
    cutoff = time.time() - window_hours * 3600
    return sum(
        s.get("input_tokens", 0) + s.get("output_tokens", 0)
        for s in usage.get("sessions", [])
        if s.get("timestamp", 0) > cutoff
    )


# Daemon logs are stream-json (one JSON event per line, often huge). The recent-log
# panel summarizes each event to a single short action line instead of raw output.

_TOOL_ARG_KEYS = ("description", "file_path", "pattern", "skill", "command", "prompt", "query")


def _summarize_tool_use(name: str, inp: dict) -> str:
    for key in _TOOL_ARG_KEYS:
        val = inp.get(key)
        if isinstance(val, str) and val.strip():
            val = " ".join(val.split())
            if key == "file_path":
                val = val.replace(f"{IRIS}/", "")
            return f"{name} · {val[:78]}"
    return name


def _summarize_line(line: str) -> list[tuple[str, str]]:
    """Convert one log line into zero or more (style, summary) entries."""
    line = line.strip()
    if not line:
        return []
    if "=== Pipeline run" in line:
        return [("marker", line[:110])]
    if line.startswith("[budget]"):
        return [("budget", line[:110])]
    if line.startswith("[claude]"):
        return []  # raw text echo — the assistant event below carries the same text
    if not line.startswith("{"):
        style = "error" if re.search(r"error|traceback|fail", line, re.I) else "dim"
        return [(style, line[:110])]

    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return []

    etype = event.get("type", "")
    out: list[tuple[str, str]] = []

    if etype == "system" and event.get("subtype") == "init":
        out.append(("marker", f"▶ session started — {event.get('model', '?')}"))

    elif etype == "assistant":
        for block in event.get("message", {}).get("content", []):
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                summary = _summarize_tool_use(block.get("name", "?"), block.get("input") or {})
                out.append(("tool", f"⚒ {summary}"))
            elif block.get("type") == "text":
                text = " ".join(block.get("text", "").split())
                if text:
                    out.append(("claude", f"💬 {text[:100]}"))

    elif etype == "user":
        for block in event.get("message", {}).get("content", []):
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("is_error"):
                content = block.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        b.get("text", "") for b in content if isinstance(b, dict)
                    )
                content = " ".join(str(content).split())
                out.append(("error", f"✗ tool error · {content[:90]}"))

    elif etype == "result":
        ok     = not event.get("is_error")
        result = " ".join(str(event.get("result", "")).split())
        cost   = event.get("total_cost_usd", event.get("cost_usd", 0)) or 0
        out.append((
            "marker" if ok else "error",
            f"■ run {'completed' if ok else 'FAILED'} — {result[:70]}  (${cost:.2f})",
        ))

    return out


def _recent_actions(n: int = LOG_LINES) -> list[tuple[str, str]]:
    logs = sorted(LOG_DIR.glob("daemon-*.log"))
    if not logs:
        return []
    try:
        with open(logs[-1], "rb") as f:
            f.seek(max(0, logs[-1].stat().st_size - 512 * 1024))
            raw = f.read().decode("utf-8", errors="replace")
    except Exception:
        return []
    actions: list[tuple[str, str]] = []
    for line in raw.splitlines():
        actions.extend(_summarize_line(line))
    return actions[-n:]


# ── panel builders ────────────────────────────────────────────────────────────

def _daemon_panel(daemon: dict) -> Panel:
    status = daemon.get("status", "unknown")
    color  = STATUS_COLOR.get(status, "white")

    t = Text()
    t.append(f"● {status.upper()}\n\n", style=color)

    pid = daemon.get("pid")
    if pid:
        t.append("PID       ", style="dim"); t.append(f"{pid}\n", style="white")

    started = daemon.get("started_at", "")
    if started:
        try:
            dt = datetime.fromisoformat(started).astimezone()
            t.append("Up since  ", style="dim")
            t.append(f"{dt.strftime('%Y-%m-%d %H:%M %Z')}\n", style="white")
        except Exception:
            pass

    msg = daemon.get("message", "")
    if msg:
        t.append(f"\n{msg}\n", style="italic")

    sleep_until = daemon.get("sleep_until")
    if sleep_until and status == "sleeping":
        try:
            wake = datetime.fromisoformat(sleep_until).astimezone()
            remaining = int((wake - datetime.now(tz=wake.tzinfo)).total_seconds())
            if remaining > 0:
                h, rem = divmod(remaining, 3600)
                m, s   = divmod(rem, 60)
                fmt = f"{h}h {m}m" if h else f"{m}m {s}s"
                t.append("\nWakes in  ", style="dim")
                t.append(fmt, style="yellow bold")
        except Exception:
            pass

    border = "green" if status == "running" else ("yellow" if status == "sleeping" else "red")
    return Panel(t, title="[bold]DAEMON[/bold]", border_style=border)


def _pipeline_panel(state: dict, tasks: list[dict]) -> Panel:
    t = Text()
    phase  = state.get("current_phase", "—")
    task   = state.get("active_task")   or "—"
    layer  = state.get("active_layer")  or "—"
    cycles = state.get("cycle_count", 0)
    last   = state.get("last_cycle", "—")
    mode   = state.get("mode", "—")
    notes  = state.get("notes", "")

    phase_style = "cyan bold" if phase not in ("IDLE", "—") else "dim"

    t.append("Phase     ", style="dim"); t.append(f"{phase}\n",  style=phase_style)
    t.append("Task      ", style="dim"); t.append(f"{task}\n",   style="white")
    t.append("Layer     ", style="dim"); t.append(f"{layer}\n",  style="white")
    t.append("Mode      ", style="dim"); t.append(f"{mode}\n",   style="white")
    t.append("Cycle #   ", style="dim"); t.append(f"{cycles}\n", style="white")
    t.append("Last run  ", style="dim"); t.append(f"{last}\n",   style="white")

    phase_num = PHASE_STEPS.get(phase, 0)
    if phase_num > 0 and state.get("active_task"):
        t.append("\n")
        t.append("▸ Phase   ", style="dim")
        t.append(f"[{_bar(phase_num, PHASE_TOTAL)}]", style="cyan bold")
        t.append(f"  {phase_num}/{PHASE_TOTAL}\n", style="cyan")

    if tasks:
        total_tasks     = len(tasks)
        committed_tasks = sum(1 for tk in tasks if tk.get("status", "").strip() == "COMMITTED")
        depri_tasks     = sum(1 for tk in tasks if tk.get("status", "").strip() == "DEPRIORITIZED")
        remaining       = total_tasks - committed_tasks - depri_tasks
        t.append("\n")
        t.append("▸ Queue   ", style="dim")
        t.append(f"[{_bar(committed_tasks, total_tasks)}]", style="green")
        t.append(f"  {committed_tasks}/{total_tasks}", style="green bold")
        if remaining > 0:
            t.append(f"  ({remaining} left)\n", style="yellow")
        else:
            t.append("  all done\n", style="green bold")

    if state.get("rate_limit_hit"):
        t.append("\n⚠  Rate limit hit\n", style="bold yellow")
    if notes:
        t.append(f"\n{notes[:80]}", style="dim italic")

    return Panel(t, title="[bold]PIPELINE[/bold]", border_style="blue")


def _changelog_panel(entries: list[str]) -> Panel:
    t = Text()
    if not entries:
        t.append("No commits yet.", style="dim")
    else:
        for line in reversed(entries[-8:]):
            # Try to extract date and description
            m = re.match(r"(\d{4}-\d{2}-\d{2})[:\s|]+(?:COMMITTED\s+)?(.+)", line)
            if m:
                date, desc = m.group(1), m.group(2)
                t.append("✓ ", style="green bold")
                t.append(f"{desc[:46]}\n", style="white")
                t.append(f"  {date}\n", style="dim")
            else:
                t.append(f"✓ {line[:50]}\n", style="green")
    return Panel(t, title=f"[bold]COMMITTED ({len(entries)})[/bold]", border_style="green")


def _queue_table(tasks: list[dict]) -> Table:
    tbl = Table(box=box.SIMPLE_HEAD, expand=True, show_footer=False, padding=(0, 1))
    tbl.add_column("Task",     ratio=5, no_wrap=False)
    tbl.add_column("Layer",    ratio=2, style="dim")
    tbl.add_column("Priority", ratio=1)
    tbl.add_column("Status",   ratio=2)

    sorted_tasks = sorted(
        tasks,
        key=lambda tk: _STATUS_SORT_ORDER.get(tk.get("status", "UNWORKED").strip(), 2),
    )

    for tk in sorted_tasks:
        status   = tk.get("status",   "UNWORKED").strip()
        priority = tk.get("priority", "").strip()
        layer    = tk.get("layer",    "").strip()
        title    = tk.get("title",    "").strip()

        icon = TASK_STATUS_ICON.get(status, "·")
        tbl.add_row(
            (title[:54] + "…") if len(title) > 54 else title,
            layer[:18],
            Text(priority, style=PRIORITY_COLOR.get(priority, "white")),
            Text(f"{icon} {status}", style=TASK_STATUS_COLOR.get(status, "white")),
        )
    return tbl


def _budget_panel(daemon: dict, usage: dict, session: dict) -> Panel:
    tb    = daemon.get("token_budget", {})
    limit = tb.get("limit", 0)
    hours = tb.get("window_hours", 5)

    # Compute usage live instead of trusting daemon.json (which is only written
    # on daemon state transitions, so it goes stale during long runs).
    window_used = _window_tokens(usage, hours)
    sess_in     = session.get("input_tokens", 0)
    sess_out    = session.get("output_tokens", 0)
    sess_cache  = session.get("cache_read_input_tokens", 0)
    sess_msgs   = session.get("messages", 0)
    live        = (sess_in + sess_out) if daemon.get("status") == "running" else 0
    used        = window_used + live
    pct         = (used / limit * 100) if limit > 0 else 0.0

    t = Text()

    if limit == 0:
        t.append("No budget configured.\n", style="dim")
        t.append("Set CLAUDE_TOKEN_BUDGET in .env.local\n", style="dim italic")
        return Panel(t, title="[bold]TOKEN BUDGET[/bold]", border_style="dim")

    # colour thresholds: green < 70%, yellow < 90%, red >= 90%
    if pct >= 90:
        bar_style = "bold red"
        pct_style = "bold red"
    elif pct >= 70:
        bar_style = "bold yellow"
        pct_style = "bold yellow"
    else:
        bar_style = "bold green"
        pct_style = "bold green"

    filled = int(round(pct / 100 * 20))
    bar    = "█" * filled + "░" * (20 - filled)

    t.append(f"[{bar}]", style=bar_style)
    t.append(f"  {pct:.1f}%\n", style=pct_style)
    t.append("\n")
    t.append("Used      ", style="dim"); t.append(f"{used:,} tokens\n",       style="white")
    t.append("Limit     ", style="dim"); t.append(f"{limit:,} tokens\n",      style="white")
    t.append("Remaining ", style="dim"); t.append(f"{limit - used:,} tokens\n", style=pct_style)
    t.append("Window    ", style="dim"); t.append(f"{hours:.0f}h rolling\n",  style="white")

    if live > 0 or (daemon.get("status") == "running" and sess_msgs > 0):
        t.append("\nLive session\n", style="bold")
        t.append("  ctx in  ", style="dim"); t.append(f"{sess_in:,}\n",  style="cyan")
        t.append("  output  ", style="dim"); t.append(f"{sess_out:,}\n", style="cyan")
        t.append("  cached  ", style="dim"); t.append(f"{sess_cache:,}\n", style="dim cyan")
        t.append("  msgs    ", style="dim"); t.append(f"{sess_msgs:,}\n",  style="white")

    if pct >= 95:
        t.append("\n⚠  Budget paused — waiting for window reset\n", style="bold red")

    border = "red" if pct >= 90 else ("yellow" if pct >= 70 else "green")
    return Panel(t, title="[bold]TOKEN BUDGET[/bold]", border_style=border)


_LOG_STYLE = {
    "marker": "bold cyan",
    "claude": "italic white",
    "tool":   "cyan",
    "budget": "magenta",
    "error":  "red",
    "dim":    "dim",
}


def _log_panel(actions: list[tuple[str, str]]) -> Panel:
    t = Text()
    if not actions:
        t.append("No activity yet.", style="dim")
    for style, line in actions:
        t.append(line + "\n", style=_LOG_STYLE.get(style, "white"))
    return Panel(t, title="[bold]RECENT ACTIVITY[/bold]", border_style="dim white")


# ── layout ────────────────────────────────────────────────────────────────────

def _make_layout() -> Layout:
    layout = Layout()
    layout.split_column(
        Layout(name="header",  size=3),
        Layout(name="body"),
        Layout(name="footer",  size=LOG_LINES + 2),
    )
    layout["body"].split_row(
        Layout(name="left",  ratio=1),
        Layout(name="right", ratio=2),
    )
    layout["left"].split_column(
        Layout(name="daemon",     ratio=2),
        Layout(name="pipeline",   ratio=3),
        Layout(name="budget",     ratio=2),
        Layout(name="changelog",  ratio=2),
    )
    return layout


def _update(layout: Layout) -> None:
    daemon    = _read_json(DAEMON_JSON)
    state     = _read_json(STATE_JSON)
    usage     = _read_json(USAGE_JSON)
    session   = _read_json(SESSION_JSON)
    tasks     = _parse_queue(QUEUE_MD)
    changelog = _parse_changelog(CHANGE_MD)
    actions   = _recent_actions()

    now_str  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    unworked = sum(1 for tk in tasks if tk.get("status", "").strip() == "UNWORKED")

    layout["header"].update(Panel(
        Text.assemble(
            ("IRIS", "bold white"),
            ("  ·  Pipeline Monitor  ·  ", "dim white"),
            (now_str, "dim white"),
            ("  ·  Ctrl+C to quit", "dim"),
        ),
        style="on grey15",
        border_style="grey27",
    ))

    layout["daemon"].update(_daemon_panel(daemon))
    layout["pipeline"].update(_pipeline_panel(state, tasks))
    layout["budget"].update(_budget_panel(daemon, usage, session))
    layout["changelog"].update(_changelog_panel(changelog))

    layout["right"].update(Panel(
        _queue_table(tasks),
        title=f"[bold]QUEUE — {len(tasks)} tasks · {unworked} unworked[/bold]",
        border_style="magenta",
    ))

    layout["footer"].update(_log_panel(actions))


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    console = Console()
    layout  = _make_layout()

    with Live(layout, console=console, refresh_per_second=1, screen=True):
        while True:
            try:
                _update(layout)
            except Exception as exc:
                layout["footer"].update(Panel(
                    Text(f"Monitor error: {exc}", style="red"),
                    title="[bold]ERROR[/bold]",
                    border_style="red",
                ))
            sleep(REFRESH_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
