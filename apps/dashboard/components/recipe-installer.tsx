'use client';

import { useState } from 'react';
import type { ConnectorRecipe } from './recipe-gallery';

type InstallStep = 'idle' | 'confirming' | 'installing' | 'done' | 'error';

type Props = {
  recipe: ConnectorRecipe;
  workspaceId: string;
  onClose: () => void;
  onInstalled?: (recipe: ConnectorRecipe) => void;
};

/**
 * Modal panel that confirms and drives recipe installation into a workspace.
 * Calls POST /api/v1/recipes/:id/apply-to-workspace then POST /api/v1/recipes/:id/clone
 * to create a local copy the user can customise.
 */
export function RecipeInstaller({ recipe, workspaceId, onClose, onInstalled }: Props) {
  const [step, setStep] = useState<InstallStep>('confirming');
  const [error, setError] = useState<string | null>(null);
  const [cloneId, setCloneId] = useState<string | null>(null);

  async function handleInstall() {
    setStep('installing');
    setError(null);
    try {
      const cloneRes = await fetch(`/api/v1/recipes/${recipe.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      });
      if (!cloneRes.ok) {
        const body = await cloneRes.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Clone failed');
      }
      const cloneBody = await cloneRes.json() as { data: ConnectorRecipe };
      setCloneId(cloneBody.data.id);

      await fetch(`/api/v1/recipes/${recipe.id}/apply-to-workspace`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });

      setStep('done');
      onInstalled?.(cloneBody.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Installation failed');
      setStep('error');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`Install ${recipe.recipeName}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32, maxWidth: 480, width: '100%',
        margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8, color: '#111827' }}>
          {step === 'done' ? 'Recipe installed!' : `Install "${recipe.recipeName}"`}
        </div>

        {step === 'confirming' && (
          <>
            <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              This will create a copy of this recipe in your workspace. You can customise it at any time.
            </p>

            <div style={{ background: '#f9fafb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 10 }}>Included connectors</div>
              {recipe.connectorsConfig.map((c) => (
                <div key={c.connectorId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', background: '#6366f1', display: 'inline-block',
                  }} />
                  <span style={{ fontSize: 13, color: '#374151' }}>{c.connectorId}</span>
                  {c.syncFrequency && (
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>({c.syncFrequency})</span>
                  )}
                </div>
              ))}
              {recipe.glossaryTerms.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginTop: 12, marginBottom: 6 }}>
                    Glossary terms ({recipe.glossaryTerms.length})
                  </div>
                  {recipe.glossaryTerms.slice(0, 3).map((t) => (
                    <div key={t.term} style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>
                      <strong>{t.term}</strong> — {t.definition}
                    </div>
                  ))}
                  {recipe.glossaryTerms.length > 3 && (
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      +{recipe.glossaryTerms.length - 3} more…
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  border: '1px solid #d1d5db', background: '#fff',
                  color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  border: 'none', background: '#6366f1',
                  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Install Recipe
              </button>
            </div>
          </>
        )}

        {step === 'installing' && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
            <div>Installing recipe…</div>
          </div>
        )}

        {step === 'done' && (
          <>
            <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              The recipe has been cloned into your workspace.
              {cloneId && <span> Recipe ID: <code style={{ fontSize: 12 }}>{cloneId}</code></span>}
            </p>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 8,
                border: 'none', background: '#10b981',
                color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  border: '1px solid #d1d5db', background: '#fff',
                  color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirming')}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8,
                  border: 'none', background: '#6366f1',
                  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
