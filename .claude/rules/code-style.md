# Code Style Rules

## TypeScript

- Strict mode always (`"strict": true` in tsconfig)
- Prefer `type` over `interface` for data shapes; use `interface` for classes to implement
- No `any` — use `unknown` and narrow properly
- All exported functions must have JSDoc comments with `@param` and `@returns`
- Use `zod` for all runtime validation (API inputs, connector responses, env vars)

## Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- MCP tools: `kebab-case` (e.g., `query-context`, `list-entities`)
- Database tables: `snake_case`

## Imports

- Use path aliases (`@iris/connector-sdk`, `@iris/semantic-core`) not relative `../../`
- External imports first, internal imports second, separated by a blank line
- No barrel files (`index.ts` re-exports) in `src/` — import directly

## Error Handling

- Use `Result<T, E>` pattern (neverthrow) for operations that can fail predictably
- Throw only for truly unexpected errors (programmer errors)
- All connector errors must be wrapped in `ConnectorError` with a `retryable` flag
- Never swallow errors silently — log or propagate

## Async

- Always `await` promises; no floating promises
- Use `Promise.allSettled` for fan-out operations where partial failure is acceptable
- Set explicit timeouts on all external API calls (default: 10s)

## Logging

- Use the `logger` from `@iris/core/logger` — never `console.log` in production code
- Log levels: `error` for failures, `warn` for degraded states, `info` for key events, `debug` for traces
- Include structured metadata: `logger.info('Sync complete', { connectorId, recordCount, durationMs })`
