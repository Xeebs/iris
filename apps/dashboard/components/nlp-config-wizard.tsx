'use client';

import { useState } from 'react';

interface ParsedResult {
  configType: string;
  summary: string;
  confidence: number;
  parsedJson: Record<string, unknown>;
}

interface NlpConfigWizardProps {
  workspaceId: string;
  apiBaseUrl: string;
  openAiKey: string;
  onSaved?: (configId: string) => void;
}

const EXAMPLE_PROMPTS = [
  'Our fiscal year starts in April',
  'ARR is Monthly Recurring Revenue multiplied by 12',
  'Q1 runs from February to April',
  'Customer churn rate is measured over 90 days',
];

const CONFIDENCE_BADGE = (confidence: number) => {
  if (confidence >= 0.85) return 'bg-green-100 text-green-700';
  if (confidence >= 0.6) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
};

/**
 * Multi-step wizard for natural language workspace configuration.
 * Step 1: Enter plain English business rule
 * Step 2: Review parsed interpretation
 * Step 3: Approve or edit before saving
 *
 * @param workspaceId - Current workspace
 * @param apiBaseUrl  - Base URL for the Iris REST API
 * @param openAiKey   - API key passed to the parse endpoint (never stored in the browser)
 * @param onSaved     - Called with config ID after successful save
 */
export function NlpConfigWizard({ workspaceId, apiBaseUrl, openAiKey, onSaved }: NlpConfigWizardProps): React.JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [inputText, setInputText] = useState('');
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/workspace/config-from-language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, text: inputText, openAiKey, save: false }),
      });
      const body = await res.json() as { data?: { parsed: ParsedResult }; error?: { message: string } };
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? 'Parsing failed');
        return;
      }
      setParsed(body.data.parsed);
      setStep(2);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!parsed) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/v1/workspace/config-from-language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, text: inputText, openAiKey, save: true }),
      });
      const body = await res.json() as { data?: { record: { id: string } }; error?: { message: string } };
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? 'Save failed');
        return;
      }
      setConfigId(body.data.record.id);
      setStep(3);
      onSaved?.(body.data.record.id);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep(1);
    setInputText('');
    setParsed(null);
    setConfigId(null);
    setError(null);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Step indicators */}
      <div className="flex border-b border-gray-200 px-5 py-3">
        {([1, 2, 3] as const).map(s => (
          <div key={s} className="flex items-center">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              step === s ? 'bg-indigo-600 text-white' : step > s ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'
            }`}>{s}</span>
            {s < 3 && <div className="mx-2 h-px w-8 bg-gray-200" />}
          </div>
        ))}
        <span className="ml-4 text-sm text-gray-500">
          {step === 1 ? 'Describe your business rule' : step === 2 ? 'Review interpretation' : 'Saved!'}
        </span>
      </div>

      <div className="px-5 py-4">
        {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}

        {/* Step 1: Input */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="nl-input" className="block text-sm font-medium text-gray-700">
                Business rule or definition
              </label>
              <textarea
                id="nl-input"
                rows={4}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="e.g. Our fiscal year starts in February"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Examples:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map(p => (
                  <button key={p} onClick={() => setInputText(p)} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-700">
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleParse}
              disabled={!inputText.trim() || loading}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Parsing…' : 'Parse →'}
            </button>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && parsed && (
          <div className="space-y-4">
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Original input:</p>
              <p className="mt-0.5 text-sm italic text-gray-700">"{inputText}"</p>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">Interpretation:</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{parsed.summary}</p>
                </div>
                <span className={`ml-3 rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_BADGE(parsed.confidence)}`}>
                  {Math.round(parsed.confidence * 100)}% confident
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Type: <span className="font-mono">{parsed.configType}</span>
              </p>
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-gray-100 p-2 text-xs">
                {JSON.stringify(parsed.parsedJson, null, 2)}
              </pre>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Approve & Save'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className="space-y-3 text-center">
            <div className="text-2xl">✓</div>
            <p className="text-sm font-medium text-gray-900">Configuration saved!</p>
            <p className="text-xs text-gray-500">ID: <span className="font-mono">{configId}</span></p>
            <button onClick={reset} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Add another
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
