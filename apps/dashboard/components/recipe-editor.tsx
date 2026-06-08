'use client';

import { useState } from 'react';
import type { ConnectorRecipe, ConnectorConfig, GlossaryTerm } from './recipe-gallery';

type RecipeCategory = ConnectorRecipe['category'];

type Props = {
  initial?: Partial<ConnectorRecipe>;
  workspaceId: string;
  onSave: (data: RecipeSavePayload) => Promise<void>;
  onCancel: () => void;
};

export type RecipeSavePayload = {
  recipeName: string;
  description: string;
  category: RecipeCategory;
  connectorsConfig: ConnectorConfig[];
  glossaryTerms: GlossaryTerm[];
  shared: boolean;
};

const CATEGORY_OPTIONS: Array<{ value: RecipeCategory; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'finance', label: 'Finance' },
  { value: 'ops', label: 'Operations' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'hr', label: 'HR' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'general', label: 'General' },
];

const CONNECTOR_OPTIONS = ['hubspot', 'salesforce', 'stripe', 'quickbooks', 'netsuite', 'google-drive', 'notion', 'jira', 'confluence', 'slack', 'linear', 'snowflake', 'postgres', 'airtable'];
const FREQ_OPTIONS = ['hourly', 'daily', 'weekly'];

function ConnectorEditor({ connectors, onChange }: {
  connectors: ConnectorConfig[];
  onChange: (updated: ConnectorConfig[]) => void;
}) {
  function add() {
    onChange([...connectors, { connectorId: '', type: '' }]);
  }
  function remove(idx: number) {
    onChange(connectors.filter((_, i) => i !== idx));
  }
  function update(idx: number, field: keyof ConnectorConfig, value: string) {
    const updated = connectors.map((c, i) => {
      if (i !== idx) return c;
      if (field === 'syncFrequency') {
        const next: ConnectorConfig = { ...c };
        if (value) next.syncFrequency = value;
        else delete next.syncFrequency;
        return next;
      }
      return { ...c, [field]: value } as ConnectorConfig;
    });
    onChange(updated);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Connectors</span>
        <button onClick={add} style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
      </div>
      {connectors.map((c, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <select
            value={c.connectorId}
            onChange={(e) => { update(idx, 'connectorId', e.target.value); update(idx, 'type', e.target.value); }}
            style={{ flex: 2, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            <option value="">Select connector</option>
            {CONNECTOR_OPTIONS.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <select
            value={c.syncFrequency ?? ''}
            onChange={(e) => update(idx, 'syncFrequency', e.target.value)}
            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            <option value="">Frequency</option>
            {FREQ_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={() => remove(idx)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      ))}
      {connectors.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>No connectors added yet</div>
      )}
    </div>
  );
}

function GlossaryEditor({ terms, onChange }: {
  terms: GlossaryTerm[];
  onChange: (updated: GlossaryTerm[]) => void;
}) {
  function add() {
    onChange([...terms, { term: '', definition: '' }]);
  }
  function remove(idx: number) {
    onChange(terms.filter((_, i) => i !== idx));
  }
  function update(idx: number, field: keyof GlossaryTerm, value: string) {
    onChange(terms.map((t, i) => i === idx ? { ...t, [field]: value } : t));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Glossary Terms</span>
        <button onClick={add} style={{ fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
      </div>
      {terms.map((t, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            placeholder="Term"
            value={t.term}
            onChange={(e) => update(idx, 'term', e.target.value)}
            style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          />
          <input
            placeholder="Definition"
            value={t.definition}
            onChange={(e) => update(idx, 'definition', e.target.value)}
            style={{ flex: 3, padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          />
          <button onClick={() => remove(idx)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}

/**
 * Form for creating or editing a connector recipe.
 */
export function RecipeEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.recipeName ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [category, setCategory] = useState<RecipeCategory>(initial?.category ?? 'general');
  const [connectors, setConnectors] = useState<ConnectorConfig[]>(initial?.connectorsConfig ?? []);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>(initial?.glossaryTerms ?? []);
  const [shared, setShared] = useState(initial?.shared ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && connectors.length > 0 && connectors.every((c) => c.connectorId);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ recipeName: name.trim(), description: desc.trim(), category, connectorsConfig: connectors, glossaryTerms: glossary, shared });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };

  const sectionStyle: React.CSSProperties = {
    background: '#f9fafb', borderRadius: 10, padding: 16, marginBottom: 16,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Recipe Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Operations Setup" style={inputStyle} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Description</label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What does this recipe do?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 4 }}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as RecipeCategory)} style={{ ...inputStyle, width: '100%' }}>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ paddingTop: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="shared-toggle" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <label htmlFor="shared-toggle" style={{ fontSize: 14, color: '#374151', cursor: 'pointer' }}>Share publicly</label>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <ConnectorEditor connectors={connectors} onChange={setConnectors} />
      </div>

      <div style={sectionStyle}>
        <GlossaryEditor terms={glossary} onChange={setGlossary} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 8,
            border: '1px solid #d1d5db', background: '#fff',
            color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 8,
            border: 'none', background: canSave && !saving ? '#6366f1' : '#d1d5db',
            color: '#fff', fontWeight: 600, fontSize: 14,
            cursor: canSave && !saving ? 'pointer' : 'default',
          }}
        >
          {saving ? 'Saving…' : 'Save Recipe'}
        </button>
      </div>
    </div>
  );
}
