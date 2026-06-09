'use client';

type ComplianceStatus = 'compliant' | 'non_compliant' | 'not_assessed' | 'in_progress';

type ComplianceBadgeProps = {
  standard: 'GDPR' | 'HIPAA' | 'SOC2';
  status: ComplianceStatus;
  certExpiresAt?: string | null;
  onUpdate?: (status: ComplianceStatus) => void;
};

const STATUS_CONFIG: Record<ComplianceStatus, { label: string; bg: string; color: string; border: string }> = {
  compliant: { label: 'Compliant', bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },
  non_compliant: { label: 'Non-Compliant', bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
  in_progress: { label: 'In Progress', bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  not_assessed: { label: 'Not Assessed', bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
};

const STANDARD_ICONS: Record<string, string> = {
  GDPR: '🇪🇺',
  HIPAA: '🏥',
  SOC2: '🔒',
};

export function ComplianceBadge({ standard, status, certExpiresAt, onUpdate }: ComplianceBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const expiry = certExpiresAt ? new Date(certExpiresAt) : null;
  const daysUntilExpiry = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000) : null;
  const expiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  const expired = daysUntilExpiry !== null && daysUntilExpiry <= 0;

  return (
    <div style={{
      border: `1px solid ${cfg.border}`,
      borderRadius: 8,
      padding: '0.875rem 1rem',
      background: '#fff',
      fontFamily: 'sans-serif',
      minWidth: 160,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#111827' }}>
          {STANDARD_ICONS[standard]} {standard}
        </span>
        <span style={{
          padding: '0.2rem 0.5rem',
          borderRadius: 12,
          fontSize: '0.75rem',
          fontWeight: 600,
          background: cfg.bg,
          color: cfg.color,
          border: `1px solid ${cfg.border}`,
        }}>
          {cfg.label}
        </span>
      </div>

      {expiry && (
        <div style={{ fontSize: '0.75rem', color: expired ? '#ef4444' : expiringSoon ? '#d97706' : '#9ca3af', marginBottom: '0.4rem' }}>
          {expired
            ? `Certificate expired ${Math.abs(daysUntilExpiry!)} days ago`
            : `Certificate expires in ${daysUntilExpiry} days`}
        </div>
      )}

      {!expiry && status === 'not_assessed' && (
        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No certificate on file</div>
      )}

      {onUpdate && (
        <select
          value={status}
          onChange={(e) => onUpdate(e.target.value as ComplianceStatus)}
          style={{ marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.25rem 0.4rem', border: '1px solid #d1d5db', borderRadius: 4, width: '100%', color: '#374151' }}
        >
          <option value="not_assessed">Not Assessed</option>
          <option value="in_progress">In Progress</option>
          <option value="compliant">Compliant</option>
          <option value="non_compliant">Non-Compliant</option>
        </select>
      )}
    </div>
  );
}
