'use client';

import { useState } from 'react';
import { TransformationRuleEditor } from '@/components/transformation-rule-editor';
import { TransformationTestPanel } from '@/components/transformation-test-panel';

type Tab = 'rules' | 'test';

export default function TransformationsPage() {
  const [tab, setTab] = useState<Tab>('rules');
  const workspaceId =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('workspaceId') ?? '')
      : '';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Custom Transformations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define transformation pipelines that normalize, reshape, and enrich entity data at
          sync time — no code required.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(['rules', 'test'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'rules' ? 'Transformation Rules' : 'Test Panel'}
          </button>
        ))}
      </div>

      {tab === 'rules' && <TransformationRuleEditor workspaceId={workspaceId} />}
      {tab === 'test' && <TransformationTestPanel workspaceId={workspaceId} />}
    </div>
  );
}
