'use client';

import { useState } from 'react';
import { EnrichmentSourcesManager } from '../../../components/enrichment-sources-manager.js';

const BUILT_IN_SOURCES = [
  {
    id: 'company-enricher',
    name: 'Company Enricher',
    provider: 'Clearbit',
    description: 'Augments company entities with firmographics: industry, employee count, location, and domain metadata.',
    entityTypes: ['company', 'account'],
    apiKeyField: 'Clearbit API Key',
    docsUrl: 'https://clearbit.com/docs#enrichment-api',
  },
  {
    id: 'person-enricher',
    name: 'Person Enricher',
    provider: 'Clearbit',
    description: 'Enriches person/contact entities with professional profile data derived from their email address.',
    entityTypes: ['contact', 'person', 'lead'],
    apiKeyField: 'Clearbit API Key',
    docsUrl: 'https://clearbit.com/docs#person-api',
  },
  {
    id: 'sentiment-enricher',
    name: 'Sentiment Enricher',
    provider: 'NewsAPI',
    description: 'Fetches recent news mentions and derives a sentiment signal (positive / neutral / negative) for entities.',
    entityTypes: ['company', 'account', 'contact'],
    apiKeyField: 'NewsAPI Key',
    docsUrl: 'https://newsapi.org/docs',
  },
] as const;

type Source = (typeof BUILT_IN_SOURCES)[number];

export default function EnrichmentSetupPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function configure(source: Source) {
    if (!workspaceId.trim()) {
      setMsg({ type: 'err', text: 'Workspace ID is required.' });
      return;
    }
    if (!apiKey.trim()) {
      setMsg({ type: 'err', text: 'API key is required.' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/enrichments/configure/${source.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ name: source.name, apiKey, enabled: true }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        setMsg({ type: 'err', text: body.error?.message ?? 'Configuration failed.' });
      } else {
        setMsg({ type: 'ok', text: `${source.name} configured successfully.` });
        setSelectedSource(null);
        setApiKey('');
      }
    } catch {
      setMsg({ type: 'err', text: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Entity Enrichment Setup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect external data providers to automatically enrich your indexed entities with
          firmographic, professional, and sentiment data.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Workspace ID</label>
        <input
          type="text"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="your-workspace-uuid"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {msg && (
        <div
          className={`rounded-md p-3 text-sm ${
            msg.type === 'ok'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Available Enrichment Sources</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BUILT_IN_SOURCES.map((source) => (
            <button
              key={source.id}
              onClick={() => {
                setSelectedSource((prev) => (prev?.id === source.id ? null : source));
                setApiKey('');
                setMsg(null);
              }}
              className={`text-left border rounded-lg p-4 transition-all ${
                selectedSource?.id === source.id
                  ? 'border-indigo-500 ring-2 ring-indigo-200 bg-indigo-50'
                  : 'border-gray-200 hover:border-indigo-300 bg-white'
              }`}
            >
              <div className="font-medium text-gray-900">{source.name}</div>
              <div className="text-xs text-indigo-600 mt-0.5">via {source.provider}</div>
              <p className="text-xs text-gray-500 mt-2 line-clamp-3">{source.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {source.entityTypes.map((t) => (
                  <span key={t} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                    {t}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedSource && (
        <div className="border border-indigo-200 rounded-lg p-5 bg-indigo-50 space-y-4">
          <h3 className="font-semibold text-gray-900">Configure {selectedSource.name}</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {selectedSource.apiKeyField}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key…"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
            />
            <a
              href={selectedSource.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-600 hover:underline mt-1 inline-block"
            >
              Get an API key →
            </a>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void configure(selectedSource)}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save & Enable'}
            </button>
            <button
              onClick={() => { setSelectedSource(null); setApiKey(''); setMsg(null); }}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {workspaceId && (
        <div className="border-t pt-8">
          <EnrichmentSourcesManager workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
