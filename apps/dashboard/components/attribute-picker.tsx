'use client';

interface AttributePickerProps {
  entityType: string;
  selectedAttribute: string;
  onSelect: (attribute: string) => void;
  apiBase?: string;
}

const COMMON_ATTRIBUTES: Record<string, string[]> = {
  contact: ['email', 'name', 'company', 'phone', 'stage', 'owner', 'country'],
  company: ['name', 'domain', 'industry', 'size', 'country', 'owner'],
  deal: ['name', 'stage', 'amount', 'owner', 'closeDate', 'pipeline'],
  issue: ['title', 'status', 'priority', 'assignee', 'labels', 'project'],
  document: ['title', 'type', 'author', 'createdAt', 'updatedAt'],
  activity: ['type', 'subject', 'contact', 'owner', 'date'],
};

const DEFAULT_ATTRIBUTES = ['id', 'label', 'type', 'lastModified', 'sourceId'];

interface AttributePickerInternalProps extends AttributePickerProps {
  attributes?: string[];
  loading?: boolean;
}

export function AttributePicker({
  entityType,
  selectedAttribute,
  onSelect,
  attributes,
  loading = false,
}: AttributePickerInternalProps) {
  const availableAttrs = attributes ?? COMMON_ATTRIBUTES[entityType] ?? DEFAULT_ATTRIBUTES;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#475569' }}>Attribute</label>
      <select
        value={selectedAttribute}
        onChange={(e) => onSelect(e.target.value)}
        disabled={loading || !entityType}
        style={{
          padding: '0.375rem 0.625rem',
          border: '1px solid #d1d5db',
          borderRadius: '0.375rem',
          fontSize: '0.8125rem',
          background: 'white',
          minWidth: '160px',
          opacity: loading ? 0.5 : 1,
        }}
        aria-label={`Select attribute for ${entityType}`}
      >
        <option value="">Select attribute…</option>
        {availableAttrs.map((attr) => (
          <option key={attr} value={attr}>{attr}</option>
        ))}
      </select>
    </div>
  );
}

export function getAttributesForType(entityType: string): string[] {
  return COMMON_ATTRIBUTES[entityType] ?? DEFAULT_ATTRIBUTES;
}
