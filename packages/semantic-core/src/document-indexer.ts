import crypto from 'node:crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'document-indexer' });

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  sourceConnectorId: string;
  sourceEntityId: string;
  documentTitle: string;
  contentPlaintext: string;
  contentHash: string;
  extractedAt: Date;
  tokenEstimate: number;
}

export interface DocumentExcerpt {
  documentId: string;
  sourceEntityId: string;
  documentTitle: string;
  excerpt: string;
  score: number;
}

export interface DocumentIndexerConfig {
  /** Maximum characters per document before truncating (default: 50_000) */
  maxContentLength: number;
  /** Maximum tokens budgeted per document for embedding (default: 512) */
  maxTokensPerDocument: number;
}

const DEFAULT_CONFIG: DocumentIndexerConfig = {
  maxContentLength: 50_000,
  maxTokensPerDocument: 512,
};

type SqlClient = ReturnType<typeof postgres>;

/**
 * Extracts and indexes full-text content from document-based connector sources.
 * Stores documents in the `indexed_documents` table for hybrid retrieval.
 */
export class DocumentIndexer {
  private readonly sql: SqlClient;
  private readonly config: DocumentIndexerConfig;

  /**
   * @param sql    - Postgres client
   * @param config - Optional tuning configuration
   */
  constructor(sql: SqlClient, config: Partial<DocumentIndexerConfig> = {}) {
    this.sql = sql;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract plain text from a PDF buffer using pdfjs-dist (loaded dynamically).
   *
   * @param buffer - Raw PDF bytes
   * @returns Extracted plain text, or null if extraction fails
   */
  async extractTextFromPDF(buffer: Buffer): Promise<string | null> {
    try {
      // Dynamic import keeps pdfjs-dist optional — falls back gracefully when absent
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs' as string) as {
        getDocument: (data: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str: string }> }> }> }> };
      };
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      const parts: string[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((item) => item.str).join(' '));
      }
      return parts.join('\n').replace(/\s+/g, ' ').trim();
    } catch (e) {
      log.warn('PDF extraction failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /**
   * Extract plain text from a DOCX buffer using docx library (loaded dynamically).
   *
   * @param buffer - Raw DOCX bytes
   * @returns Extracted plain text, or null if extraction fails
   */
  async extractTextFromDocx(buffer: Buffer): Promise<string | null> {
    try {
      const mammoth = await import('mammoth' as string) as {
        extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      const result = await mammoth.extractRawText({ buffer });
      return result.value.replace(/\s+/g, ' ').trim();
    } catch (e) {
      log.warn('DOCX extraction failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  /**
   * Extract plain text from a plain-text buffer (markdown, txt, README).
   *
   * @param buffer   - Raw text bytes
   * @param encoding - Character encoding (default: utf-8)
   * @returns Decoded string
   */
  extractTextFromPlainText(buffer: Buffer, encoding: BufferEncoding = 'utf-8'): string {
    return buffer.toString(encoding).replace(/\s+/g, ' ').trim();
  }

  /**
   * Upsert a document into the `indexed_documents` table.
   * Skips the write when the content hash matches what is already stored.
   *
   * @param doc - Document record to persist
   * @returns True when a new/changed document was written, false when unchanged
   */
  async indexDocument(doc: Omit<DocumentRecord, 'id' | 'extractedAt' | 'contentHash' | 'tokenEstimate'>): Promise<boolean> {
    const truncated = doc.contentPlaintext.slice(0, this.config.maxContentLength);
    const contentHash = crypto.createHash('sha256').update(truncated).digest('hex');
    const tokenEstimate = Math.ceil(truncated.length / 4);

    const existing = await this.sql<[{ content_hash: string }?]>`
      SELECT content_hash FROM indexed_documents
      WHERE workspace_id = ${doc.workspaceId}
        AND source_entity_id = ${doc.sourceEntityId}
      LIMIT 1
    `;

    if (existing[0]?.content_hash === contentHash) {
      log.debug('Document unchanged, skipping index', { entityId: doc.sourceEntityId });
      return false;
    }

    await this.sql`
      INSERT INTO indexed_documents
        (workspace_id, source_connector_id, source_entity_id, document_title, content_plaintext, content_hash, token_estimate, extracted_at)
      VALUES
        (${doc.workspaceId}, ${doc.sourceConnectorId}, ${doc.sourceEntityId}, ${doc.documentTitle}, ${truncated}, ${contentHash}, ${tokenEstimate}, now())
      ON CONFLICT (workspace_id, source_entity_id)
      DO UPDATE SET
        document_title       = EXCLUDED.document_title,
        content_plaintext    = EXCLUDED.content_plaintext,
        content_hash         = EXCLUDED.content_hash,
        token_estimate       = EXCLUDED.token_estimate,
        extracted_at         = now()
    `;

    if (tokenEstimate > this.config.maxTokensPerDocument * 4) {
      log.warn('Document token budget exceeded', {
        entityId: doc.sourceEntityId,
        tokenEstimate,
        budget: this.config.maxTokensPerDocument,
      });
    }

    log.info('Document indexed', { entityId: doc.sourceEntityId, tokenEstimate });
    return true;
  }

  /**
   * Search indexed documents by keyword within a workspace.
   * Returns excerpts highlighting the match context (±150 chars).
   *
   * @param workspaceId - Tenant isolation key
   * @param query       - Search keywords
   * @param limit       - Maximum results (default: 10)
   */
  async searchDocuments(workspaceId: string, query: string, limit = 10): Promise<DocumentExcerpt[]> {
    const rows = await this.sql<Array<{ id: string; source_entity_id: string; document_title: string; content_plaintext: string; rank: number }>>`
      SELECT
        id,
        source_entity_id,
        document_title,
        content_plaintext,
        ts_rank(to_tsvector('english', content_plaintext), plainto_tsquery('english', ${query})) AS rank
      FROM indexed_documents
      WHERE workspace_id = ${workspaceId}
        AND to_tsvector('english', content_plaintext) @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return (rows as Record<string, unknown>[]).map((row) => ({
      documentId: row['id'] as string,
      sourceEntityId: row['source_entity_id'] as string,
      documentTitle: row['document_title'] as string,
      excerpt: extractExcerpt(row['content_plaintext'] as string, query),
      score: row['rank'] as number,
    }));
  }

  /**
   * Delete all indexed documents for a given connector instance (e.g., on connector removal).
   *
   * @param workspaceId       - Workspace to scope the deletion
   * @param sourceConnectorId - Connector instance whose documents should be removed
   * @returns Count of deleted rows
   */
  async deleteByConnector(workspaceId: string, sourceConnectorId: string): Promise<number> {
    const result = await this.sql`
      DELETE FROM indexed_documents
      WHERE workspace_id = ${workspaceId} AND source_connector_id = ${sourceConnectorId}
      RETURNING id
    `;
    return result.length;
  }

  /**
   * Returns per-connector document stats for the given workspace.
   *
   * @param workspaceId - Workspace to query
   */
  async getIndexingStats(workspaceId: string): Promise<Array<{ sourceConnectorId: string; documentCount: number; totalTokens: number; lastExtractedAt: string | null }>> {
    const rows = await this.sql<Array<{ source_connector_id: string; document_count: string; total_tokens: string; last_extracted_at: string | null }>>`
      SELECT
        source_connector_id,
        COUNT(*)::text            AS document_count,
        SUM(token_estimate)::text AS total_tokens,
        MAX(extracted_at)::text   AS last_extracted_at
      FROM indexed_documents
      WHERE workspace_id = ${workspaceId}
      GROUP BY source_connector_id
      ORDER BY COUNT(*) DESC
    `;

    return (rows as Record<string, unknown>[]).map((r) => ({
      sourceConnectorId: r['source_connector_id'] as string,
      documentCount: parseInt(r['document_count'] as string, 10),
      totalTokens: parseInt(r['total_tokens'] as string, 10),
      lastExtractedAt: r['last_extracted_at'] as string | null,
    }));
  }
}

/** Extract a ±150-char excerpt around the first query keyword match. */
function extractExcerpt(content: string, query: string): string {
  const keyword = query.split(/\s+/)[0] ?? '';
  const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return content.slice(0, 300);
  const start = Math.max(0, idx - 150);
  const end = Math.min(content.length, idx + keyword.length + 150);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}
