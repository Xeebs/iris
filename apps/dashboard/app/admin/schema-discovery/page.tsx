'use client';

import { useState } from 'react';
import { SchemaDiscoveryWizard } from '../../../components/schema-discovery-wizard.js';

/**
 * Admin page for schema auto-discovery.
 * Enter a connector ID to run discovery and confirm suggestions.
 */
export default function SchemaDiscoveryPage() {
  const [connectorId, setConnectorId] = useState('');
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null);

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Schema Auto-Discovery</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        Automatically detect entity types and relationships from a connector's data schema.
        Review and confirm suggestions to improve semantic search quality.
      </p>

      {/* Connector ID input */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 32, maxWidth: 520 }}>
        <input
          type="text"
          value={connectorId}
          onChange={e => setConnectorId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && connectorId.trim() && setActiveConnectorId(connectorId.trim())}
          placeholder="Enter connector ID (e.g. hubspot-prod)"
          style={{
            flex: 1,
            padding: '9px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={() => connectorId.trim() && setActiveConnectorId(connectorId.trim())}
          disabled={!connectorId.trim()}
          style={{
            padding: '9px 20px',
            background: connectorId.trim() ? '#2563eb' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: connectorId.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Load
        </button>
      </div>

      {activeConnectorId ? (
        <SchemaDiscoveryWizard connectorId={activeConnectorId} />
      ) : (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            border: '2px dashed #e5e7eb',
            borderRadius: 12,
            color: '#9ca3af',
            fontSize: 14,
          }}
        >
          Enter a connector ID above to start schema discovery.
        </div>
      )}
    </div>
  );
}
