import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Billing — Iris Admin' };

interface BillingSummary {
  mrr_cents: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  churned_this_month: number;
  failed_payments: number;
  refunds_this_month: number;
  revenue_by_plan: Record<string, number>;
}

async function fetchBillingSummary(apiBase: string): Promise<BillingSummary | null> {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/billing/summary`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: BillingSummary };
    return body.data;
  } catch {
    return null;
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default async function AdminBillingPage() {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';
  const billing = await fetchBillingSummary(apiBase);

  const cards = billing
    ? [
        { label: 'MRR', value: formatCents(billing.mrr_cents), highlight: false },
        { label: 'Active Subscriptions', value: billing.active_subscriptions.toLocaleString(), highlight: false },
        { label: 'Trials', value: billing.trial_subscriptions.toLocaleString(), highlight: false },
        { label: 'Churned This Month', value: billing.churned_this_month.toLocaleString(), highlight: billing.churned_this_month > 0 },
        { label: 'Failed Payments', value: billing.failed_payments.toLocaleString(), highlight: billing.failed_payments > 0 },
        { label: 'Refunds This Month', value: billing.refunds_this_month.toLocaleString(), highlight: billing.refunds_this_month > 0 },
      ]
    : [];

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
          Billing Dashboard
        </h1>
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
          Revenue metrics, subscription health, and payment alerts.
        </p>
      </div>

      {!billing && (
        <div style={{ padding: '1.25rem', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '0.5rem', color: '#854d0e', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Billing data unavailable — ensure the billing service is configured.
        </div>
      )}

      {billing && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {cards.map(({ label, value, highlight }) => (
              <div key={label} style={{ padding: '1.25rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'white' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>{label}</p>
                <p style={{ margin: '0.375rem 0 0', fontSize: '1.5rem', fontWeight: 700, color: highlight ? '#dc2626' : '#111827' }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {Object.keys(billing.revenue_by_plan).length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'white', overflow: 'hidden' }}>
              <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
                <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>Revenue by Plan</h2>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    {['Plan', 'MRR'].map((h) => (
                      <th key={h} style={{ padding: '0.625rem 1.25rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(billing.revenue_by_plan)
                    .sort(([, a], [, b]) => b - a)
                    .map(([plan, cents]) => (
                      <tr key={plan} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1.25rem', color: '#111827', fontWeight: 500 }}>{plan}</td>
                        <td style={{ padding: '0.75rem 1.25rem', color: '#374151' }}>{formatCents(cents)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
