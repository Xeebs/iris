'use client';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'in'
  | 'startsWith'
  | 'endsWith';

export type FilterRule = {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
};

interface FilterRuleEditorProps {
  rule: FilterRule;
  availableFields: string[];
  onUpdate: (rule: FilterRule) => void;
  onRemove: () => void;
}

const OPERATORS: FilterOperator[] = [
  '=', '!=', '>', '<', '>=', '<=', 'contains', 'in', 'startsWith', 'endsWith',
];

const inputStyle: React.CSSProperties = {
  padding: '0.375rem 0.625rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.8125rem',
  background: 'white',
};

export function FilterRuleEditor({ rule, availableFields, onUpdate, onRemove }: FilterRuleEditorProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0.5rem',
        border: '1px solid #e2e8f0',
        borderRadius: '0.5rem',
        background: '#f8fafc',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '1.5rem' }}>WHERE</span>

      {/* Field selector */}
      <select
        value={rule.field}
        onChange={(e) => onUpdate({ ...rule, field: e.target.value })}
        style={inputStyle}
        aria-label="Filter field"
      >
        <option value="">Select field…</option>
        {availableFields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>

      {/* Operator selector */}
      <select
        value={rule.operator}
        onChange={(e) => onUpdate({ ...rule, operator: e.target.value as FilterOperator })}
        style={inputStyle}
        aria-label="Filter operator"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>

      {/* Value input */}
      <input
        type="text"
        value={rule.value}
        onChange={(e) => onUpdate({ ...rule, value: e.target.value })}
        placeholder={rule.operator === 'in' ? 'val1, val2, …' : 'value'}
        style={{ ...inputStyle, minWidth: '8rem', flex: 1 }}
        aria-label="Filter value"
      />

      {/* Remove button */}
      <button
        onClick={onRemove}
        style={{
          padding: '0.25rem 0.5rem',
          background: 'none',
          border: '1px solid #e2e8f0',
          borderRadius: '0.375rem',
          cursor: 'pointer',
          color: '#94a3b8',
          fontSize: '0.75rem',
        }}
        aria-label="Remove filter rule"
      >
        ✕
      </button>
    </div>
  );
}
