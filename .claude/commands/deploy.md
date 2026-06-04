# /project:deploy

Deploy Iris services to the target environment.

## Usage

```
/project:deploy [--env staging|production] [--service mcp-server|api|dashboard|all]
```

## Instructions for Claude Code

When executing this command:

1. Confirm the target environment with the user if `--env` is not specified
2. Run the pre-deploy checklist:
   - `pnpm build` — confirm all packages build cleanly
   - `pnpm test` — confirm all tests pass
   - `pnpm typecheck` — confirm no type errors
   - Check for uncommitted changes (`git status`)
3. For `staging`: deploy via `fly deploy` or `docker-compose -f docker-compose.prod.yml up -d`
4. For `production`: require explicit user confirmation before proceeding
5. After deploy, run `pnpm health-check --env <env>` to verify all services are healthy
6. Report: deployment duration, service URLs, and any warnings
