import { SessionList } from '@/components/session-list';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';
const USER_ID = process.env['IRIS_USER_ID'] ?? 'default';

export default function SessionsPage(): React.JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Sessions & Devices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your active sessions and trusted devices. Revoke any session you don&apos;t recognize.
        </p>
      </div>
      <SessionList workspaceId={WORKSPACE_ID} userId={USER_ID} />
    </div>
  );
}
