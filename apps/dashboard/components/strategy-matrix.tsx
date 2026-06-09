'use client';

import { useState } from 'react';

type StrategyScore = {
  strategy: string;
  estimatedLatencyMs: number;
  estimatedTokenCost: number;
  overallScore: number;
  pros: string[];
  cons: string[];
};

type StrategyMatrixProps = {
  strategies: StrategyScore[];
  selectedStrategy?: string;
  onSelect?: (strategy: string) => void;
};

type SortKey = 'strategy' | 'estimatedLatencyMs' | 'estimatedTokenCost' | 'overallScore';

const STRATEGY_LABELS: Record<string, string> = {
  parallel: 'Parallel',
  sequential: 'Sequential',
  'filtered-first': 'Filtered First',
  'cached-first': 'Cached First',
};

export function StrategyMatrix({ strategies, selectedStrategy, onSelect }: StrategyMatrixProps) {
  const [sortKey, setSortKey] = useState<SortKey>('overallScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = [...strategies].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function headerCell(key: SortKey, label: string) {
    return (
      <th
        onClick={() => toggleSort(key)}
        style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
      >
        {label} {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
            {headerCell('strategy', 'Strategy')}
            {headerCell('estimatedLatencyMs', 'Est. Latency')}
            {headerCell('estimatedTokenCost', 'Token Cost')}
            {headerCell('overallScore', 'Score')}
            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>Pros / Cons</th>
            {onSelect && <th style={{ padding: '0.5rem 0.75rem' }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const isSelected = s.strategy === selectedStrategy;
            return (
              <tr key={s.strategy} style={{
                borderBottom: '1px solid #f3f4f6',
                background: isSelected ? '#eff6ff' : 'transparent',
              }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: isSelected ? 700 : 400 }}>
                  {STRATEGY_LABELS[s.strategy] ?? s.strategy}
                  {isSelected && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: '#3b82f6' }}>✓ selected</span>}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>{s.estimatedLatencyMs}ms</td>
                <td style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>{s.estimatedTokenCost}</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: 48, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${Math.min(s.overallScore * 100, 100)}%`,
                        height: '100%',
                        background: s.overallScore > 0.7 ? '#22c55e' : s.overallScore > 0.4 ? '#f59e0b' : '#ef4444',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.8125rem', color: '#374151' }}>
                      {(s.overallScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: '#6b7280', maxWidth: 300 }}>
                  {s.pros.slice(0, 2).map((p) => <div key={p} style={{ color: '#15803d' }}>+ {p}</div>)}
                  {s.cons.slice(0, 1).map((c) => <div key={c} style={{ color: '#dc2626' }}>− {c}</div>)}
                </td>
                {onSelect && (
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <button
                      onClick={() => onSelect(s.strategy)}
                      disabled={isSelected}
                      style={{
                        padding: '0.25rem 0.75rem', borderRadius: 4,
                        border: '1px solid #d1d5db',
                        background: isSelected ? '#e5e7eb' : '#fff',
                        cursor: isSelected ? 'default' : 'pointer',
                        fontSize: '0.8125rem',
                      }}
                    >
                      {isSelected ? 'Active' : 'Select'}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
