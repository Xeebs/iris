import { logger } from '@iris/core/logger';

export type SupportedLanguage = 'typescript' | 'python' | 'go';

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputFormat?: string;
};

export type TypeDefinition = {
  language: SupportedLanguage;
  typeCode: string;
  requestType: string;
  responseType: string;
};

export type ClientLibrary = {
  language: SupportedLanguage;
  code: string;
  className: string;
  methods: string[];
  version: string;
};

export type SdkDocs = {
  markdown: string;
  methods: Array<{
    name: string;
    signature: string;
    description: string;
    example: string;
    errorCodes: string[];
  }>;
};

/**
 * Generates type-safe client SDKs and documentation from MCP tool definitions.
 */
export class SdkCodeGenerator {
  /**
   * Parse a tool definition into a normalized schema.
   * @param toolDefinition - Raw MCP tool definition object
   * @returns Parsed ToolSchema
   */
  parseToolSchema(toolDefinition: Record<string, unknown>): ToolSchema {
    const name = String(toolDefinition['name'] ?? 'unknown-tool');
    const description = String(toolDefinition['description'] ?? '');
    const inputSchema = (toolDefinition['inputSchema'] as Record<string, unknown>) ?? {};
    const outputFormat = toolDefinition['outputFormat'] !== undefined ? String(toolDefinition['outputFormat']) : 'text';

    return { name, description, inputSchema, outputFormat };
  }

  /**
   * Generate type definitions for a tool's request/response in the target language.
   * @param schema - Parsed tool schema
   * @param language - Target language
   * @returns TypeDefinition with generated code
   */
  generateTypeDefinitions(schema: ToolSchema, language: SupportedLanguage): TypeDefinition {
    const typeName = toPascalCase(schema.name);
    const requestType = `${typeName}Request`;
    const responseType = `${typeName}Response`;

    let typeCode: string;

    switch (language) {
      case 'typescript':
        typeCode = this.generateTypeScriptTypes(schema, requestType, responseType);
        break;
      case 'python':
        typeCode = this.generatePythonTypes(schema, requestType, responseType);
        break;
      case 'go':
        typeCode = this.generateGoTypes(schema, requestType, responseType);
        break;
    }

    return { language, typeCode, requestType, responseType };
  }

  /**
   * Generate a complete client library for a list of tools.
   * @param tools - Tool schemas to generate methods for
   * @param language - Target language
   * @param version - SDK version string
   * @returns Complete client library code
   */
  generateClientLibrary(tools: ToolSchema[], language: SupportedLanguage, version = '0.1.0'): ClientLibrary {
    if (tools.length === 0) {
      throw new Error('Cannot generate client library with no tools');
    }

    logger.info('Generating client library', { language, toolCount: tools.length, version });

    const methods = tools.map((t) => toCamelCase(t.name));

    let code: string;
    let className: string;

    switch (language) {
      case 'typescript':
        className = 'IrisClient';
        code = this.generateTypeScriptClient(tools, version);
        break;
      case 'python':
        className = 'IrisClient';
        code = this.generatePythonClient(tools, version);
        break;
      case 'go':
        className = 'IrisClient';
        code = this.generateGoClient(tools, version);
        break;
    }

    return { language, code, className, methods, version };
  }

  /**
   * Generate markdown documentation for a list of tools.
   * @param tools - Tool schemas to document
   * @returns SdkDocs with markdown and structured method docs
   */
  outputDocs(tools: ToolSchema[]): SdkDocs {
    const methods = tools.map((tool) => {
      const methodName = toCamelCase(tool.name);
      const params = extractParams(tool.inputSchema);
      const paramStr = params.map((p) => `${p.name}: ${p.type}`).join(', ');

      return {
        name: methodName,
        signature: `${methodName}({ ${paramStr} }): Promise<string>`,
        description: tool.description,
        example: generateExample(tool),
        errorCodes: ['TOOL_NOT_FOUND', 'VALIDATION_ERROR', 'CONTEXT_BUDGET_EXCEEDED', 'UNAUTHORIZED'],
      };
    });

    const markdown = [
      '# Iris MCP Client SDK',
      '',
      '## Overview',
      '',
      'Auto-generated TypeScript/Python/Go client for the Iris MCP server.',
      '',
      '## Methods',
      '',
      ...methods.map((m) => [
        `### \`${m.name}\``,
        '',
        m.description,
        '',
        '**Signature:**',
        '```typescript',
        m.signature,
        '```',
        '',
        '**Example:**',
        '```typescript',
        m.example,
        '```',
        '',
        '**Error codes:** ' + m.errorCodes.join(', '),
        '',
      ].join('\n')),
    ].join('\n');

    return { markdown, methods };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private generateTypeScriptTypes(schema: ToolSchema, requestType: string, responseType: string): string {
    const props = buildTypeScriptProps(schema.inputSchema);
    return [
      `import { z } from 'zod';`,
      '',
      `export const ${requestType}Schema = z.object({`,
      props.map((p) => `  ${p.name}: ${p.zodType},`).join('\n'),
      '});',
      '',
      `export type ${requestType} = z.infer<typeof ${requestType}Schema>;`,
      '',
      `export type ${responseType} = {`,
      '  content: Array<{ type: "text"; text: string }>;',
      '  truncated?: boolean;',
      '};',
    ].join('\n');
  }

  private generatePythonTypes(schema: ToolSchema, requestType: string, responseType: string): string {
    const props = buildTypeScriptProps(schema.inputSchema);
    return [
      'from pydantic import BaseModel',
      'from typing import Optional, List',
      '',
      `class ${requestType}(BaseModel):`,
      props.length > 0
        ? props.map((p) => `    ${p.name}: ${toPythonType(p.zodType)}`).join('\n')
        : '    pass',
      '',
      `class ${responseType}(BaseModel):`,
      '    content: List[dict]',
      '    truncated: Optional[bool] = None',
    ].join('\n');
  }

  private generateGoTypes(schema: ToolSchema, requestType: string, responseType: string): string {
    const props = buildTypeScriptProps(schema.inputSchema);
    return [
      'package iris',
      '',
      `type ${requestType} struct {`,
      props.map((p) => `\t${toPascalCase(p.name)} ${toGoType(p.zodType)} \`json:"${p.name}"\``).join('\n'),
      '}',
      '',
      `type ${responseType} struct {`,
      '\tContent   []ContentBlock `json:"content"`',
      '\tTruncated bool           `json:"truncated,omitempty"`',
      '}',
      '',
      'type ContentBlock struct {',
      '\tType string `json:"type"`',
      '\tText string `json:"text"`',
      '}',
    ].join('\n');
  }

  private generateTypeScriptClient(tools: ToolSchema[], version: string): string {
    const methodDefs = tools.map((tool) => {
      const methodName = toCamelCase(tool.name);
      const requestType = `${toPascalCase(tool.name)}Request`;
      return [
        `  /** ${tool.description} */`,
        `  async ${methodName}(input: ${requestType}): Promise<string> {`,
        `    return this.callTool('${tool.name}', input);`,
        '  }',
      ].join('\n');
    });

    return [
      `// Iris MCP Client SDK — TypeScript v${version}`,
      `// Auto-generated — do not edit manually`,
      '',
      `export const SDK_VERSION = '${version}';`,
      '',
      'export class IrisClient {',
      '  constructor(',
      '    private readonly apiKey: string,',
      `    private readonly baseUrl: string = 'https://mcp.iris.example.com',`,
      '  ) {}',
      '',
      '  private async callTool(toolName: string, input: Record<string, unknown>): Promise<string> {',
      '    const res = await fetch(`${this.baseUrl}/mcp/tools/${toolName}`, {',
      "      method: 'POST',",
      "      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },",
      '      body: JSON.stringify(input),',
      '    });',
      '    if (!res.ok) throw new Error(`Iris MCP error: ${res.status}`);',
      '    const body = await res.json() as { content: Array<{ text: string }> };',
      '    return body.content.map((c) => c.text).join(\'\');',
      '  }',
      '',
      ...methodDefs,
      '}',
    ].join('\n');
  }

  private generatePythonClient(tools: ToolSchema[], version: string): string {
    const methodDefs = tools.map((tool) => {
      const methodName = toSnakeCase(tool.name);
      const requestType = toPascalCase(tool.name) + 'Request';
      return [
        `    def ${methodName}(self, input: ${requestType}) -> str:`,
        `        """${tool.description}"""`,
        `        return self._call_tool('${tool.name}', input.dict())`,
      ].join('\n');
    });

    return [
      `# Iris MCP Client SDK — Python v${version}`,
      `# Auto-generated — do not edit manually`,
      '',
      'import requests',
      'from typing import Optional',
      '',
      `SDK_VERSION = '${version}'`,
      '',
      'class IrisClient:',
      `    def __init__(self, api_key: str, base_url: str = 'https://mcp.iris.example.com'):`,
      '        self.api_key = api_key',
      '        self.base_url = base_url',
      '',
      '    def _call_tool(self, tool_name: str, input: dict) -> str:',
      '        resp = requests.post(',
      '            f"{self.base_url}/mcp/tools/{tool_name}",',
      "            headers={'Authorization': f'Bearer {self.api_key}'},",
      '            json=input,',
      '            timeout=30,',
      '        )',
      '        resp.raise_for_status()',
      '        return " ".join(c["text"] for c in resp.json()["content"])',
      '',
      ...methodDefs,
    ].join('\n');
  }

  private generateGoClient(tools: ToolSchema[], version: string): string {
    const methodDefs = tools.map((tool) => {
      const methodName = toPascalCase(tool.name);
      const requestType = `${methodName}Request`;
      const responseType = `${methodName}Response`;
      return [
        `// ${tool.description}`,
        `func (c *IrisClient) ${methodName}(ctx context.Context, input ${requestType}) (*${responseType}, error) {`,
        `\treturn callTool[${requestType}, ${responseType}](ctx, c, "${tool.name}", input)`,
        '}',
      ].join('\n');
    });

    return [
      `// Iris MCP Client SDK — Go v${version}`,
      `// Auto-generated — do not edit manually`,
      '',
      'package iris',
      '',
      'import (',
      '\t"bytes"',
      '\t"context"',
      '\t"encoding/json"',
      '\t"fmt"',
      '\t"net/http"',
      ')',
      '',
      `const SDKVersion = "${version}"`,
      '',
      'type IrisClient struct {',
      '\tAPIKey  string',
      '\tBaseURL string',
      '\tclient  *http.Client',
      '}',
      '',
      'func NewIrisClient(apiKey string) *IrisClient {',
      `\treturn &IrisClient{APIKey: apiKey, BaseURL: "https://mcp.iris.example.com", client: &http.Client{}}`,
      '}',
      '',
      'func callTool[I any, O any](ctx context.Context, c *IrisClient, toolName string, input I) (*O, error) {',
      '\tbody, err := json.Marshal(input)',
      '\tif err != nil { return nil, fmt.Errorf("iris: marshal error: %w", err) }',
      '\treq, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+"/mcp/tools/"+toolName, bytes.NewReader(body))',
      '\tif err != nil { return nil, err }',
      '\treq.Header.Set("Authorization", "Bearer "+c.APIKey)',
      '\treq.Header.Set("Content-Type", "application/json")',
      '\tresp, err := c.client.Do(req)',
      '\tif err != nil { return nil, err }',
      '\tdefer resp.Body.Close()',
      '\tvar out O',
      '\tif err := json.NewDecoder(resp.Body).Decode(&out); err != nil { return nil, err }',
      '\treturn &out, nil',
      '}',
      '',
      ...methodDefs,
    ].join('\n');
  }
}

// ─── Utility functions ────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
  return s.replace(/[-_\s]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (c) => c.toUpperCase());
}

function toCamelCase(s: string): string {
  const pascal = toPascalCase(s);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toSnakeCase(s: string): string {
  return s.replace(/-/g, '_').toLowerCase();
}

type Param = { name: string; zodType: string; required: boolean };

function buildTypeScriptProps(schema: Record<string, unknown>): Param[] {
  const properties = (schema['properties'] as Record<string, Record<string, unknown>>) ?? {};
  const required = (schema['required'] as string[]) ?? [];

  return Object.entries(properties).map(([name, def]) => {
    const type = String(def['type'] ?? 'string');
    const isRequired = required.includes(name);
    const zodType = jsonTypeToZod(type, isRequired);
    return { name, zodType, required: isRequired };
  });
}

function jsonTypeToZod(type: string, required: boolean): string {
  const base = type === 'integer' ? 'z.number().int()'
    : type === 'number' ? 'z.number()'
    : type === 'boolean' ? 'z.boolean()'
    : type === 'array' ? 'z.array(z.unknown())'
    : 'z.string()';
  return required ? base : `${base}.optional()`;
}

function toPythonType(zodType: string): string {
  if (zodType.includes('int')) return 'int';
  if (zodType.includes('number')) return 'float';
  if (zodType.includes('boolean')) return 'bool';
  if (zodType.includes('array')) return 'list';
  return 'str';
}

function toGoType(zodType: string): string {
  if (zodType.includes('int')) return 'int64';
  if (zodType.includes('number')) return 'float64';
  if (zodType.includes('boolean')) return 'bool';
  if (zodType.includes('array')) return '[]interface{}';
  return 'string';
}

function extractParams(schema: Record<string, unknown>): Array<{ name: string; type: string }> {
  const props = buildTypeScriptProps(schema);
  return props.map((p) => ({ name: p.name, type: toPythonType(p.zodType) }));
}

function generateExample(tool: ToolSchema): string {
  const methodName = toCamelCase(tool.name);
  const params = extractParams(tool.inputSchema);
  const exampleInput = params
    .slice(0, 3)
    .map((p) => `${p.name}: ${p.type === 'int' || p.type === 'float' ? '10' : p.type === 'bool' ? 'true' : '"example"'}`)
    .join(', ');
  return `const result = await client.${methodName}({ ${exampleInput} });`;
}
