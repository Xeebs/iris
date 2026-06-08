import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/smart-field-mapper', () => ({
  suggestEntityMapping: vi.fn((_fields: unknown, _entityType: string) => [
    {
      sourceField: 'full_name',
      targetAttribute: 'label',
      targetEntityType: 'contact',
      confidenceScore: 0.85,
      transformationType: 'direct',
      transformationLogic: 'entity.label = source.full_name',
      reasoning: 'Alias match',
    },
  ]),
  learnFieldMappings: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getLearnedMappings: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: [
      { sourceConnectorId: 'hubspot', sourceFieldName: 'full_name', targetFieldName: 'label', targetEntityType: 'contact', mappingCount: 3, userConfirmedCount: 3, confidenceScore: 0.95 },
    ],
  })),
  validateMappingLogic: vi.fn(() => ({ valid: true, warnings: [], errors: [] })),
  generateMappingCode: vi.fn(() => ({
    functionName: 'mapfull_nameToLabel',
    code: 'function mapfull_nameToLabel(source) { return source.full_name; }',
    inputType: 'Record<string, unknown>',
    outputType: 'unknown',
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/field-mappings';

function buildApp() {
  const app = new Hono();
  app.route('/connectors', routeModule);
  return app;
}

describe('POST /connectors/:connectorId/suggest-mapping', () => {
  it('returns suggestions with validation and generated code', async () => {
    const res = await buildApp().request('/connectors/hubspot/suggest-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceFields: [{ name: 'full_name', type: 'string' }],
        targetEntityType: 'contact',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ sourceField: string; validation: unknown; generatedCode: unknown }>; meta: { count: number } };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.sourceField).toBe('full_name');
    expect(body.data[0]!.validation).toBeDefined();
    expect(body.data[0]!.generatedCode).toBeDefined();
    expect(body.meta.count).toBe(1);
  });

  it('returns 400 for missing sourceFields', async () => {
    const res = await buildApp().request('/connectors/hubspot/suggest-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEntityType: 'contact' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing targetEntityType', async () => {
    const res = await buildApp().request('/connectors/hubspot/suggest-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceFields: [{ name: 'x', type: 'string' }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /connectors/:connectorId/mapping-suggestions', () => {
  it('returns learned mappings with count', async () => {
    const res = await buildApp().request('/connectors/hubspot/mapping-suggestions');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ sourceFieldName: string }>; meta: { count: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.count).toBe(1);
    expect(body.data[0]!.sourceFieldName).toBe('full_name');
  });
});

describe('POST /connectors/:connectorId/mapping-suggestions/confirm', () => {
  it('persists confirmed mappings and returns 201', async () => {
    const res = await buildApp().request('/connectors/hubspot/mapping-suggestions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: [
          { sourceField: 'full_name', targetField: 'label', entityType: 'contact' },
          { sourceField: 'email_address', targetField: 'email', entityType: 'contact' },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { confirmed: number } };
    expect(body.data.confirmed).toBe(2);
  });

  it('returns 400 for empty mappings array', async () => {
    const res = await buildApp().request('/connectors/hubspot/mapping-suggestions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: [] }),
    });
    expect(res.status).toBe(400);
  });
});
