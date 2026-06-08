import { describe, it, expect } from 'vitest';
import { parseConfigIntent, generateConfigDiff } from '../nlp-config-engine.js';

describe('parseConfigIntent — temporal', () => {
  it('parses fiscal year starting in February', () => {
    const result = parseConfigIntent('Our fiscal year starts in February');
    expect(result.isOk()).toBe(true);
    const intent = result._unsafeUnwrap();
    expect(intent.category).toBe('temporal');
    const payload = intent.payload as { fiscalYearStartMonth: number };
    expect(payload.fiscalYearStartMonth).toBe(2);
  });

  it('parses fiscal year with abbreviated month', () => {
    const result = parseConfigIntent('Fiscal year starts in Apr');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { fiscalYearStartMonth: number };
    expect(payload.fiscalYearStartMonth).toBe(4);
  });

  it('parses fiscal year with numeric month', () => {
    const result = parseConfigIntent('Fiscal year starts in 7');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { fiscalYearStartMonth: number };
    expect(payload.fiscalYearStartMonth).toBe(7);
  });

  it('parses timezone', () => {
    const result = parseConfigIntent('Timezone is America/New_York');
    expect(result.isOk()).toBe(true);
    const intent = result._unsafeUnwrap();
    expect(intent.category).toBe('temporal');
    const payload = intent.payload as { timezone: string };
    expect(payload.timezone).toBe('America/New_York');
  });

  it('returns error for invalid month name', () => {
    const result = parseConfigIntent('Fiscal year starts in Octember');
    expect(result.isErr()).toBe(true);
  });
});

describe('parseConfigIntent — retention', () => {
  it('parses archive older than 6 months', () => {
    const result = parseConfigIntent('Archive data older than 6 months');
    expect(result.isOk()).toBe(true);
    const intent = result._unsafeUnwrap();
    expect(intent.category).toBe('retention');
    const payload = intent.payload as { archiveAfterDays: number };
    expect(payload.archiveAfterDays).toBe(180);
  });

  it('parses delete older than 1 year', () => {
    const result = parseConfigIntent('Delete records older than 1 year');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { deleteAfterDays: number };
    expect(payload.deleteAfterDays).toBe(365);
  });

  it('parses archive with entity type', () => {
    const result = parseConfigIntent('Archive contacts older than 90 days');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { archiveAfterDays: number; entityType?: string };
    expect(payload.archiveAfterDays).toBe(90);
    expect(payload.entityType).toBe('contacts');
  });

  it('parses archive older than 2 weeks', () => {
    const result = parseConfigIntent('Archive data older than 2 weeks');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { archiveAfterDays: number };
    expect(payload.archiveAfterDays).toBe(14);
  });
});

describe('parseConfigIntent — access_control', () => {
  it('parses hide field from role', () => {
    const result = parseConfigIntent('Hide SSN from finance viewers');
    expect(result.isOk()).toBe(true);
    const intent = result._unsafeUnwrap();
    expect(intent.category).toBe('access_control');
    const payload = intent.payload as { action: string; field: string; scope: string };
    expect(payload.action).toBe('hide');
    expect(payload.field).toBe('SSN');
    expect(payload.scope).toBe('finance viewers');
  });

  it('parses mask field from team', () => {
    const result = parseConfigIntent('Mask email from sales team');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { action: string; field: string };
    expect(payload.action).toBe('mask');
    expect(payload.field).toBe('email');
  });

  it('parses restrict field', () => {
    const result = parseConfigIntent('Restrict salary from managers');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { action: string; field: string };
    expect(payload.action).toBe('restrict');
  });
});

describe('parseConfigIntent — entity_merging', () => {
  it('parses contacts and people are the same', () => {
    const result = parseConfigIntent('Contacts and people are the same');
    expect(result.isOk()).toBe(true);
    const intent = result._unsafeUnwrap();
    expect(intent.category).toBe('entity_merging');
    const payload = intent.payload as { sourceType: string; targetType: string };
    expect(payload.sourceType).toBe('contacts');
    expect(payload.targetType).toBe('people');
  });

  it('parses deals and opportunities are the same', () => {
    const result = parseConfigIntent('Deals and opportunities are the same');
    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap().payload as { sourceType: string; targetType: string };
    expect(payload.sourceType).toBe('deals');
    expect(payload.targetType).toBe('opportunities');
  });
});

describe('parseConfigIntent — unrecognized input', () => {
  it('returns an error for unrecognized input', () => {
    const result = parseConfigIntent('Make everything faster');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Could not parse intent');
  });

  it('returns an error for empty input', () => {
    const result = parseConfigIntent('');
    expect(result.isErr()).toBe(true);
  });
});

describe('generateConfigDiff', () => {
  it('returns explanation for temporal intent', () => {
    const intent = parseConfigIntent('Fiscal year starts in March')._unsafeUnwrap();
    const diff = generateConfigDiff(intent);
    expect(diff.category).toBe('temporal');
    expect(diff.explanation).toContain('temporal');
    expect(diff.after).toHaveProperty('fiscalYearStartMonth', 3);
  });

  it('returns explanation for retention intent', () => {
    const intent = parseConfigIntent('Archive data older than 30 days')._unsafeUnwrap();
    const diff = generateConfigDiff(intent);
    expect(diff.category).toBe('retention');
    expect(diff.explanation).toContain('retention');
  });
});
