'use client';

import { useState } from 'react';

type TransformationType = 'direct' | 'aggregate' | 'compute' | 'lookup';

type MappingSuggestion = {
  sourceField: string;
  targetAttribute: string;
  targetEntityType: string;
  confidenceScore: number;
  transformationType: TransformationType;
  transformationLogic: string;
  reasoning: string;
  validation: { valid: boolean; warnings: string[]; errors: string[] };
  generatedCode: { functionName: string; code: string };
};

type FieldMappingAssistantProps = {
  workspaceId: string;
  connectorId: string;
};

const TRANSFORM_COLORS: Record<TransformationType, string> = {
  direct: 'bg-green-100 text-green-700',
  compute: 'bg-blue-100 text-blue-700',
  lookup: 'bg-yellow-100 text-yellow-700',
  aggregate: 'bg-purple-100 text-purple-700',
};

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'bg-green-400' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500">{pct}%</span>
    </div>
  );
}

export function FieldMappingAssistant({ workspaceId, connectorId }: FieldMappingAssistantProps) {
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('contact');
  const [fieldsInput, setFieldsInput] = useState('');
  const [showCode, setShowCode] = useState<string | null>(null);

  function parseFields(input: string) {
    return input.split('\n').map(line => {
      const [name, type = 'string'] = line.trim().split(':');
      return { name: name?.trim() ?? '', type: type.trim() as 'string' };
    }).filter(f => f.name.length > 0);
  }

  async function fetchSuggestions() {
    const fields = parseFields(fieldsInput);
    if (fields.length === 0) { setError('Enter at least one field name'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/connectors/${connectorId}/suggest-mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ sourceFields: fields, targetEntityType: entityType }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: MappingSuggestion[] };
      setSuggestions(body.data ?? []);
      setConfirmed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get suggestions');
    } finally {
      setLoading(false);
    }
  }

  async function confirmMappings() {
    const toConfirm = suggestions.filter(s => confirmed.has(s.sourceField));
    if (toConfirm.length === 0) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/v1/connectors/${connectorId}/mapping-suggestions/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          mappings: toConfirm.map(s => ({ sourceField: s.sourceField, targetField: s.targetAttribute, entityType: s.targetEntityType })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuggestions(prev => prev.filter(s => !confirmed.has(s.sourceField)));
      setConfirmed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to confirm mappings');
    } finally {
      setConfirming(false);
    }
  }

  function toggleConfirm(sourceField: string) {
    setConfirmed(prev => {
      const next = new Set(prev);
      if (next.has(sourceField)) next.delete(sourceField);
      else next.add(sourceField);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Field Mapping Assistant</h2>
        <p className="text-xs text-gray-500 mt-0.5">AI-suggested schema field mappings for {connectorId}</p>
      </div>

      {/* Input */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Source fields (one per line, name:type)</label>
          <textarea
            value={fieldsInput}
            onChange={e => setFieldsInput(e.target.value)}
            rows={5}
            placeholder={'full_name:string\nemail_address:string\ncompany_name:string\ncreated_at:string\namount_str:string'}
            className="w-full text-xs font-mono px-2 py-1.5 rounded-md border border-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Target entity type</label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-300 focus:outline-none"
            >
              {['contact', 'deal', 'company', 'activity', 'task'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button
            onClick={fetchSuggestions}
            disabled={loading}
            className="mt-auto px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Suggest Mappings'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{suggestions.length} suggestions — select to confirm</span>
            <button
              onClick={confirmMappings}
              disabled={confirmed.size === 0 || confirming}
              className="text-xs px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {confirming ? 'Saving…' : `Confirm ${confirmed.size} selected`}
            </button>
          </div>

          <ul className="space-y-1.5">
            {suggestions.map(s => (
              <li
                key={s.sourceField}
                className={`rounded-lg border px-4 py-3 cursor-pointer transition-colors ${confirmed.has(s.sourceField) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                onClick={() => toggleConfirm(s.sourceField)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span className="font-mono text-gray-800">{s.sourceField}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-mono text-indigo-700">{s.targetAttribute}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TRANSFORM_COLORS[s.transformationType]}`}>
                        {s.transformationType}
                      </span>
                    </div>
                    <ConfidenceBar score={s.confidenceScore} />
                    {s.validation.warnings.length > 0 && (
                      <div className="text-xs text-yellow-600">⚠ {s.validation.warnings[0]}</div>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setShowCode(showCode === s.sourceField ? null : s.sourceField); }}
                      className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded border border-gray-200 hover:border-gray-300"
                    >
                      {showCode === s.sourceField ? 'hide' : 'code'}
                    </button>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${confirmed.has(s.sourceField) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'}`}>
                      {confirmed.has(s.sourceField) && <span className="text-white text-xs">✓</span>}
                    </div>
                  </div>
                </div>
                {showCode === s.sourceField && (
                  <pre className="mt-2 p-2 bg-gray-900 text-green-400 text-xs rounded-md font-mono overflow-x-auto" onClick={e => e.stopPropagation()}>
                    {s.generatedCode.code}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
