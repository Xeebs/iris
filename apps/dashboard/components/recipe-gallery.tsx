'use client';

import { useState } from 'react';

export type RecipeCategory = 'sales' | 'finance' | 'ops' | 'engineering' | 'hr' | 'marketing' | 'general';

export interface ConnectorConfig {
  connectorId: string;
  type: string;
  fieldMappings?: Record<string, string>;
  syncFrequency?: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface RecipeWorkflowStep {
  stepId: string;
  type: string;
  config: Record<string, unknown>;
}

export interface ConnectorRecipe {
  id: string;
  workspaceId: string;
  recipeName: string;
  description: string;
  category: RecipeCategory;
  connectorsConfig: ConnectorConfig[];
  glossaryTerms: GlossaryTerm[];
  workflows: RecipeWorkflowStep[];
  authorUserId: string;
  shared: boolean;
  usageCount: number;
  version: number;
  avgRating: number | null;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<RecipeCategory | 'all', string> = {
  all: 'All',
  sales: 'Sales',
  finance: 'Finance',
  ops: 'Operations',
  engineering: 'Engineering',
  hr: 'HR',
  marketing: 'Marketing',
  general: 'General',
};

const CATEGORY_COLORS: Record<RecipeCategory, string> = {
  sales: '#3b82f6',
  finance: '#10b981',
  ops: '#f59e0b',
  engineering: '#8b5cf6',
  hr: '#ec4899',
  marketing: '#f97316',
  general: '#6b7280',
};

type Props = {
  recipes: ConnectorRecipe[];
  onInstall: (recipe: ConnectorRecipe) => Promise<void>;
  onPreview: (recipe: ConnectorRecipe) => void;
  installedIds?: Set<string>;
};

function StarRating({ rating }: { rating: number | null }) {
  if (rating === null) return <span style={{ color: '#9ca3af', fontSize: 12 }}>No reviews</span>;
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < full ? '#f59e0b' : (i === full && half ? '#f59e0b' : '#d1d5db'), fontSize: 14 }}>
          {i < full ? '★' : (i === full && half ? '⯨' : '☆')}
        </span>
      ))}
      <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  );
}

function RecipeCard({ recipe, onInstall, onPreview, installed }: {
  recipe: ConnectorRecipe;
  onInstall: (r: ConnectorRecipe) => Promise<void>;
  onPreview: (r: ConnectorRecipe) => void;
  installed: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(installed);

  async function handleInstall() {
    setBusy(true);
    try {
      await onInstall(recipe);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const categoryColor = CATEGORY_COLORS[recipe.category] ?? '#6b7280';

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: 20,
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{
          background: categoryColor + '20',
          color: categoryColor,
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {CATEGORY_LABELS[recipe.category]}
        </span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>v{recipe.version}</span>
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 16, color: '#111827', marginBottom: 4 }}>{recipe.recipeName}</div>
        <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.5 }}>{recipe.description}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {recipe.connectorsConfig.map((c) => (
          <span key={c.connectorId} style={{
            background: '#f3f4f6',
            borderRadius: 6,
            padding: '2px 8px',
            fontSize: 12,
            color: '#374151',
          }}>
            {c.connectorId}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <StarRating rating={recipe.avgRating} />
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{recipe.usageCount.toLocaleString()} installs</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={() => onPreview(recipe)}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#374151',
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Preview
        </button>
        <button
          onClick={handleInstall}
          disabled={busy || done}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            background: done ? '#d1fae5' : busy ? '#d1d5db' : '#6366f1',
            color: done ? '#065f46' : busy ? '#9ca3af' : '#fff',
            fontWeight: 600,
            fontSize: 13,
            cursor: busy || done ? 'default' : 'pointer',
          }}
        >
          {done ? 'Installed' : busy ? 'Installing…' : 'Install'}
        </button>
      </div>
    </div>
  );
}

export function RecipeGallery({ recipes, onInstall, onPreview, installedIds = new Set() }: Props) {
  const [activeCategory, setActiveCategory] = useState<RecipeCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const filtered = recipes.filter((r) => {
    const matchesCategory = activeCategory === 'all' || r.category === activeCategory;
    const matchesSearch =
      search === '' ||
      r.recipeName.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.connectorsConfig.some((c) => c.connectorId.toLowerCase().includes(search.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const categories: Array<RecipeCategory | 'all'> = ['all', 'sales', 'finance', 'ops', 'engineering', 'hr', 'marketing', 'general'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            fontSize: 14,
            flex: '1 1 200px',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: activeCategory === cat ? '#6366f1' : '#d1d5db',
                background: activeCategory === cat ? '#eef2ff' : '#fff',
                color: activeCategory === cat ? '#6366f1' : '#374151',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '48px 0' }}>
          No recipes found
          {search && <span> matching &ldquo;{search}&rdquo;</span>}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onInstall={onInstall}
              onPreview={onPreview}
              installed={installedIds.has(recipe.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
