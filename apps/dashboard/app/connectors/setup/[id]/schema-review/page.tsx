'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SchemaFieldMapper } from '@/components/schema-field-mapper';
import type { SchemaFieldDecision } from '@/components/schema-field-mapper';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
const WORKSPACE_ID = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

// ─── Mock discovered schema for dev/preview ───────────────────────────────────
// In production this data comes from the connector's getSchema() result passed
// via router state or a GET /connectors/:id/schema-confirmation call.

const SAMPLE_FIELDS = [
  {
    name: 'id',
    inferredType: 'id' as const,
    isPii: false,
    accepted: true,
    sampleValues: ['1', '2', '3'],
    nullRate: 0,
    confidence: 1,
  },
  {
    name: 'email',
    inferredType: 'email' as const,
    isPii: true,
    accepted: true,
    sampleValues: ['alice@example.com', 'bob@example.com'],
    nullRate: 0.05,
    confidence: 0.97,
  },
  {
    name: 'full_name',
    inferredType: 'string' as const,
    isPii: false,
    accepted: true,
    sampleValues: ['Alice Smith', 'Bob Jones'],
    nullRate: 0.02,
    confidence: 0.95,
  },
  {
    name: 'company',
    inferredType: 'string' as const,
    isPii: false,
    accepted: true,
    sampleValues: ['Acme Corp', 'Globex', 'Initech'],
    nullRate: 0.1,
    confidence: 0.88,
  },
  {
    name: 'annual_revenue',
    inferredType: 'number' as const,
    isPii: false,
    accepted: true,
    sampleValues: ['50000', '120000', '8500'],
    nullRate: 0.3,
    confidence: 0.72,
  },
  {
    name: 'created_at',
    inferredType: 'date' as const,
    isPii: false,
    accepted: true,
    sampleValues: ['2026-01-15', '2026-03-22'],
    nullRate: 0,
    confidence: 1,
  },
  {
    name: '_internal_ref',
    inferredType: 'id' as const,
    isPii: false,
    accepted: false,
    sampleValues: ['ref-001'],
    nullRate: 0,
    confidence: 0.4,
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function SchemaReviewPage({ params }: PageProps): React.JSX.Element {
  const router = useRouter();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Resolve params (Next.js 15+ async params)
  if (!instanceId) {
    void params.then(p => setInstanceId(p.id));
  }

  const handleConfirm = useCallback(
    async (entityType: string, decisions: SchemaFieldDecision[]) => {
      const id = instanceId ?? 'unknown';
      const res = await fetch(
        `${API_BASE}/connectors/${id}/schema-confirmation?workspaceId=${WORKSPACE_ID}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, fields: decisions }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to save schema confirmation');
      }
      setSaved(true);
      setTimeout(() => { router.push('/connectors'); }, 1500);
    },
    [instanceId, router],
  );

  if (saved) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-center">
        <div className="rounded-lg border border-green-200 bg-green-50 p-10">
          <p className="text-lg font-semibold text-green-800">Schema confirmed!</p>
          <p className="mt-1 text-sm text-green-600">Redirecting to connectors…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <Link
          href="/connectors"
          className="mb-4 block text-sm text-gray-500 hover:text-gray-700"
        >
          ← Connectors
        </Link>
        <h1 className="text-2xl font-bold">Review Discovered Schema</h1>
        <p className="mt-1 text-sm text-gray-500">
          Iris auto-detected these fields. Accept the ones you want indexed, rename as needed,
          and mark any PII fields that should be masked before serving context to AI tools.
        </p>
      </header>

      <SchemaFieldMapper
        entityType="contact"
        fields={SAMPLE_FIELDS}
        onConfirm={handleConfirm}
      />

      <p className="mt-4 text-xs text-gray-400 text-center">
        Connector instance: <span className="font-mono">{instanceId ?? '…'}</span>
      </p>
    </main>
  );
}
