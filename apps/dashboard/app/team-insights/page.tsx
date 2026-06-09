'use client';

import { useState, useEffect } from 'react';

type Recommendation = {
  entityId: string;
  entityType: string;
  score: number;
  reasons: string[];
};

type UsageSummary = {
  entityType: string;
  totalAccesses: number;
  uniqueEntities: number;
};

type ExpansionSuggestion = {
  entityId: string;
  entityType: string;
  suggestion: string;
  potentialValue: number;
};

const TEAMS = ['engineering', 'sales', 'finance', 'marketing'];
const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: 'bg-blue-900 text-blue-300',
  deal: 'bg-green-900 text-green-300',
  company: 'bg-purple-900 text-purple-300',
  activity: 'bg-yellow-900 text-yellow-300',
};

function entityColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] ?? 'bg-gray-800 text-gray-300';
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-gray-600';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-6 text-right">{score}</span>
    </div>
  );
}

export default function TeamInsightsPage() {
  const [selectedTeam, setSelectedTeam] = useState(TEAMS[0]!);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [expansions, setExpansions] = useState<ExpansionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadTeamData(selectedTeam);
  }, [selectedTeam]);

  async function loadTeamData(teamId: string) {
    setLoading(true);
    try {
      const [recRes, usageRes, expRes] = await Promise.allSettled([
        fetch(`/api/v1/teams/${encodeURIComponent(teamId)}/recommended-contexts?topK=12`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }).then((r) => r.json() as Promise<{ data: Recommendation[] }>),
        fetch(`/api/v1/teams/${encodeURIComponent(teamId)}/usage?window=30d`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }).then((r) => r.json() as Promise<{ data: UsageSummary[] }>),
        fetch(`/api/v1/teams/${encodeURIComponent(teamId)}/expansion-suggestions`, {
          headers: { 'x-workspace-id': WORKSPACE_ID },
        }).then((r) => r.json() as Promise<{ data: ExpansionSuggestion[] }>),
      ]);
      setRecommendations(recRes.status === 'fulfilled' ? recRes.value.data : []);
      setUsage(usageRes.status === 'fulfilled' ? usageRes.value.data : []);
      setExpansions(expRes.status === 'fulfilled' ? expRes.value.data : []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Team Context Insights</h1>
        <p className="text-sm text-gray-400 mt-1">Recommended context, usage patterns, and underexplored entities for each team.</p>
      </header>

      <div className="flex gap-2 mb-6">
        {TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTeam(t)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors capitalize ${selectedTeam === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm py-12 text-center">Loading team insights...</div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left: recommendations */}
          <div className="col-span-7">
            <h2 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">Recommended Contexts</h2>
            <div className="space-y-2">
              {recommendations.map((rec) => (
                <div key={rec.entityId} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${entityColor(rec.entityType)}`}>{rec.entityType}</span>
                      <span className="text-sm font-medium text-gray-200 truncate max-w-xs">{rec.entityId}</span>
                    </div>
                  </div>
                  <ScoreBar score={rec.score} />
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rec.reasons.map((reason) => (
                      <span key={reason} className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{reason}</span>
                    ))}
                  </div>
                </div>
              ))}
              {recommendations.length === 0 && (
                <div className="text-center py-10 text-gray-500 text-sm">No recommendations available yet — context access data is being collected.</div>
              )}
            </div>
          </div>

          {/* Right: usage + expansions */}
          <div className="col-span-5 space-y-6">
            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">Usage by Entity Type (30d)</h2>
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3">
                {usage.map((u) => (
                  <div key={u.entityType}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300 capitalize">{u.entityType}</span>
                      <span className="text-gray-500">{u.totalAccesses} accesses · {u.uniqueEntities} entities</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${Math.min(100, (u.totalAccesses / Math.max(...usage.map((x) => x.totalAccesses), 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {usage.length === 0 && <p className="text-sm text-gray-500">No usage data available.</p>}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-medium text-gray-300 mb-3 uppercase tracking-wide">New Contexts to Explore</h2>
              <div className="space-y-2">
                {expansions.map((exp) => (
                  <div key={exp.entityId} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
                    <div className="flex justify-between items-start mb-1">
                      <div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${entityColor(exp.entityType)}`}>{exp.entityType}</span>
                      </div>
                      <div className="text-xs text-green-400 font-medium">{exp.potentialValue}% unused</div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{exp.suggestion}</p>
                  </div>
                ))}
                {expansions.length === 0 && <p className="text-sm text-gray-500">No expansion suggestions.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
