import { describe, it, expect } from 'vitest';
import {
  WIZARD_STEPS,
  stepIndex,
  nextStep,
  prevStep,
  requiresOAuth,
  buildOAuthUrl,
  buildSchemaFields,
  INITIAL_WIZARD_STATE,
} from '@/lib/setup-wizard';
import type { ConnectorManifest } from '@/lib/api';

const baseManifest: ConnectorManifest = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'CRM connector',
  icon: 'hubspot.svg',
  entityTypes: ['contact', 'company'],
};

const oauthManifest = { ...baseManifest, auth: { type: 'oauth2' } } as ConnectorManifest & {
  auth: { type: string };
};

const apikeyManifest = { ...baseManifest, auth: { type: 'apikey' } } as ConnectorManifest & {
  auth: { type: string };
};

describe('stepIndex', () => {
  it('returns 0 for the first step', () => {
    expect(stepIndex('select')).toBe(0);
  });

  it('returns the correct index for each step', () => {
    WIZARD_STEPS.forEach((step, i) => {
      expect(stepIndex(step)).toBe(i);
    });
  });
});

describe('nextStep', () => {
  it('returns the next step from select', () => {
    expect(nextStep('select')).toBe('auth');
  });

  it('returns null from the last step', () => {
    expect(nextStep('review')).toBeNull();
  });

  it('progresses through all steps in order', () => {
    const order: string[] = [];
    let step: ReturnType<typeof nextStep> = 'select';
    while (step !== null) {
      order.push(step);
      step = nextStep(step);
    }
    expect(order).toEqual(WIZARD_STEPS);
  });
});

describe('prevStep', () => {
  it('returns null from the first step', () => {
    expect(prevStep('select')).toBeNull();
  });

  it('returns the previous step from auth', () => {
    expect(prevStep('auth')).toBe('select');
  });

  it('returns the previous step from review', () => {
    expect(prevStep('review')).toBe('mapping');
  });
});

describe('requiresOAuth', () => {
  it('returns true for oauth2 connectors', () => {
    expect(requiresOAuth(oauthManifest)).toBe(true);
  });

  it('returns false for api-key connectors', () => {
    expect(requiresOAuth(apikeyManifest)).toBe(false);
  });

  it('returns false when auth type is absent', () => {
    expect(requiresOAuth(baseManifest)).toBe(false);
  });
});

describe('buildOAuthUrl', () => {
  it('constructs the correct OAuth start URL', () => {
    const url = buildOAuthUrl('hubspot', 'http://localhost:3001/api/v1');
    expect(url).toBe('http://localhost:3001/api/v1/connectors/types/hubspot/oauth/start');
  });
});

describe('buildSchemaFields', () => {
  it('maps schema response to SchemaField array with included=true', () => {
    const fields = buildSchemaFields([
      { name: 'id', type: 'text', nullable: false },
      { name: 'email', type: 'text' },
    ]);

    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ name: 'id', type: 'text', nullable: false, included: true });
    expect(fields[1]).toMatchObject({ name: 'email', type: 'text', nullable: true, included: true });
  });

  it('returns empty array for empty input', () => {
    expect(buildSchemaFields([])).toEqual([]);
  });
});

describe('INITIAL_WIZARD_STATE', () => {
  it('starts at the select step', () => {
    expect(INITIAL_WIZARD_STATE.currentStep).toBe('select');
  });

  it('has no connector selected initially', () => {
    expect(INITIAL_WIZARD_STATE.selectedConnectorId).toBeNull();
  });
});
