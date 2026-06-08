import { describe, it, expect, vi } from 'vitest';
import {
  areSemanticAliases,
  detectTransformationType,
  computeMappingConfidence,
  suggestEntityMapping,
  validateMappingLogic,
  generateMappingCode,
  learnFieldMappings,
  getLearnedMappings,
} from '../smart-field-mapper';
import type { SourceField } from '../smart-field-mapper';

type Sql = Parameters<typeof learnFieldMappings>[0];

describe('areSemanticAliases', () => {
  it('returns true for identical names', () => {
    expect(areSemanticAliases('email', 'email')).toBe(true);
  });

  it('returns true for known aliases (email_address ↔ email)', () => {
    expect(areSemanticAliases('email_address', 'email')).toBe(true);
  });

  it('returns true for company aliases', () => {
    expect(areSemanticAliases('account_name', 'company')).toBe(true);
  });

  it('returns false for unrelated fields', () => {
    expect(areSemanticAliases('revenue', 'label')).toBe(false);
  });

  it('is case and delimiter insensitive', () => {
    expect(areSemanticAliases('FULL_NAME', 'label')).toBe(true);
  });
});

describe('detectTransformationType', () => {
  it('detects direct mapping for same types', () => {
    const { transformationType } = detectTransformationType('name', 'label', 'string', 'string');
    expect(transformationType).toBe('direct');
  });

  it('detects compute for string→date', () => {
    const { transformationType, transformationLogic } = detectTransformationType('created_at', 'createdAt', 'string', 'date');
    expect(transformationType).toBe('compute');
    expect(transformationLogic).toContain('new Date');
  });

  it('detects compute for string→number (parseFloat)', () => {
    const { transformationType, transformationLogic } = detectTransformationType('amount_str', 'amount', 'string', 'number');
    expect(transformationType).toBe('compute');
    expect(transformationLogic).toContain('parseFloat');
  });

  it('detects lookup for _id suffix fields', () => {
    const { transformationType } = detectTransformationType('owner_id', 'owner', 'string', 'string');
    expect(transformationType).toBe('lookup');
  });

  it('detects compute for string→array (CSV)', () => {
    const { transformationLogic } = detectTransformationType('tags', 'tags', 'string', 'array');
    expect(transformationLogic).toContain('split');
  });
});

describe('computeMappingConfidence', () => {
  it('returns high confidence for exact name + type match', () => {
    const score = computeMappingConfidence('label', 'label', 'string', 'string');
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns moderate confidence for alias match', () => {
    const score = computeMappingConfidence('email_address', 'email', 'string', 'string');
    expect(score).toBeGreaterThan(0.4);
  });

  it('returns lower confidence for unrelated fields', () => {
    const score = computeMappingConfidence('xyz_field', 'label', 'string', 'string');
    expect(score).toBeLessThan(0.5);
  });

  it('boosts score with learned count', () => {
    const base = computeMappingConfidence('email', 'email', 'string', 'string', 0);
    const learned = computeMappingConfidence('email', 'email', 'string', 'string', 5);
    expect(learned).toBeGreaterThan(base);
  });

  it('clamps score to 1.0', () => {
    const score = computeMappingConfidence('label', 'label', 'string', 'string', 100);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('suggestEntityMapping', () => {
  const contactFields: SourceField[] = [
    { name: 'full_name', type: 'string' },
    { name: 'email_address', type: 'string' },
    { name: 'company_name', type: 'string' },
    { name: 'deal_stage', type: 'string' },
  ];

  it('suggests mappings for contact entity type', () => {
    const suggestions = suggestEntityMapping(contactFields, 'contact');
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('maps full_name to label', () => {
    const suggestions = suggestEntityMapping(contactFields, 'contact');
    const labelSuggestion = suggestions.find(s => s.targetAttribute === 'label');
    expect(labelSuggestion).toBeDefined();
    expect(labelSuggestion!.sourceField).toBe('full_name');
  });

  it('maps email_address to email', () => {
    const suggestions = suggestEntityMapping(contactFields, 'contact');
    const emailSuggestion = suggestions.find(s => s.targetAttribute === 'email');
    expect(emailSuggestion).toBeDefined();
    expect(emailSuggestion!.sourceField).toBe('email_address');
  });

  it('returns empty for unknown entity type', () => {
    const suggestions = suggestEntityMapping(contactFields, 'unknown-entity');
    expect(suggestions).toHaveLength(0);
  });

  it('boosts confidence with learned mappings', () => {
    const learned = [{ sourceConnectorId: 'sf', sourceFieldName: 'full_name', targetFieldName: 'label', targetEntityType: 'contact', mappingCount: 3, userConfirmedCount: 3, confidenceScore: 0.9 }];
    const base = suggestEntityMapping(contactFields, 'contact', []);
    const boosted = suggestEntityMapping(contactFields, 'contact', learned);
    const baseLabel = base.find(s => s.targetAttribute === 'label')!;
    const boostedLabel = boosted.find(s => s.targetAttribute === 'label')!;
    expect(boostedLabel.confidenceScore).toBeGreaterThanOrEqual(baseLabel.confidenceScore);
  });
});

describe('validateMappingLogic', () => {
  it('returns valid: true for clean mapping', () => {
    const suggestion = { sourceField: 'label', targetAttribute: 'label', targetEntityType: 'contact', confidenceScore: 0.8, transformationType: 'direct' as const, transformationLogic: '', reasoning: '' };
    const result = validateMappingLogic(suggestion, [suggestion]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('warns about many-to-one conflicts', () => {
    const s1 = { sourceField: 'name', targetAttribute: 'label', targetEntityType: 'contact', confidenceScore: 0.8, transformationType: 'direct' as const, transformationLogic: '', reasoning: '' };
    const s2 = { sourceField: 'full_name', targetAttribute: 'label', targetEntityType: 'contact', confidenceScore: 0.7, transformationType: 'direct' as const, transformationLogic: '', reasoning: '' };
    const result = validateMappingLogic(s1, [s1, s2]);
    expect(result.warnings.some(w => w.includes('multiple')|| w.includes('Multiple'))).toBe(true);
  });

  it('warns about lookup transformations', () => {
    const s = { sourceField: 'owner_id', targetAttribute: 'owner', targetEntityType: 'contact', confidenceScore: 0.7, transformationType: 'lookup' as const, transformationLogic: '', reasoning: '' };
    const result = validateMappingLogic(s, [s]);
    expect(result.warnings.some(w => w.includes('Lookup') || w.includes('lookup'))).toBe(true);
  });

  it('warns about low-confidence mappings', () => {
    const s = { sourceField: 'xyz', targetAttribute: 'label', targetEntityType: 'contact', confidenceScore: 0.2, transformationType: 'direct' as const, transformationLogic: '', reasoning: '' };
    const result = validateMappingLogic(s, [s]);
    expect(result.warnings.some(w => w.includes('confidence') || w.includes('Low'))).toBe(true);
  });
});

describe('generateMappingCode', () => {
  it('generates a valid TypeScript function', () => {
    const suggestion = {
      sourceField: 'full_name',
      targetAttribute: 'label',
      targetEntityType: 'contact',
      confidenceScore: 0.85,
      transformationType: 'direct' as const,
      transformationLogic: 'entity.label = source.full_name',
      reasoning: 'Alias match',
    };
    const gen = generateMappingCode(suggestion);
    expect(gen.code).toContain('function');
    expect(gen.code).toContain('source');
    expect(gen.functionName).toContain('Label');
  });

  it('includes confidence in code comment', () => {
    const suggestion = {
      sourceField: 'email_address',
      targetAttribute: 'email',
      targetEntityType: 'contact',
      confidenceScore: 0.9,
      transformationType: 'direct' as const,
      transformationLogic: 'entity.email = source.email_address',
      reasoning: 'Alias match',
    };
    const gen = generateMappingCode(suggestion);
    expect(gen.code).toContain('90%');
  });
});

describe('learnFieldMappings', () => {
  it('upserts confirmed mappings and returns Ok', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const result = await learnFieldMappings(sql as unknown as Sql, 'hubspot', [
      { sourceField: 'full_name', targetField: 'label', entityType: 'contact' },
      { sourceField: 'email_address', targetField: 'email', entityType: 'contact' },
    ]);
    expect(result.isOk()).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await learnFieldMappings(sql as unknown as Sql, 'hubspot', [
      { sourceField: 'x', targetField: 'y', entityType: 'contact' },
    ]);
    expect(result.isErr()).toBe(true);
  });
});

describe('getLearnedMappings', () => {
  it('returns mapped records from DB', async () => {
    const sql = vi.fn().mockResolvedValue([
      { source_connector_id: 'hubspot', source_field_name: 'full_name', target_field_name: 'label', target_entity_type: 'contact', mapping_count: 5, user_confirmed_count: 5, confidence_score: '0.95' },
    ]);
    const result = await getLearnedMappings(sql as unknown as Sql, 'hubspot');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0]!.confidenceScore).toBeCloseTo(0.95);
    }
  });

  it('returns Err when DB throws', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error'));
    const result = await getLearnedMappings(sql as unknown as Sql, 'hubspot');
    expect(result.isErr()).toBe(true);
  });
});
