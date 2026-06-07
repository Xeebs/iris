import { NlpConfigWizard } from '@/components/nlp-config-wizard';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';
const API_BASE_URL = process.env['IRIS_API_URL'] ?? 'http://localhost:3001';

/**
 * Natural language workspace configuration setup page.
 * Allows business users to describe business rules in plain English.
 */
export default function NlpSetupPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Natural Language Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          Describe your business rules in plain English — Iris will interpret and apply them automatically.
        </p>
      </div>

      <NlpConfigWizard
        workspaceId={WORKSPACE_ID}
        apiBaseUrl={API_BASE_URL}
        openAiKey={process.env['OPENAI_API_KEY'] ?? ''}
      />

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="font-medium">What can you configure?</p>
        <ul className="mt-2 space-y-1 list-disc pl-4 text-xs">
          <li>Fiscal calendar rules (fiscal year start, quarter definitions)</li>
          <li>Metric definitions (ARR, MRR, churn formulas)</li>
          <li>Date interpretation rules (quarter naming, period boundaries)</li>
          <li>Custom business terminology</li>
        </ul>
        <p className="mt-3 text-xs text-gray-400">
          All configurations require approval before being applied to your workspace.
          Low-confidence interpretations are flagged for manual review.
        </p>
      </div>
    </div>
  );
}
