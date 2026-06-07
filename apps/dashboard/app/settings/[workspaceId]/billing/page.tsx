import { BillingUsageChart } from '@/components/billing-usage-chart';

interface BillingPageProps {
  params: { workspaceId: string };
}

export default function BillingPage({ params }: BillingPageProps): React.JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Billing & Usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor your usage and manage your subscription plan.
        </p>
      </div>
      <BillingUsageChart workspaceId={params.workspaceId} />
    </div>
  );
}
