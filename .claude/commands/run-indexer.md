# /project:run-indexer

Trigger a full or incremental index run for a connector instance.

## Usage

```
/project:run-indexer [--connector <id>] [--full] [--dry-run]
```

## Flags

- `--connector <id>` — run only for this connector instance (omit for all)
- `--full` — ignore last sync cursor, re-index everything
- `--dry-run` — show what would be indexed without writing to the store

## Instructions for Claude Code

When executing this command:

1. Run `pnpm mcp:start` if the MCP server isn't already running
2. Execute `pnpm indexer:run` with the appropriate flags
3. Tail the log output and surface:
   - Records synced
   - Entities created / updated / deleted
   - Token estimates for indexed content
   - Any errors or warnings
4. On completion, run `pnpm indexer:stats` and display the coverage summary
