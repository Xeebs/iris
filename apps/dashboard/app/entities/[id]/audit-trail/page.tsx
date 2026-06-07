import { EntityAuditTimeline } from '../../../../components/entity-audit-timeline';

export default function AuditTrailPage({ params }: { params: { id: string } }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f3f4f6', marginBottom: 4 }}>
        Audit Trail
      </h1>
      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 24 }}>
        Entity: <code style={{ color: '#93c5fd' }}>{params.id}</code>
      </p>
      <EntityAuditTimeline entityId={params.id} />
    </main>
  );
}
