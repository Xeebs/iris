'use client';

import { useState } from 'react';
import { MetricFormulaEditor } from '../../../../../components/metric-formula-editor';
import { MetricDragDropBuilder } from '../../../../../components/metric-drag-drop-builder';
import { MetricPreview } from '../../../../../components/metric-preview';
import { MetricTestPanel } from '../../../../../components/metric-test-panel';

type ActiveTab = 'editor' | 'builder' | 'test';

type Props = {
  params: { workspaceId: string };
};

export default function MetricBuilderPage({ params }: Props) {
  const { workspaceId } = params;
  const [formula, setFormula] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('editor');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || !formula.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/v1/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ name, formula, description }),
      });
      if (!res.ok) {
        const body = await res.json() as { error: { message: string } };
        throw new Error(body.error.message);
      }
      setSaveMsg('Metric saved');
      setName('');
      setFormula('');
      setDescription('');
    } catch (e: unknown) {
      setSaveMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const tabStyle = (t: ActiveTab) => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: activeTab === t ? '2px solid #6366f1' : '2px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: activeTab === t ? 600 : 400,
    color: activeTab === t ? '#6366f1' : '#6b7280',
  });

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Custom Metric Builder</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Define custom metrics using formula expressions. Metrics can reference entity attributes (SUM, COUNT, AVG, etc.).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Metric name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Revenue per Customer"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this metric represent?"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <button style={tabStyle('editor')} onClick={() => setActiveTab('editor')}>Formula Editor</button>
        <button style={tabStyle('builder')} onClick={() => setActiveTab('builder')}>Visual Builder</button>
        <button style={tabStyle('test')} onClick={() => setActiveTab('test')}>Test Cases</button>
      </div>

      {activeTab === 'editor' && (
        <MetricFormulaEditor value={formula} onChange={setFormula} workspaceId={workspaceId} />
      )}
      {activeTab === 'builder' && (
        <MetricDragDropBuilder onFormulaChange={setFormula} />
      )}
      {activeTab === 'test' && (
        <MetricTestPanel formula={formula} workspaceId={workspaceId} />
      )}

      <div style={{ marginTop: 24 }}>
        <MetricPreview metricName={name} formula={formula} workspaceId={workspaceId} />
      </div>

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !name.trim() || !formula.trim()}
          style={{
            padding: '10px 24px',
            background: saving || !name.trim() || !formula.trim() ? '#e5e7eb' : '#6366f1',
            color: saving || !name.trim() || !formula.trim() ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: saving || !name.trim() || !formula.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {saving ? 'Saving…' : 'Save Metric'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 13, color: saveMsg.startsWith('Save failed') ? '#ef4444' : '#10b981' }}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}
