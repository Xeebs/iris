import type { ConnectorManifest } from './api.js';

export type WizardStep = 'select' | 'auth' | 'schema' | 'mapping' | 'review';

export const WIZARD_STEPS: WizardStep[] = ['select', 'auth', 'schema', 'mapping', 'review'];

export const STEP_LABELS: Record<WizardStep, string> = {
  select: 'Select Connector',
  auth: 'Authentication',
  schema: 'Schema Discovery',
  mapping: 'Field Mapping',
  review: 'Review & Connect',
};

export type WizardState = {
  currentStep: WizardStep;
  selectedConnectorId: string | null;
  authData: Record<string, string>;
  schemaFields: SchemaField[];
  instanceId: string | null;
};

export type SchemaField = {
  name: string;
  type: string;
  nullable: boolean;
  included: boolean;
};

export const INITIAL_WIZARD_STATE: WizardState = {
  currentStep: 'select',
  selectedConnectorId: null,
  authData: {},
  schemaFields: [],
  instanceId: null,
};

/**
 * @param step - Current wizard step
 * @returns Index (0-based) of the step in the ordered list
 */
export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

/**
 * @param step - Current step
 * @returns Next step, or null if already on the last step
 */
export function nextStep(step: WizardStep): WizardStep | null {
  const idx = stepIndex(step);
  return idx < WIZARD_STEPS.length - 1 ? (WIZARD_STEPS[idx + 1] ?? null) : null;
}

/**
 * @param step - Current step
 * @returns Previous step, or null if already on the first step
 */
export function prevStep(step: WizardStep): WizardStep | null {
  const idx = stepIndex(step);
  return idx > 0 ? (WIZARD_STEPS[idx - 1] ?? null) : null;
}

/**
 * Whether the connector requires OAuth or an API key.
 *
 * @param manifest - Connector manifest from the API
 */
export function requiresOAuth(manifest: ConnectorManifest): boolean {
  const auth = (manifest as ConnectorManifest & { auth?: { type?: string } }).auth;
  return auth?.type === 'oauth2';
}

/**
 * Build the OAuth redirect URL for a connector.
 *
 * @param connectorId - Connector ID to initiate OAuth for
 * @param apiBase - API base URL
 */
export function buildOAuthUrl(connectorId: string, apiBase: string): string {
  return `${apiBase}/connectors/types/${connectorId}/oauth/start`;
}

/**
 * Map raw schema response to display-friendly field list with all included by default.
 *
 * @param schemaResponse - Raw fields from connector.getSchema()
 */
export function buildSchemaFields(
  schemaResponse: Array<{ name: string; type: string; nullable?: boolean }>,
): SchemaField[] {
  return schemaResponse.map((f) => ({
    name: f.name,
    type: f.type,
    nullable: f.nullable ?? true,
    included: true,
  }));
}
