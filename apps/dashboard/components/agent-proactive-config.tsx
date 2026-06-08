'use client';

import { useState, useEffect, useCallback } from 'react';

interface AgentBehaviorProfile {
  agentId: string;
  frequentEntityTypes: string[];
  queryPatterns: Record<string, number>;
  totalQueries: number;
  learnedAt: string;
}

interface ProactiveSuggestion {
  id: string;
  entityTypes: string[];
  contextHints: string[];
  score: number;
}

interface AcceptanceStats {
  total: number;
  accepted: number;
  ignored: number;
  modified: number;
  acceptanceRate: number;
}

interface Props {
  workspaceId: string;
  agentId: string;
}

export function AgentProactiveConfig({ workspaceId, agentId }: Props) {
  const [profile, setProfile] = useState<AgentBehaviorProfile | null>(null);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [stats, setStats] = useState<AcceptanceStats | null>(null);
  const [aggressiveness, setAggressiveness] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const headers = { 'x-workspace-id': workspaceId };
    const [profileRes, previewRes, statsRes] = await Promise.all([
      fetch(`/api/v1/agents/${agentId}/profile`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`/api/v1/agents/${agentId}/proactive-preview`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`/api/v1/agents/${agentId}/acceptance-stats`, { headers }).then(r => r.ok ? r.json() : null),
    ]);
    if (profileRes?.data) setProfile(profileRes.data as AgentBehaviorProfile);
    if (previewRes?.data) setSuggestions(previewRes.data as ProactiveSuggestion[]);
    if (statsRes?.data) setStats(statsRes.data as AcceptanceStats);
  }, [workspaceId, agentId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch(`/api/v1/agents/${agentId}/proactive-settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ aggressiveness, enabledEntityTypes: profile?.frequentEntityTypes ?? [] }),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-5">
        <h2 className="text-base font-semibold mb-4">Proactive Context Settings</h2>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">Aggressiveness</label>
          <select
            className="w-full border rounded px-3 py-2 text-sm"
            value={aggressiveness}
            onChange={e => setAggressiveness(e.target.value as 'low' | 'medium' | 'high')}
          >
            <option value="low">Low — only high-confidence suggestions</option>
            <option value="medium">Medium — balanced suggestions (recommended)</option>
            <option value="high">High — broad pre-loading</option>
          </select>
          <button
            onClick={() => void saveSettings()}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>

      {stats && (
        <div className="bg-white rounded-lg border p-5">
          <h2 className="text-base font-semibold mb-4">Suggestion Performance</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Suggestions', value: stats.total },
              { label: 'Accepted', value: stats.accepted },
              { label: 'Ignored', value: stats.ignored },
              { label: 'Acceptance Rate', value: `${(stats.acceptanceRate * 100).toFixed(0)}%` },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {profile && (
        <div className="bg-white rounded-lg border p-5">
          <h2 className="text-base font-semibold mb-2">Behavioral Profile</h2>
          <p className="text-sm text-gray-500 mb-3">
            Based on {profile.totalQueries} queries. Last updated{' '}
            {new Date(profile.learnedAt).toLocaleDateString()}.
          </p>
          <div className="flex flex-wrap gap-2">
            {profile.frequentEntityTypes.map(type => (
              <span key={type} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded-full border border-blue-200">
                {type}
              </span>
            ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="bg-white rounded-lg border p-5">
          <h2 className="text-base font-semibold mb-3">Context Preview</h2>
          <p className="text-xs text-gray-500 mb-3">What would be proactively loaded for your next query:</p>
          {suggestions.map(s => (
            <div key={s.id} className="border rounded p-3 mb-2 bg-gray-50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-700">Score: {(s.score * 100).toFixed(0)}%</span>
                <div className="flex gap-1">
                  {s.entityTypes.map(t => (
                    <span key={t} className="px-1.5 py-0.5 text-xs bg-green-50 text-green-700 rounded">{t}</span>
                  ))}
                </div>
              </div>
              <ul className="text-xs text-gray-600 space-y-0.5">
                {s.contextHints.map((hint, i) => <li key={i}>• {hint}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
