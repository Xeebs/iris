# /project:new-connector

Scaffold a new connector for Iris.

## Usage

```
/project:new-connector <connector-name>
```

Example: `/project:new-connector hubspot`

## What This Does

1. Creates `packages/connectors/<name>/` with the full connector structure
2. Generates `src/connector.ts` extending `BaseConnector<TConfig, TEntity>`
3. Generates `src/transformer.ts` for entity transformation (see schema-mapper agent for complex schemas)
4. Generates `src/manifest.ts` with the ConnectorManifest (including `configSchema`)
5. Generates `tests/fixtures/<name>/` with sample API response fixture stubs
6. Generates `src/__tests__/connector.test.ts` with test stubs
7. Adds a commented import + registration call in `packages/connector-sdk/src/registry.ts`
8. Creates a documentation entry at `docs/connectors/<name>.md`

## Instructions for Claude Code

When executing this command:

1. Ask the user for:
   - Connector name (e.g., "hubspot") — used as the package name `@iris/connector-<name>`
   - Auth type (oauth2, api-key, basic)
   - Primary entity types this connector will index (e.g., "contacts, companies, deals")
   - API base URL and any documentation link

2. Scaffold the files listed above, following patterns in `.claude/rules/connector-patterns.md`

3. For `sync()`: stub the generator with a `// TODO: implement` comment and pagination pattern comment — do NOT leave it empty, as an empty generator will typecheck but silently return nothing

4. For OAuth connectors: implement the OAuth2 authorization code flow with PKCE in `src/oauth.ts`. Do not use a shared `OAuthConnector` base class — each connector handles its own OAuth because scopes and token endpoints vary.

5. Run `pnpm typecheck` and confirm zero errors before finishing

6. Remind the user to:
   - Add API credentials to `.env.local` (using the variable names defined in `src/manifest.ts`)
   - Implement the `sync()` generator body
   - Replace fixture stubs with real API response samples
