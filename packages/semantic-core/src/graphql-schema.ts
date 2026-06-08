import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'graphql-schema' });

/** SDL type definitions for the Iris GraphQL schema. */
export const SDL = `
  scalar JSON
  scalar DateTime

  type Entity {
    id: ID!
    type: String!
    label: String!
    workspaceId: String!
    attributes: JSON
    relationships: [EntityRelationship!]
    lastModified: DateTime
    sourceId: String
  }

  type EntityRelationship {
    type: String!
    targetId: String!
  }

  type Metric {
    id: ID!
    name: String!
    value: Float!
    unit: String
    trend: String
    workspaceId: String!
    computedAt: DateTime!
  }

  type GlossaryTerm {
    term: String!
    definition: String!
    synonyms: [String!]
    workspaceId: String!
  }

  type LineageNode {
    entityId: String!
    label: String!
    depth: Int!
    direction: String!
  }

  type QueryResult {
    entities: [Entity!]!
    totalCount: Int!
    truncated: Boolean!
    tokensBudgetUsed: Int!
  }

  type MutationResult {
    success: Boolean!
    entityId: String
    message: String
  }

  type SyncProgress {
    connectorId: String!
    workspaceId: String!
    entitiesSynced: Int!
    totalEntities: Int
    phase: String!
    timestamp: DateTime!
  }

  type GraphQLQueryAudit {
    id: ID!
    workspaceId: String!
    operationName: String
    queryHash: String!
    costTokens: Int!
    executionTimeMs: Int!
    accessedAt: DateTime!
  }

  input EntityFilter {
    type: String
    label: String
    workspaceId: String!
    limit: Int
    cursor: String
  }

  input CreateEntityInput {
    type: String!
    label: String!
    workspaceId: String!
    attributes: JSON
  }

  input UpdateEntityInput {
    id: ID!
    label: String
    attributes: JSON
  }

  type Query {
    entity(id: ID!, workspaceId: String!): Entity
    entities(filter: EntityFilter!): QueryResult!
    metrics(workspaceId: String!, names: [String!]): [Metric!]!
    glossary(workspaceId: String!, term: String): [GlossaryTerm!]!
    lineage(entityId: String!, workspaceId: String!, depth: Int): [LineageNode!]!
    graphqlAuditLog(workspaceId: String!, limit: Int): [GraphQLQueryAudit!]!
  }

  type Mutation {
    createEntity(input: CreateEntityInput!): MutationResult!
    updateEntity(input: UpdateEntityInput!): MutationResult!
    deleteEntity(id: ID!, workspaceId: String!): MutationResult!
    runQuery(query: String!, workspaceId: String!, contextBudget: Int): QueryResult!
  }

  type Subscription {
    onEntityChanged(workspaceId: String!): Entity!
    onMetricUpdated(workspaceId: String!, metricName: String): Metric!
    onSyncProgress(workspaceId: String!, connectorId: String): SyncProgress!
  }
`;

/** All available operation types in the Iris GraphQL schema. */
export type OperationType = 'query' | 'mutation' | 'subscription';

/** Parsed GraphQL operation extracted from a query string. */
export type ParsedOperation = {
  type: OperationType;
  operationName: string | null;
  rootField: string;
  args: Record<string, unknown>;
  selectionSet: string[];
};

/** Result envelope for all GraphQL responses. */
export type GraphQLResponse<T = unknown> = {
  data?: T;
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }> }>;
  extensions?: { tokensBudgetUsed?: number; executionTimeMs?: number };
};

/**
 * Parse a GraphQL query string to extract the root operation and arguments.
 * This is a structural parser — it extracts the root field and its argument
 * names so that resolvers can be dispatched without requiring graphql-js.
 * @param queryString - Raw GraphQL query string
 * @returns ParsedOperation or null if unparseable
 */
export function parseOperation(queryString: string): ParsedOperation | null {
  try {
    const cleaned = queryString.replace(/\s+/g, ' ').trim();

    // Extract operation type and optional name
    const opMatch = cleaned.match(/^(query|mutation|subscription)(?:\s+(\w+))?\s*[({]/i);
    const opType: OperationType = opMatch
      ? (opMatch[1]!.toLowerCase() as OperationType)
      : 'query';
    const operationName = opMatch?.[2] ?? null;

    // Extract root field name (first field in selection set)
    const rootFieldMatch = cleaned.match(/[{]\s*(\w+)/);
    if (!rootFieldMatch) return null;
    const rootField = rootFieldMatch[1]!;

    // Extract inline args from root field call: fieldName(argName: value, ...)
    const argsMatch = cleaned.match(new RegExp(`${rootField}\\s*\\(([^)]+)\\)`));
    const args: Record<string, unknown> = {};
    if (argsMatch) {
      const argsStr = argsMatch[1]!;
      // Parse simple key: "value" or key: number patterns
      const argPairs = argsStr.matchAll(/(\w+)\s*:\s*(?:"([^"]*)"|\$(\w+)|([\d.]+)|(true|false))/g);
      for (const [, key, strVal, varRef, numVal, boolVal] of argPairs) {
        if (key) {
          if (strVal !== undefined) args[key] = strVal;
          else if (varRef !== undefined) args[key] = { $var: varRef };
          else if (numVal !== undefined) args[key] = parseFloat(numVal);
          else if (boolVal !== undefined) args[key] = boolVal === 'true';
        }
      }
    }

    // Extract selection set fields
    const innerMatch = cleaned.match(/[{]([^}]+)[}]\s*[}]?\s*$/);
    const selectionSet: string[] = innerMatch
      ? innerMatch[1]!.split(/[\s,]+/).map(s => s.trim()).filter(s => /^\w+$/.test(s))
      : [];

    return { type: opType, operationName, rootField, args, selectionSet };
  } catch {
    return null;
  }
}

/**
 * Compute a stable hash for a GraphQL query string (used for audit logging).
 * @param queryString - Raw GraphQL query
 * @returns 8-character hex hash
 */
export function hashGraphQLQuery(queryString: string): string {
  const normalized = queryString.replace(/\s+/g, ' ').trim();
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Validate that variables passed to the operation conform to required arg names.
 * @param operation - Parsed operation
 * @param variables - Runtime variables
 * @returns Merged args with variable substitutions applied
 */
export function mergeVariables(
  operation: ParsedOperation,
  variables: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(operation.args)) {
    if (typeof v === 'object' && v !== null && '$var' in v) {
      const varName = (v as { $var: string }).$var;
      merged[k] = variables[varName];
    } else {
      merged[k] = v;
    }
  }
  // Also include any variables whose names match arg names directly
  for (const [k, v] of Object.entries(variables)) {
    if (!(k in merged)) {
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Estimate token cost for a GraphQL response object.
 * @param data - Response data
 * @returns Estimated token count
 */
export function estimateResponseTokens(data: unknown): number {
  const json = JSON.stringify(data) ?? '';
  return Math.ceil(json.length / 4);
}

/**
 * Build a standardized GraphQL error response.
 * @param message - Error message
 * @param extensions - Optional extensions metadata
 */
export function buildErrorResponse(message: string, extensions?: Record<string, unknown>): GraphQLResponse {
  log.warn('GraphQL error response', { message });
  return {
    errors: [{ message }],
    ...(extensions ? { extensions } : {}),
  };
}

/**
 * Returns the SDL string for introspection or tooling.
 * @returns Full GraphQL SDL
 */
export function getSchemaSDL(): string {
  return SDL;
}
