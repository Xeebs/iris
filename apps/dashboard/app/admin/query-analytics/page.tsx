'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SlowQueryExplorer } from '@/components/slow-query-explorer';
import { EntityAccessHeatmap } from '@/components/entity-access-heatmap';

interface SlowQuery {
  queryHash: string;
  queryText: string | null;
  p50Ms: number;
  p95Ms: number;
  callCount: number;
  avgResultSize: number | null;
}

interface EntityAccessEntry {
  entityId: string;
  accessCount: number;
  lastAccessed: string;
}

interface IndexRecommendation {
  type: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
  estimatedImpact: string;
  sqlHint?: string;
}

const PRIORITY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
};

export default function QueryAnalyticsPage() {
  const [days, setDays] = useState('7');
  const [slowQueries, setSlowQueries] = useState<SlowQuery[]>([]);
  const [patterns, setPatterns] = useState<EntityAccessEntry[]>([]);
  const [recommendations, setRecommendations] = useState<IndexRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  useEffect(() => { void fetchAll(); }, [days]);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [slowRes, patternsRes, recsRes] = await Promise.all([
        fetch(`/api/v1/admin/analytics/queries/slow?days=${days}`),
        fetch(`/api/v1/admin/analytics/queries/patterns?days=${days}`),
        fetch('/api/v1/admin/analytics/index-recommendations'),
      ]);
      if (slowRes.ok) setSlowQueries(((await slowRes.json()) as { data: SlowQuery[] }).data);
      if (patternsRes.ok) setPatterns(((await patternsRes.json()) as { data: EntityAccessEntry[] }).data);
      if (recsRes.ok) setRecommendations(((await recsRes.json()) as { data: IndexRecommendation[] }).data);
    } catch {
      setError('Failed to load query analytics');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Query Analytics</h1>
          <p className="text-muted-foreground">Slow query explorer, entity access patterns, and index optimization.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Slow Queries</CardTitle>
          <CardDescription>Queries with p95 latency &gt; 1s, sorted by worst latency first.</CardDescription>
        </CardHeader>
        <CardContent>
          <SlowQueryExplorer queries={slowQueries} loading={loading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entity Access Heatmap</CardTitle>
          <CardDescription>Most-accessed entities in the selected period.</CardDescription>
        </CardHeader>
        <CardContent>
          <EntityAccessHeatmap entries={patterns} loading={loading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Index Optimization Recommendations</CardTitle>
          <CardDescription>Based on entity count and recent query latency patterns.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Analyzing index configuration…</p>}
          {!loading && (
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <div key={rec.type} className="border rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={PRIORITY_VARIANT[rec.priority] ?? 'secondary'}>{rec.priority}</Badge>
                      <span className="font-medium text-sm">{rec.description}</span>
                    </div>
                    {rec.sqlHint && (
                      <button
                        onClick={() => setExpandedRec(expandedRec === rec.type ? null : rec.type)}
                        className="text-xs text-primary hover:underline"
                      >
                        {expandedRec === rec.type ? 'Hide SQL' : 'Show SQL'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Expected impact: {rec.estimatedImpact}</p>
                  {expandedRec === rec.type && rec.sqlHint && (
                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">{rec.sqlHint}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
