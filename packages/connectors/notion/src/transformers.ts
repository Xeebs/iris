import type { SemanticEntity, AttributeValue } from '@iris/connector-sdk';

export type NotionRichText = { type: 'text'; text: { content: string } };
export type NotionTitle = { type: 'title'; title: NotionRichText[] };
export type NotionPropertyValue =
  | { type: 'title'; title: NotionRichText[] }
  | { type: 'rich_text'; rich_text: NotionRichText[] }
  | { type: 'number'; number: number | null }
  | { type: 'select'; select: { name: string } | null }
  | { type: 'multi_select'; multi_select: { name: string }[] }
  | { type: 'date'; date: { start: string } | null }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'url'; url: string | null }
  | { type: 'email'; email: string | null }
  | { type: 'phone_number'; phone_number: string | null }
  | { type: 'people'; people: { name: string }[] }
  | { type: string };

export interface NotionPage {
  id: string;
  object: 'page';
  url: string;
  last_edited_time: string;
  parent?: { type: string; database_id?: string };
  properties: Record<string, NotionPropertyValue>;
}

export interface NotionDatabase {
  id: string;
  object: 'database';
  url: string;
  last_edited_time: string;
  title: NotionRichText[];
  properties: Record<string, { type: string; name: string }>;
}

function extractRichText(arr: NotionRichText[]): string {
  return arr.map((r) => r.text.content).join('');
}

function extractPropertyValue(prop: NotionPropertyValue): AttributeValue {
  switch (prop.type) {
    case 'title':
      return extractRichText((prop as { type: 'title'; title: NotionRichText[] }).title) || null;
    case 'rich_text': {
      const text = extractRichText((prop as { type: 'rich_text'; rich_text: NotionRichText[] }).rich_text);
      return text || null;
    }
    case 'number':
      return (prop as { type: 'number'; number: number | null }).number;
    case 'select': {
      const sel = (prop as { type: 'select'; select: { name: string } | null }).select;
      return sel?.name ?? null;
    }
    case 'multi_select':
      return (prop as { type: 'multi_select'; multi_select: { name: string }[] }).multi_select.map(
        (s) => s.name,
      );
    case 'date': {
      const d = (prop as { type: 'date'; date: { start: string } | null }).date;
      return d?.start ?? null;
    }
    case 'checkbox':
      return (prop as { type: 'checkbox'; checkbox: boolean }).checkbox;
    case 'url':
      return (prop as { type: 'url'; url: string | null }).url;
    case 'email':
      return null; // PII — do not embed
    case 'phone_number':
      return null; // PII — do not embed
    case 'people':
      return (prop as { type: 'people'; people: { name: string }[] }).people.map((p) => p.name);
    default:
      return null;
  }
}

/** Transform a Notion page or database row into a SemanticEntity. */
export function transformPage(page: NotionPage): SemanticEntity {
  const titleProp = Object.values(page.properties).find((p) => p.type === 'title');
  const title = titleProp
    ? extractRichText((titleProp as { type: 'title'; title: NotionRichText[] }).title)
    : `Page ${page.id.slice(0, 8)}`;

  const attributes: Record<string, AttributeValue> = {};
  for (const [name, prop] of Object.entries(page.properties)) {
    if (prop.type === 'title') continue; // already in label
    if (prop.type === 'email' || prop.type === 'phone_number') continue; // PII
    const val = extractPropertyValue(prop);
    if (val !== null) {
      attributes[name] = val;
    }
  }

  const isDbRow = page.parent?.type === 'database_id';

  return {
    id: `notion:${isDbRow ? 'database_row' : 'page'}:${page.id}`,
    type: isDbRow ? 'database_row' : 'page',
    label: title || `Notion Page ${page.id.slice(0, 8)}`,
    attributes,
    relationships: page.parent?.database_id
      ? [{ type: 'belongs_to', targetId: `notion:database:${page.parent.database_id}` }]
      : [],
    lastModified: new Date(page.last_edited_time),
    sourceId: `notion:page:${page.id}`,
  };
}
