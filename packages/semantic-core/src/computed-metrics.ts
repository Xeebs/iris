import { logger } from '@iris/core/logger';
import type { SemanticEntity } from '@iris/connector-sdk';

const log = logger.child({ service: 'computed-metrics' });

// ─── AST types ────────────────────────────────────────────────────────────────

export type AggregateFunction = 'sum' | 'avg' | 'count' | 'min' | 'max';

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'field'; entityType: string; fieldName: string }
  | { kind: 'aggregate'; fn: AggregateFunction; entityType: string; fieldName: string; filter?: FilterNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'unary'; op: '-'; operand: FormulaNode };

export type FilterNode = {
  field: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=';
  value: string | number;
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type MetricDefinition = {
  metricId: string;
  workspaceId: string;
  name: string;
  formulaText: string;
  formulaAst: FormulaNode;
  description: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ComputeResult = {
  metricId: string;
  value: number;
  confidence: number;
  entityCountUsed: number;
  executionTimeMs: number;
  computedAt: Date;
};

export type ExplainResult = {
  metricId: string;
  formulaText: string;
  sampleEntities: Array<{ id: string; type: string; relevantFields: Record<string, unknown> }>;
  intermediateSteps: Array<{ description: string; value: number }>;
  finalValue: number;
};

export type ParseError = { kind: 'parse_error'; message: string };
export type ValidationError = { kind: 'validation_error'; message: string; field?: string };
export type ComputeError = { kind: 'compute_error'; message: string };

const SUPPORTED_FUNCTIONS: AggregateFunction[] = ['sum', 'avg', 'count', 'min', 'max'];

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'IDENT'; value: string }
  | { type: 'DOT' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'PLUS' }
  | { type: 'MINUS' }
  | { type: 'STAR' }
  | { type: 'SLASH' }
  | { type: 'COMMA' }
  | { type: 'EOF' };

function tokenize(input: string): Token[] | ParseError {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch)) {
      let num = '';
      while (i < input.length && /[\d.]/.test(input[i]!)) num += input[i++];
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) ident += input[i++];
      tokens.push({ type: 'IDENT', value: ident });
      continue;
    }
    switch (ch) {
      case '.': tokens.push({ type: 'DOT' }); break;
      case '(': tokens.push({ type: 'LPAREN' }); break;
      case ')': tokens.push({ type: 'RPAREN' }); break;
      case '+': tokens.push({ type: 'PLUS' }); break;
      case '-': tokens.push({ type: 'MINUS' }); break;
      case '*': tokens.push({ type: 'STAR' }); break;
      case '/': tokens.push({ type: 'SLASH' }); break;
      case ',': tokens.push({ type: 'COMMA' }); break;
      default: return { kind: 'parse_error', message: `Unexpected character: ${ch}` };
    }
    i++;
  }
  tokens.push({ type: 'EOF' });
  return tokens;
}

// ─── Recursive descent parser ─────────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos] ?? { type: 'EOF' }; }
  private consume(): Token { return this.tokens[this.pos++] ?? { type: 'EOF' }; }
  private expect(type: Token['type']): Token {
    const tok = this.consume();
    if (tok.type !== type) throw new Error(`Expected ${type}, got ${tok.type}`);
    return tok;
  }

  parse(): FormulaNode {
    const node = this.parseAddSub();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token after expression: ${this.peek().type}`);
    }
    return node;
  }

  private parseAddSub(): FormulaNode {
    let left = this.parseMulDiv();
    while (this.peek().type === 'PLUS' || this.peek().type === 'MINUS') {
      const op = this.consume().type === 'PLUS' ? '+' : '-';
      const right = this.parseMulDiv();
      left = { kind: 'binary', op, left, right } as FormulaNode;
    }
    return left;
  }

  private parseMulDiv(): FormulaNode {
    let left = this.parseUnary();
    while (this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
      const op = this.consume().type === 'STAR' ? '*' : '/';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right } as FormulaNode;
    }
    return left;
  }

  private parseUnary(): FormulaNode {
    if (this.peek().type === 'MINUS') {
      this.consume();
      return { kind: 'unary', op: '-', operand: this.parsePrimary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const tok = this.peek();

    if (tok.type === 'NUMBER') {
      this.consume();
      return { kind: 'number', value: tok.value };
    }

    if (tok.type === 'IDENT') {
      const identTok = this.consume() as { type: 'IDENT'; value: string };
      const name = identTok.value.toLowerCase();

      // Aggregate function: sum(entity.field)
      if (SUPPORTED_FUNCTIONS.includes(name as AggregateFunction) && this.peek().type === 'LPAREN') {
        this.expect('LPAREN');
        const entityIdent = this.consume();
        if (entityIdent.type !== 'IDENT') throw new Error('Expected entity type in aggregate');
        this.expect('DOT');
        const fieldIdent = this.consume();
        if (fieldIdent.type !== 'IDENT') throw new Error('Expected field name in aggregate');
        this.expect('RPAREN');
        return {
          kind: 'aggregate',
          fn: name as AggregateFunction,
          entityType: (entityIdent as { type: 'IDENT'; value: string }).value,
          fieldName: (fieldIdent as { type: 'IDENT'; value: string }).value,
        };
      }

      // Field reference: entity.field
      if (this.peek().type === 'DOT') {
        this.expect('DOT');
        const fieldIdent = this.consume();
        if (fieldIdent.type !== 'IDENT') throw new Error('Expected field name');
        return {
          kind: 'field',
          entityType: identTok.value,
          fieldName: (fieldIdent as { type: 'IDENT'; value: string }).value,
        };
      }

      throw new Error(`Unknown identifier: ${identTok.value}`);
    }

    if (tok.type === 'LPAREN') {
      this.consume();
      const inner = this.parseAddSub();
      this.expect('RPAREN');
      return inner;
    }

    throw new Error(`Unexpected token: ${tok.type}`);
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

function evaluateNode(
  node: FormulaNode,
  entityMap: Map<string, SemanticEntity[]>,
): number {
  switch (node.kind) {
    case 'number':
      return node.value;

    case 'field': {
      const entities = entityMap.get(node.entityType.toLowerCase()) ?? [];
      if (entities.length === 0) return 0;
      const val = entities[0]?.attributes[node.fieldName];
      return typeof val === 'number' ? val : 0;
    }

    case 'aggregate': {
      const entities = entityMap.get(node.entityType.toLowerCase()) ?? [];
      const values = entities
        .map((e) => e.attributes[node.fieldName])
        .filter((v): v is number => typeof v === 'number');

      if (values.length === 0) return 0;

      switch (node.fn) {
        case 'sum': return values.reduce((a, b) => a + b, 0);
        case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'count': return entities.length;
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
      }
    }

    case 'binary': {
      const left = evaluateNode(node.left, entityMap);
      const right = evaluateNode(node.right, entityMap);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right === 0 ? 0 : left / right;
      }
    }

    case 'unary':
      return -evaluateNode(node.operand, entityMap);
  }
}

function collectEntityTypes(node: FormulaNode): Set<string> {
  const types = new Set<string>();
  function walk(n: FormulaNode) {
    if (n.kind === 'field' || n.kind === 'aggregate') {
      types.add(n.entityType.toLowerCase());
    } else if (n.kind === 'binary') {
      walk(n.left);
      walk(n.right);
    } else if (n.kind === 'unary') {
      walk(n.operand);
    }
  }
  walk(node);
  return types;
}

// ─── ComputedMetricEngine ─────────────────────────────────────────────────────

export class ComputedMetricEngine {
  private readonly metrics: Map<string, MetricDefinition> = new Map();

  /**
   * Parse a formula string into an AST.
   * @param formula - Formula text, e.g. "sum(subscription.mrr) * 12"
   * @returns FormulaNode AST or ParseError
   */
  parseFormula(formula: string): FormulaNode | ParseError {
    const tokens = tokenize(formula);
    if ('kind' in tokens) return tokens;
    try {
      return new Parser(tokens).parse();
    } catch (err) {
      return { kind: 'parse_error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Validate a parsed AST against available entity types/fields.
   * @param ast - Parsed formula AST
   * @param availableEntityTypes - Set of known entity type names
   * @returns ValidationError if invalid, null if valid
   */
  validateFormula(ast: FormulaNode, availableEntityTypes: Set<string>): ValidationError | null {
    const required = collectEntityTypes(ast);
    for (const type of required) {
      if (!availableEntityTypes.has(type)) {
        return {
          kind: 'validation_error',
          message: `Unknown entity type: '${type}'. Available types: ${Array.from(availableEntityTypes).join(', ')}`,
          field: type,
        };
      }
    }
    return null;
  }

  /**
   * Define a new computed metric in the engine.
   * @param workspaceId - Workspace scope
   * @param name - Human-readable metric name
   * @param formula - Formula text
   * @param description - What this metric represents
   * @returns MetricDefinition or ParseError
   */
  defineMetric(
    workspaceId: string,
    name: string,
    formula: string,
    description: string,
  ): MetricDefinition | ParseError {
    const ast = this.parseFormula(formula);
    if (ast.kind === 'parse_error') return ast;

    const metricId = `${workspaceId}:${name.toLowerCase().replace(/\s+/g, '_')}`;
    const now = new Date();
    const def: MetricDefinition = {
      metricId,
      workspaceId,
      name,
      formulaText: formula,
      formulaAst: ast,
      description,
      createdAt: now,
      updatedAt: now,
    };
    this.metrics.set(metricId, def);
    log.info('Metric defined', { metricId, workspaceId, name });
    return def;
  }

  /**
   * Retrieve a metric definition.
   * @param metricId - Metric to look up
   * @returns MetricDefinition or null
   */
  getMetric(metricId: string): MetricDefinition | null {
    return this.metrics.get(metricId) ?? null;
  }

  /**
   * List all metrics for a workspace.
   * @param workspaceId - Workspace scope
   */
  listMetrics(workspaceId: string): MetricDefinition[] {
    return Array.from(this.metrics.values()).filter((m) => m.workspaceId === workspaceId);
  }

  /**
   * Compute the current value of a metric given entity data.
   * @param metricId - Metric to compute
   * @param entities - Map of entityType → entity array
   * @returns ComputeResult or ComputeError
   */
  computeMetric(
    metricId: string,
    entities: Map<string, SemanticEntity[]>,
  ): ComputeResult | ComputeError {
    const def = this.metrics.get(metricId);
    if (!def) return { kind: 'compute_error', message: `Metric not found: ${metricId}` };

    const start = performance.now();
    try {
      const value = evaluateNode(def.formulaAst, entities);
      const totalEntities = Array.from(entities.values()).reduce((s, arr) => s + arr.length, 0);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      if (!isFinite(value)) {
        return { kind: 'compute_error', message: 'Computation resulted in non-finite value (division by zero?)' };
      }

      log.info('Metric computed', { metricId, value, entityCountUsed: totalEntities, durationMs });
      return {
        metricId,
        value,
        confidence: totalEntities > 0 ? Math.min(1, totalEntities / 10) : 0,
        entityCountUsed: totalEntities,
        executionTimeMs: durationMs,
        computedAt: new Date(),
      };
    } catch (err) {
      return { kind: 'compute_error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Explain how a metric was computed, including sample entities and intermediate values.
   * @param metricId - Metric to explain
   * @param entities - Entity data used for computation
   * @returns ExplainResult or ComputeError
   */
  explainComputation(
    metricId: string,
    entities: Map<string, SemanticEntity[]>,
  ): ExplainResult | ComputeError {
    const def = this.metrics.get(metricId);
    if (!def) return { kind: 'compute_error', message: `Metric not found: ${metricId}` };

    const steps: Array<{ description: string; value: number }> = [];
    const sampleEntities: ExplainResult['sampleEntities'] = [];

    const requiredTypes = collectEntityTypes(def.formulaAst);
    for (const type of requiredTypes) {
      const typeEntities = entities.get(type) ?? [];
      for (const e of typeEntities.slice(0, 3)) {
        sampleEntities.push({
          id: e.id,
          type: e.type,
          relevantFields: e.attributes,
        });
      }
    }

    function explainNode(node: FormulaNode): number {
      switch (node.kind) {
        case 'number':
          steps.push({ description: `Literal value`, value: node.value });
          return node.value;

        case 'aggregate': {
          const vals = (entities.get(node.entityType.toLowerCase()) ?? [])
            .map((e) => e.attributes[node.fieldName])
            .filter((v): v is number => typeof v === 'number');
          const result = evaluateNode(node, entities);
          steps.push({
            description: `${node.fn}(${node.entityType}.${node.fieldName}) over ${vals.length} entities`,
            value: result,
          });
          return result;
        }

        case 'binary': {
          const left = explainNode(node.left);
          const right = explainNode(node.right);
          const result = evaluateNode(node, entities);
          steps.push({ description: `${left} ${node.op} ${right}`, value: result });
          return result;
        }

        case 'unary': {
          const inner = explainNode(node.operand);
          steps.push({ description: `-${inner}`, value: -inner });
          return -inner;
        }

        default:
          return evaluateNode(node, entities);
      }
    }

    const finalValue = explainNode(def.formulaAst);
    return {
      metricId,
      formulaText: def.formulaText,
      sampleEntities,
      intermediateSteps: steps,
      finalValue,
    };
  }
}
