'use client';

import { useState, useEffect, useCallback } from 'react';
import { RecipeGallery, type ConnectorRecipe } from '@/components/recipe-gallery';
import { RecipeInstaller } from '@/components/recipe-installer';
import { RecipeEditor, type RecipeSavePayload } from '@/components/recipe-editor';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

type ViewMode = 'gallery' | 'create' | 'preview';

export default function RecipesPage(): React.JSX.Element {
  const [recipes, setRecipes] = useState<ConnectorRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('gallery');
  const [selectedRecipe, setSelectedRecipe] = useState<ConnectorRecipe | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<string | null>(null);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/recipes/shared');
      if (res.ok) {
        const body = await res.json() as { data: ConnectorRecipe[] };
        setRecipes(body.data);
      }
      const predefinedRes = await fetch('/api/v1/recipes/predefined');
      if (predefinedRes.ok) {
        const body = await predefinedRes.json() as { data: ConnectorRecipe[] };
        setRecipes((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const newRecipes = body.data.filter((r) => !existingIds.has(r.id));
          return [...prev, ...newRecipes];
        });
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  function showNotification(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  }

  async function handleInstall(recipe: ConnectorRecipe) {
    setSelectedRecipe(recipe);
  }

  function handleInstalledConfirmed(recipe: ConnectorRecipe) {
    setInstalledIds((prev) => new Set(prev).add(recipe.id));
    setSelectedRecipe(null);
    showNotification(`"${recipe.recipeName}" installed successfully!`);
  }

  async function handleSaveRecipe(data: RecipeSavePayload) {
    const res = await fetch('/api/v1/recipes/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } };
      throw new Error(body.error?.message ?? 'Failed to save recipe');
    }
    await loadRecipes();
    setView('gallery');
    showNotification('Recipe created successfully!');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Notification toast */}
      {notification && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 100,
          background: '#111827', color: '#fff', borderRadius: 10,
          padding: '12px 20px', fontSize: 14, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {notification}
        </div>
      )}

      {/* Install modal */}
      {selectedRecipe && view !== 'create' && (
        <RecipeInstaller
          recipe={selectedRecipe}
          workspaceId={WORKSPACE_ID}
          onClose={() => setSelectedRecipe(null)}
          onInstalled={handleInstalledConfirmed}
        />
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: 0 }}>Recipe Marketplace</h1>
            <p style={{ color: '#6b7280', fontSize: 15, marginTop: 6 }}>
              Reusable connector configurations for common business workflows
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {view !== 'gallery' && (
              <button
                onClick={() => setView('gallery')}
                style={{
                  padding: '10px 18px', borderRadius: 8, border: '1px solid #d1d5db',
                  background: '#fff', color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer',
                }}
              >
                Back to Gallery
              </button>
            )}
            {view === 'gallery' && (
              <button
                onClick={() => setView('create')}
                style={{
                  padding: '10px 18px', borderRadius: 8, border: 'none',
                  background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                + Create Recipe
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        {view === 'gallery' && (
          <div style={{
            display: 'flex', gap: 24, marginBottom: 28, padding: '16px 20px',
            background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb',
          }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{recipes.length}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Total Recipes</div>
            </div>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{installedIds.size}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Installed</div>
            </div>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>
                {new Set(recipes.map((r) => r.category)).size}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Categories</div>
            </div>
          </div>
        )}

        {/* Main content */}
        {view === 'gallery' && (
          loading ? (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '64px 0', fontSize: 14 }}>
              Loading recipes…
            </div>
          ) : (
            <RecipeGallery
              recipes={recipes}
              onInstall={handleInstall}
              onPreview={(recipe) => { setSelectedRecipe(recipe); }}
              installedIds={installedIds}
            />
          )
        )}

        {view === 'create' && (
          <div style={{ maxWidth: 600 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 20 }}>Create New Recipe</h2>
            <RecipeEditor
              workspaceId={WORKSPACE_ID}
              onSave={handleSaveRecipe}
              onCancel={() => setView('gallery')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
