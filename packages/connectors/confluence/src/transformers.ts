import type { SemanticEntity } from '@iris/connector-sdk';

// ─── Raw Confluence API types ─────────────────────────────────────────────────

export type ConfluenceSpace = {
  id: string;
  key: string;
  name: string;
  type: string;
  description?: {
    plain?: { value: string };
  };
  homepage?: { id: string };
};

export type ConfluenceLabel = {
  prefix: string;
  name: string;
};

export type ConfluenceVersion = {
  number: number;
  by?: { accountId: string; displayName: string };
  when: string;
};

export type ConfluenceAncestor = {
  id: string;
  title: string;
};

export type ConfluencePage = {
  id: string;
  title: string;
  type: string;
  space: { key: string; id: string };
  version: ConfluenceVersion;
  ancestors: ConfluenceAncestor[];
  metadata?: {
    labels?: {
      results: ConfluenceLabel[];
    };
  };
  _links?: { self: string };
};

// ─── Transformers ─────────────────────────────────────────────────────────────

/**
 * Transform a Confluence space to a SemanticEntity.
 *
 * @param space - Raw Confluence space object
 * @returns Compact SemanticEntity suitable for embedding and retrieval
 */
export function transformSpace(space: ConfluenceSpace): SemanticEntity {
  return {
    id: `confluence:space:${space.id}`,
    type: 'space',
    label: `${space.name} (${space.key})`,
    attributes: {
      key: space.key,
      spaceType: space.type,
      description: space.description?.plain?.value ?? null,
    },
    relationships: [],
    lastModified: new Date(),
    sourceId: `confluence:space:${space.id}`,
  };
}

/**
 * Transform a Confluence page to a SemanticEntity.
 * Builds parent relationship from ancestors array and extracts label metadata.
 *
 * @param page - Raw Confluence page object
 * @returns Compact SemanticEntity
 */
export function transformPage(page: ConfluencePage): SemanticEntity {
  const relationships: SemanticEntity['relationships'] = [
    { type: 'belongs_to', targetId: `confluence:space:${page.space.id}` },
  ];

  const directParent = page.ancestors.at(-1);
  if (directParent) {
    relationships.push({ type: 'child_of', targetId: `confluence:page:${directParent.id}` });
  }

  const labelResults = page.metadata?.labels?.results ?? [];
  const labels = labelResults.length ? labelResults.map((l) => l.name).join(', ') : null;
  const author = page.version.by?.displayName ?? null;

  return {
    id: `confluence:page:${page.id}`,
    type: 'page',
    label: page.title,
    attributes: {
      space: page.space.key,
      author,
      labels,
      version: page.version.number,
    },
    relationships,
    lastModified: new Date(page.version.when),
    sourceId: `confluence:page:${page.id}`,
  };
}
