'use client';

type AuditAction =
  | 'entity_read' | 'entity_write' | 'config_change' | 'permission_change'
  | 'connector_sync' | 'dsr_executed' | 'login' | 'logout';

export type AuditLogFilterValues = {
  action?: AuditAction;
  actorId?: string;
  resourceType?: string;
  startDate?: string;
  endDate?: string;
};

type AuditLogFilterProps = {
  values: AuditLogFilterValues;
  onChange: (values: AuditLogFilterValues) => void;
  onReset: () => void;
};

const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: 'entity_read', label: 'Entity Read' },
  { value: 'entity_write', label: 'Entity Write' },
  { value: 'config_change', label: 'Config Change' },
  { value: 'permission_change', label: 'Permission Change' },
  { value: 'connector_sync', label: 'Connector Sync' },
  { value: 'dsr_executed', label: 'DSR Executed' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
];

const inputStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 6,
  color: '#f3f4f6',
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#9ca3af',
  marginBottom: 4,
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

/**
 * Filter bar for the audit log viewer. Controlled component — call onChange on any change.
 */
export function AuditLogFilter({ values, onChange, onReset }: AuditLogFilterProps) {
  const update = (patch: Partial<AuditLogFilterValues>) => onChange({ ...values, ...patch });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
      <div>
        <label style={labelStyle}>Action</label>
        <select
          style={inputStyle}
          value={values.action ?? ''}
          onChange={(e) => {
            const v = e.target.value as AuditAction | '';
            update(v ? { action: v } : { action: undefined });
          }}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Actor ID</label>
        <input
          style={inputStyle}
          type="text"
          placeholder="user-id or key-id"
          value={values.actorId ?? ''}
          onChange={(e) => update({ actorId: e.target.value || undefined })}
        />
      </div>

      <div>
        <label style={labelStyle}>Resource Type</label>
        <input
          style={inputStyle}
          type="text"
          placeholder="contact, deal…"
          value={values.resourceType ?? ''}
          onChange={(e) => update({ resourceType: e.target.value || undefined })}
        />
      </div>

      <div>
        <label style={labelStyle}>From</label>
        <input
          style={inputStyle}
          type="date"
          value={values.startDate ?? ''}
          onChange={(e) => update({ startDate: e.target.value || undefined })}
        />
      </div>

      <div>
        <label style={labelStyle}>To</label>
        <input
          style={inputStyle}
          type="date"
          value={values.endDate ?? ''}
          onChange={(e) => update({ endDate: e.target.value || undefined })}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button
          onClick={onReset}
          style={{
            background: '#374151', border: 'none', borderRadius: 6, color: '#9ca3af',
            padding: '7px 16px', fontSize: 13, cursor: 'pointer', width: '100%',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
