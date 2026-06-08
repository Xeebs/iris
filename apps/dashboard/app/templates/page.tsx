'use client';

import { useState } from 'react';

type TemplateParameter = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string | number | boolean;
  description?: string;
};

type QueryTemplate = {
  id: string;
  name: string;
  query: string;
  parameters: TemplateParameter[];
  description: string;
  tags: string[];
  visibility: 'private' | 'workspace' | 'public';
  usageCount: number;
  createdBy: string;
};

const SAMPLE_TEMPLATES: QueryTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Top Contacts by Stage',
    query: 'SELECT id, name, email FROM contacts WHERE lifecycle_stage = {{stage}} ORDER BY created_at DESC LIMIT {{limit}}',
    parameters: [
      { name: 'stage', type: 'string', required: true, description: 'Lifecycle stage filter' },
      { name: 'limit', type: 'number', required: false, defaultValue: 25 },
    ],
    description: 'Retrieve contacts filtered by lifecycle stage with configurable limit.',
    tags: ['crm', 'contacts'],
    visibility: 'workspace',
    usageCount: 42,
    createdBy: 'admin',
  },
  {
    id: 'tpl-2',
    name: 'Open Deals by Owner',
    query: 'SELECT id, name, amount, stage FROM deals WHERE owner_id = {{ownerId}} AND stage != \'closed\' ORDER BY amount DESC LIMIT 50',
    parameters: [
      { name: 'ownerId', type: 'string', required: true, description: 'Deal owner ID' },
    ],
    description: 'List all open deals assigned to a specific owner.',
    tags: ['crm', 'deals'],
    visibility: 'public',
    usageCount: 18,
    createdBy: 'sales-team',
  },
  {
    id: 'tpl-3',
    name: 'Recent Sync Errors',
    query: 'SELECT connector_id, error_message, occurred_at FROM sync_errors WHERE occurred_at > NOW() - INTERVAL \'{{hours}} hours\' ORDER BY occurred_at DESC LIMIT 100',
    parameters: [
      { name: 'hours', type: 'number', required: false, defaultValue: 24, description: 'Lookback window in hours' },
    ],
    description: 'Retrieve sync errors within the specified lookback window.',
    tags: ['monitoring', 'errors'],
    visibility: 'workspace',
    usageCount: 7,
    createdBy: 'platform',
  },
];

const VISIBILITY_COLORS: Record<string, string> = {
  private: 'bg-gray-700 text-gray-300',
  workspace: 'bg-blue-900 text-blue-300',
  public: 'bg-green-900 text-green-300',
};

export default function TemplatesPage() {
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<QueryTemplate | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [instantiated, setInstantiated] = useState<string | null>(null);

  const allTags = [...new Set(SAMPLE_TEMPLATES.flatMap((t) => t.tags))].sort();

  const filtered = SAMPLE_TEMPLATES.filter((t) => {
    const matchesSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !selectedTag || t.tags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  function handleInstantiate() {
    if (!selectedTemplate) return;
    let q = selectedTemplate.query;
    for (const p of selectedTemplate.parameters) {
      const val = paramValues[p.name] ?? String(p.defaultValue ?? '');
      q = q.replace(new RegExp(`\\{\\{${p.name}\\}\\}`, 'g'), val);
    }
    setInstantiated(q);
  }

  function handleSelectTemplate(t: QueryTemplate) {
    setSelectedTemplate(t);
    setParamValues({});
    setInstantiated(null);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Query Template Library</h1>
        <p className="text-sm text-gray-400 mt-1">Browse, instantiate, and reuse parameterized query templates across your workspace.</p>
      </header>

      <div className="flex gap-6">
        {/* Left: template list */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-3 py-2 rounded text-xs font-medium border transition-colors ${selectedTag === null ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`px-3 py-2 rounded text-xs font-medium border transition-colors ${selectedTag === tag ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filtered.map((t) => (
              <div
                key={t.id}
                onClick={() => handleSelectTemplate(t)}
                className={`border rounded-lg p-4 cursor-pointer transition-colors ${selectedTemplate?.id === t.id ? 'border-blue-500 bg-gray-800' : 'border-gray-700 bg-gray-900 hover:border-gray-600'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white truncate">{t.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${VISIBILITY_COLORS[t.visibility]}`}>
                        {t.visibility}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{t.description}</p>
                    <div className="flex gap-2 flex-wrap">
                      {t.tags.map((tag) => (
                        <span key={tag} className="text-xs bg-gray-800 text-gray-400 border border-gray-700 rounded px-2 py-0.5">{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-white">{t.usageCount}</div>
                    <div className="text-xs text-gray-500">uses</div>
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">No templates match your search.</div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        {selectedTemplate && (
          <div className="w-96 shrink-0">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 sticky top-6">
              <h2 className="font-semibold text-white mb-1">{selectedTemplate.name}</h2>
              <p className="text-xs text-gray-400 mb-4">{selectedTemplate.description}</p>

              <div className="mb-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Template Query</div>
                <pre className="bg-gray-800 rounded p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">{selectedTemplate.query}</pre>
              </div>

              {selectedTemplate.parameters.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Parameters</div>
                  <div className="space-y-2">
                    {selectedTemplate.parameters.map((p) => (
                      <div key={p.name}>
                        <label className="block text-xs text-gray-300 mb-1">
                          {p.name}
                          {p.required && <span className="text-red-400 ml-1">*</span>}
                          {p.description && <span className="text-gray-500 ml-1">— {p.description}</span>}
                        </label>
                        <input
                          type="text"
                          placeholder={p.defaultValue !== undefined ? String(p.defaultValue) : ''}
                          value={paramValues[p.name] ?? ''}
                          onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleInstantiate}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2 rounded transition-colors"
              >
                Instantiate Query
              </button>

              {instantiated && (
                <div className="mt-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Instantiated Query</div>
                  <pre className="bg-gray-800 border border-green-800 rounded p-3 text-xs text-green-300 overflow-x-auto whitespace-pre-wrap">{instantiated}</pre>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between text-xs text-gray-500">
                <span>By {selectedTemplate.createdBy}</span>
                <span>{selectedTemplate.usageCount} uses</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
