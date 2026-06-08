'use client';

import { useState, useEffect, useCallback } from 'react';

type MaskStrategy = 'redact' | 'hash' | 'tokenize' | 'keep_last_4' | 'none';
type Tab = 'strategies' | 'audit' | 'bulk';

type FieldRule = {
  connectorId: string;
  fieldName: string;
  strategy: MaskStrategy;
  updatedAt: string;
};

type AuditEvent = {
  id: string;
  actorId: string;
  actorType: string;
  fieldName: string;
  connectorId: string;
  accessType: string;
  masked: boolean;
  strategy: MaskStrategy;
  accessedAt: string;
};

const STRATEGY_LABELS: Record<MaskStrategy, string> = {
  redact: 'Redact',
  hash: 'Hash (SHA-256)',
  tokenize: 'Tokenize',
  keep_last_4: 'Keep last 4',
  none: 'No masking',
};

const STRATEGY_COLORS: Record<MaskStrategy, string> = {
  redact: 'bg-red-100 text-red-700',
  hash: 'bg-blue-100 text-blue-700',
  tokenize: 'bg-purple-100 text-purple-700',
  keep_last_4: 'bg-yellow-100 text-yellow-700',
  none: 'bg-gray-100 text-gray-600',
};

export default function PiiConfigPage() {
  const [tab, setTab] = useState<Tab>('strategies');
  const [fieldRules, setFieldRules] = useState<FieldRule[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk rule state
  const [bulkPattern, setBulkPattern] = useState('*email*');
  const [bulkStrategy, setBulkStrategy] = useState<MaskStrategy>('hash');
  const [bulkApplyAll, setBulkApplyAll] = useState(true);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Preview state
  const [previewValue, setPreviewValue] = useState('alice@example.com');
  const [previewStrategy, setPreviewStrategy] = useState<MaskStrategy>('redact');
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  const workspaceId = 'default';

  const loadFieldRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/pii/fields', {
        headers: { 'x-workspace-id': workspaceId },
      });
      const body = await res.json() as { data?: FieldRule[]; error?: { message: string } };
      if (body.data) setFieldRules(body.data);
      else setError(body.error?.message ?? 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadAuditEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/pii/access-audit?limit=50', {
        headers: { 'x-workspace-id': workspaceId },
      });
      const body = await res.json() as { data?: AuditEvent[] };
      if (body.data) setAuditEvents(body.data);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (tab === 'strategies') loadFieldRules();
    else if (tab === 'audit') loadAuditEvents();
  }, [tab, loadFieldRules, loadAuditEvents]);

  async function updateStrategy(connectorId: string, fieldName: string, strategy: MaskStrategy) {
    await fetch(`/api/v1/admin/pii/fields/${connectorId}/${fieldName}/strategy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({ strategy }),
    });
    await loadFieldRules();
  }

  async function applyBulkRule() {
    const res = await fetch('/api/v1/admin/pii/fields/bulk-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({ fieldPattern: bulkPattern, strategy: bulkStrategy, applyToAllConnectors: bulkApplyAll }),
    });
    const body = await res.json() as { data?: { rulesUpdated: number }; error?: { message: string } };
    setBulkResult(body.data ? `${body.data.rulesUpdated} rules updated` : body.error?.message ?? 'Failed');
  }

  async function runPreview() {
    const res = await fetch('/api/v1/admin/pii/fields/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: previewValue, strategy: previewStrategy }),
    });
    const body = await res.json() as { data?: { masked: string } };
    setPreviewResult(body.data?.masked ?? 'Error');
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">PII Field Masking</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure per-field masking strategies, review the PII access audit log, and apply bulk rules.
        </p>
      </div>

      <div className="flex border-b border-gray-200">
        {(['strategies', 'audit', 'bulk'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'bulk' ? 'Bulk Editor' : t === 'strategies' ? 'Field Strategies' : 'Access Audit'}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>}

      {/* Field Strategies tab */}
      {tab === 'strategies' && (
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : fieldRules.length === 0 ? (
            <p className="text-sm text-gray-500">No field mask rules configured. Use the Bulk Editor tab to set rules, or the API to configure individual fields.</p>
          ) : (
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="text-sm w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['Connector', 'Field', 'Strategy', 'Updated', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {fieldRules.map((rule, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{rule.connectorId}</td>
                      <td className="px-4 py-2 font-mono text-xs">{rule.fieldName}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STRATEGY_COLORS[rule.strategy]}`}>
                          {STRATEGY_LABELS[rule.strategy]}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400">
                        {new Date(rule.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2">
                        <select
                          defaultValue={rule.strategy}
                          onChange={(e) => updateStrategy(rule.connectorId, rule.fieldName, e.target.value as MaskStrategy)}
                          className="text-xs border border-gray-200 rounded px-2 py-0.5"
                        >
                          {(Object.keys(STRATEGY_LABELS) as MaskStrategy[]).map((s) => (
                            <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Preview section */}
          <div className="border border-gray-200 rounded p-4 space-y-3">
            <h3 className="text-sm font-medium">Test masking output</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sample value</label>
                <input
                  type="text"
                  value={previewValue}
                  onChange={(e) => setPreviewValue(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Strategy</label>
                <select
                  value={previewStrategy}
                  onChange={(e) => setPreviewStrategy(e.target.value as MaskStrategy)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  {(Object.keys(STRATEGY_LABELS) as MaskStrategy[]).map((s) => (
                    <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={runPreview}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200"
              >
                Preview
              </button>
              {previewResult && (
                <span className="text-sm font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1">
                  {previewResult}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Access Audit tab */}
      {tab === 'audit' && (
        <div>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : auditEvents.length === 0 ? (
            <p className="text-sm text-gray-500">No PII access events recorded yet.</p>
          ) : (
            <div className="border border-gray-200 rounded overflow-hidden">
              <table className="text-xs w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['Time', 'Actor', 'Field', 'Connector', 'Access', 'Masked?'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditEvents.map((ev) => (
                    <tr key={ev.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{new Date(ev.accessedAt).toLocaleString()}</td>
                      <td className="px-3 py-2"><span className="font-mono">{ev.actorId}</span> <span className="text-gray-400">({ev.actorType})</span></td>
                      <td className="px-3 py-2 font-mono">{ev.fieldName}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{ev.connectorId}</td>
                      <td className="px-3 py-2 text-gray-600">{ev.accessType}</td>
                      <td className="px-3 py-2">
                        {ev.masked ? (
                          <span className="text-green-600 font-medium">Yes</span>
                        ) : (
                          <span className="text-red-500 font-medium">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Bulk editor tab */}
      {tab === 'bulk' && (
        <div className="space-y-4 max-w-xl">
          <p className="text-sm text-gray-600">
            Apply a masking strategy to all fields whose name matches a pattern (use <code className="font-mono bg-gray-100 px-1 rounded">*</code> as wildcard).
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Field name pattern</label>
              <input
                type="text"
                value={bulkPattern}
                onChange={(e) => setBulkPattern(e.target.value)}
                placeholder="*email*, phone*, *ssn*"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Strategy to apply</label>
              <select
                value={bulkStrategy}
                onChange={(e) => setBulkStrategy(e.target.value as MaskStrategy)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm"
              >
                {(Object.keys(STRATEGY_LABELS) as MaskStrategy[]).map((s) => (
                  <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={bulkApplyAll}
                onChange={(e) => setBulkApplyAll(e.target.checked)}
              />
              Apply to all connectors
            </label>

            <div className="flex items-center gap-3">
              <button
                onClick={applyBulkRule}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Apply Rule
              </button>
              {bulkResult && <span className="text-sm text-green-600">{bulkResult}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
