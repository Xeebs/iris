#!/usr/bin/env python3
"""Move COMMITTED task blocks from pipeline/queue.md to pipeline/queue-archive.md.

Every pipeline session reads queue.md, so completed history directly costs
tokens each cycle. This keeps the live queue small. DEPRIORITIZED tasks stay
in the queue — they are signposts for post-slice resumption.

Idempotent. Run after any commit that marks a task COMMITTED:
    python3 scripts/archive-queue.py
"""

import re
import sys
from datetime import date
from pathlib import Path

IRIS       = Path(__file__).resolve().parent.parent
QUEUE_MD   = IRIS / "pipeline" / "queue.md"
ARCHIVE_MD = IRIS / "pipeline" / "queue-archive.md"

ARCHIVE_HEADER = """\
# Iris — Build Pipeline Queue Archive

COMMITTED tasks moved out of `queue.md` by `scripts/archive-queue.py` to keep
the live queue small. Layer headings are repeated per archival batch.
"""


def split_sections(lines: list[str]) -> tuple[list[str], list[tuple[str, list[str]]]]:
    """Split queue lines into (preamble, [(layer_heading, section_lines), ...])."""
    preamble: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current_heading: str | None = None
    current: list[str] = []
    for line in lines:
        if line.startswith("## "):
            if current_heading is not None:
                sections.append((current_heading, current))
            current_heading = line
            current = []
        elif current_heading is None:
            preamble.append(line)
        else:
            current.append(line)
    if current_heading is not None:
        sections.append((current_heading, current))
    return preamble, sections


def split_tasks(section_lines: list[str]) -> tuple[list[str], list[list[str]]]:
    """Split a layer section into (intro_lines, [task_block_lines, ...])."""
    intro: list[str] = []
    blocks: list[list[str]] = []
    current: list[str] | None = None
    for line in section_lines:
        if line.startswith("### Task:"):
            if current is not None:
                blocks.append(current)
            current = [line]
        elif current is None:
            intro.append(line)
        else:
            current.append(line)
    if current is not None:
        blocks.append(current)
    return intro, blocks


def block_status(block: list[str]) -> str:
    for line in block:
        m = re.match(r"-\s*\*\*Status\*\*:\s*(\S+)", line)
        if m:
            return m.group(1).strip()
    return "UNKNOWN"


def main() -> int:
    lines = QUEUE_MD.read_text().splitlines()
    preamble, sections = split_sections(lines)

    kept_out: list[str] = list(preamble)
    archived_out: list[str] = []
    archived_count = 0

    for heading, body in sections:
        intro, blocks = split_tasks(body)
        kept_blocks     = [b for b in blocks if not block_status(b).startswith("COMMITTED")]
        archived_blocks = [b for b in blocks if block_status(b).startswith("COMMITTED")]

        if archived_blocks:
            archived_out.append(heading)
            for b in archived_blocks:
                archived_out.extend(b)
            archived_count += len(archived_blocks)

        if blocks and not kept_blocks:
            continue  # layer fully completed — heading and intro move out with it
        kept_out.append(heading)
        kept_out.extend(intro)
        for b in kept_blocks:
            kept_out.extend(b)

    if archived_count == 0:
        print("queue.md: nothing to archive")
        return 0

    if ARCHIVE_MD.exists():
        archive_text = ARCHIVE_MD.read_text().rstrip("\n")
    else:
        archive_text = ARCHIVE_HEADER.rstrip("\n")
    archive_text += f"\n\n---\n\n<!-- archived {date.today().isoformat()} -->\n\n"
    archive_text += "\n".join(archived_out).strip("\n") + "\n"

    # Collapse runs of blank lines left behind by removed blocks
    queue_text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept_out)).strip("\n") + "\n"

    ARCHIVE_MD.write_text(archive_text)
    QUEUE_MD.write_text(queue_text)
    print(
        f"archived {archived_count} COMMITTED task(s) → {ARCHIVE_MD.name}; "
        f"queue.md now {len(queue_text.splitlines())} lines"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
