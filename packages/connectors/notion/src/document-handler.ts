import { logger } from '@iris/core/logger';

const log = logger.child({ connector: 'notion', handler: 'document' });

export interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

export interface NotionPage {
  entityId: string;
  title: string;
  blocks: NotionBlock[];
}

export interface ExtractedDocument {
  entityId: string;
  title: string;
  contentPlaintext: string;
}

interface RichTextItem {
  plain_text: string;
}

type BlockContent = {
  rich_text?: RichTextItem[];
  caption?: RichTextItem[];
  content?: string;
  expression?: string;
  checked?: boolean;
  color?: string;
};

/**
 * Recursively extract plain text from a Notion block's rich_text array.
 *
 * @param richTextItems - Array of Notion rich_text items
 */
function richTextToString(richTextItems: RichTextItem[]): string {
  return richTextItems.map((t) => t.plain_text).join('');
}

/**
 * Convert a single Notion block to its plain-text representation.
 * Handles all common Notion block types including paragraphs, headings, lists, code, and tables.
 *
 * @param block - Notion block object
 */
export function blockToText(block: NotionBlock): string {
  const content = block[block.type] as BlockContent | undefined;
  if (!content) return '';

  switch (block.type) {
    case 'paragraph':
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'quote':
    case 'callout':
    case 'toggle':
      return richTextToString(content.rich_text ?? []);

    case 'bulleted_list_item':
    case 'numbered_list_item':
      return `- ${richTextToString(content.rich_text ?? [])}`;

    case 'to_do': {
      const prefix = content.checked ? '[x]' : '[ ]';
      return `${prefix} ${richTextToString(content.rich_text ?? [])}`;
    }

    case 'code':
      return richTextToString(content.rich_text ?? []);

    case 'image':
    case 'file':
    case 'pdf':
      return richTextToString(content.caption ?? []);

    case 'equation':
      return content.expression ?? '';

    case 'divider':
      return '---';

    case 'table_row': {
      const cells = (content as unknown as { cells: RichTextItem[][] }).cells ?? [];
      return cells.map((cell) => richTextToString(cell)).join(' | ');
    }

    default:
      return '';
  }
}

/**
 * Extract plain text from a Notion page's blocks array.
 * Returns null when the page has no readable content.
 *
 * @param page - Notion page with title and blocks
 */
export function extractNotionPageContent(page: NotionPage): ExtractedDocument | null {
  try {
    const lines = page.blocks
      .map(blockToText)
      .filter((t) => t.length > 0);

    if (lines.length === 0) {
      log.debug('Notion page has no extractable blocks', { entityId: page.entityId });
      return null;
    }

    return {
      entityId: page.entityId,
      title: page.title,
      contentPlaintext: lines.join('\n').replace(/\s+/g, ' ').trim(),
    };
  } catch (e) {
    log.error('Notion document extraction failed', {
      entityId: page.entityId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
