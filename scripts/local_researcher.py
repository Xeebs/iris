#!/usr/bin/env python3
"""
Local task researcher for the Iris build pipeline.

Uses Gemma 3 4B (via Ollama) instead of Claude to scan for implementation gaps
and generate new tasks for pipeline/queue.md. This keeps the research phase
cheap and frequent, saving Claude tokens for the actual implementation work.

Usage (called by daemon.py):
    python3 scripts/local_researcher.py        # appends tasks, prints count
    python3 scripts/local_researcher.py --dry  # print proposed tasks, no write
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

IRIS        = Path(__file__).resolve().parent.parent
QUEUE_MD    = IRIS / "pipeline" / "queue.md"
STATE_JSON  = IRIS / "pipeline" / "state.json"
PRD_MD      = IRIS / "docs" / "PRD.md"
RULES_DIR   = IRIS / ".claude" / "rules"

OLLAMA_URL     = "http://localhost:11434/v1/chat/completions"
MODEL          = "gemma3:4b"
OLLAMA_TIMEOUT = 600   # Pi 5 CPU-only: ~5-10 tok/s; large response can take several minutes

SYSTEM_PROMPT = """\
You are a task planner for Iris, a TypeScript monorepo (MCP server + REST API + Next.js dashboard).

Generate exactly 3 NEW implementation tasks not already in the queue. \
Keep descriptions to 1-2 sentences. Keep files list to 2-3 paths.

Output ONLY a JSON array. No prose, no markdown.

Format:
[{"title":"...", "layer":27, "priority":"High|Medium|Low", "description":"...", "files":["path/file.ts"]}]"""


def _ollama_chat(messages: list[dict], max_tokens: int = 900) -> str:
    payload = json.dumps({
        "model":      MODEL,
        "messages":   messages,
        "temperature": 0.3,
        "max_tokens":  max_tokens,
    }).encode()

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"].strip()


def _read_file(path: Path, max_chars: int = 3000) -> str:
    try:
        text = path.read_text()
        return text[:max_chars] + ("…[truncated]" if len(text) > max_chars else "")
    except Exception:
        return ""


def _committed_count(queue_text: str) -> int:
    return queue_text.count("**Status**: COMMITTED")


def _unworked_count(queue_text: str) -> int:
    return queue_text.count("**Status**: UNWORKED")


def _existing_titles(queue_text: str) -> list[str]:
    return re.findall(r"### Task: (.+)", queue_text)


def _next_layer(queue_text: str) -> int:
    layers = [int(m) for m in re.findall(r"\*\*Layer\*\*: (\d+)", queue_text)]
    return (max(layers) + 1) if layers else 27


def _build_context(queue_text: str) -> str:
    committed  = _committed_count(queue_text)
    unworked   = _unworked_count(queue_text)
    next_layer = _next_layer(queue_text)

    # Last UNWORKED / IN_PROGRESS tasks (tail of queue, ~1500 chars max)
    queue_tail = queue_text[-1500:]

    # PRD excerpt — just the first part that lists features
    prd = _read_file(PRD_MD, 1000)

    return f"""Queue: {committed} committed, {unworked} unworked. Next layer: {next_layer}.

Recent queue tasks (last portion):
{queue_tail}

PRD excerpt:
{prd}

Generate 3-5 new UNWORKED tasks not already in the queue above. \
Use next layer {next_layer}. Output only a JSON array."""


def _parse_tasks(raw: str) -> list[dict]:
    """Extract JSON array from model output, tolerating prose or fenced code."""
    # Strip markdown fences if present
    raw = re.sub(r"```[a-z]*\n?", "", raw).strip()
    # Find first '[' ... last ']'
    start = raw.find("[")
    end   = raw.rfind("]")
    if start == -1 or end == -1:
        return []
    try:
        data = json.loads(raw[start : end + 1])
        return [t for t in data if isinstance(t, dict) and "title" in t]
    except json.JSONDecodeError:
        return []


def _format_task(task: dict, next_layer: int) -> str:
    layer    = task.get("layer", next_layer)
    priority = task.get("priority", "Medium")
    title    = task.get("title", "Untitled Task")
    desc     = task.get("description", "")
    files    = task.get("files", [])
    depends  = task.get("depends_on", [])
    today    = date.today().isoformat()

    files_md   = "\n".join(f"  - {f}" for f in files) if files else "  - (see description)"
    depends_md = ", ".join(depends) if depends else "none"

    return f"""
### Task: {title}
- **Layer**: {layer} — Local Research Addition
- **Status**: UNWORKED
- **Priority**: {priority}
- **Description**: {desc}
- **Files**:
{files_md}
- **Depends on**: {depends_md}
- **Added**: {today}
"""


def research(dry_run: bool = False) -> int:
    """Run the researcher. Returns number of tasks added."""
    if not QUEUE_MD.exists():
        print("[researcher] queue.md not found", file=sys.stderr)
        return 0

    queue_text = QUEUE_MD.read_text()
    existing   = set(_existing_titles(queue_text))
    next_layer = _next_layer(queue_text)
    context    = _build_context(queue_text)

    print(f"[researcher] Querying {MODEL} for new tasks…", file=sys.stderr)

    try:
        raw = _ollama_chat([
            {"role": "system",  "content": SYSTEM_PROMPT},
            {"role": "user",    "content": context},
        ])
    except Exception as e:
        print(f"[researcher] Ollama error: {e}", file=sys.stderr)
        return 0

    tasks = _parse_tasks(raw)
    if not tasks:
        print("[researcher] No parseable tasks in model output.", file=sys.stderr)
        print(raw[:500], file=sys.stderr)
        return 0

    # Deduplicate against existing queue
    new_tasks = [t for t in tasks if t.get("title", "") not in existing]
    if not new_tasks:
        print("[researcher] All proposed tasks already exist in queue.", file=sys.stderr)
        return 0

    formatted = [_format_task(t, next_layer) for t in new_tasks]

    if dry_run:
        print("\n".join(formatted))
        return len(new_tasks)

    # Append to queue.md
    with open(QUEUE_MD, "a") as f:
        f.write("\n\n---\n\n## Layer 27: Local Research Additions\n")
        for block in formatted:
            f.write(block)

    # Update last_research in state.json
    try:
        state = json.loads(STATE_JSON.read_text())
        state["last_research"] = date.today().isoformat()
        STATE_JSON.write_text(json.dumps(state, indent=2))
    except Exception:
        pass

    print(f"[researcher] Added {len(new_tasks)} tasks to queue.md", file=sys.stderr)
    return len(new_tasks)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="Print tasks without writing")
    args = parser.parse_args()
    count = research(dry_run=args.dry)
    sys.exit(0 if count >= 0 else 1)
