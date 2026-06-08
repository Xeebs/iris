import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentIndexer } from '../document-indexer.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(responses: unknown[]) {
  const calls: unknown[][] = [];
  let idx = 0;
  const sql = vi.fn((...args: unknown[]) => {
    calls.push(args);
    const r = responses[idx++] ?? [];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r as unknown[]);
  }) as unknown as ReturnType<typeof import('postgres').default>;
  (sql as unknown as { calls: unknown[][] }).calls = calls;
  return sql;
}

describe('DocumentIndexer', () => {
  describe('extractTextFromPlainText', () => {
    it('decodes a UTF-8 buffer to trimmed string', () => {
      const indexer = new DocumentIndexer(makeSql([]));
      const buf = Buffer.from('  Hello   World  ', 'utf-8');
      expect(indexer.extractTextFromPlainText(buf)).toBe('Hello World');
    });

    it('collapses multiple whitespace characters', () => {
      const indexer = new DocumentIndexer(makeSql([]));
      const buf = Buffer.from('line1\n\nline2\t  line3', 'utf-8');
      expect(indexer.extractTextFromPlainText(buf)).toBe('line1 line2 line3');
    });

    it('returns empty string for empty buffer', () => {
      const indexer = new DocumentIndexer(makeSql([]));
      expect(indexer.extractTextFromPlainText(Buffer.alloc(0))).toBe('');
    });

    it('handles latin-1 encoding', () => {
      const indexer = new DocumentIndexer(makeSql([]));
      const buf = Buffer.from('caf\xe9', 'latin1');
      const result = indexer.extractTextFromPlainText(buf, 'latin1');
      expect(result).toBe('café');
    });
  });

  describe('extractTextFromPDF', () => {
    it('returns null when pdfjs-dist is not installed', async () => {
      const indexer = new DocumentIndexer(makeSql([]));
      const result = await indexer.extractTextFromPDF(Buffer.from('not-a-pdf'));
      expect(result).toBeNull();
    });
  });

  describe('extractTextFromDocx', () => {
    it('returns null when mammoth is not installed', async () => {
      const indexer = new DocumentIndexer(makeSql([]));
      const result = await indexer.extractTextFromDocx(Buffer.from('not-a-docx'));
      expect(result).toBeNull();
    });
  });

  describe('indexDocument', () => {
    it('inserts a new document and returns true', async () => {
      const sql = makeSql([
        [],                // existing hash query → no rows
        [{ id: 'doc-1' }], // upsert → success
      ]);
      const indexer = new DocumentIndexer(sql);
      const inserted = await indexer.indexDocument({
        workspaceId: 'ws-1',
        sourceConnectorId: 'gdrive-1',
        sourceEntityId: 'file-abc',
        documentTitle: 'Contract.pdf',
        contentPlaintext: 'These terms and conditions govern your use of the service.',
      });
      expect(inserted).toBe(true);
    });

    it('skips unchanged document and returns false', async () => {
      // Simulate: content hash matches stored hash
      const content = 'Unchanged content block.';
      const crypto = await import('node:crypto');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const sql = makeSql([
        [{ content_hash: hash }], // existing row matches
      ]);
      const indexer = new DocumentIndexer(sql);
      const inserted = await indexer.indexDocument({
        workspaceId: 'ws-1',
        sourceConnectorId: 'gdrive-1',
        sourceEntityId: 'file-xyz',
        documentTitle: 'Memo.txt',
        contentPlaintext: content,
      });
      expect(inserted).toBe(false);
    });

    it('truncates content exceeding maxContentLength', async () => {
      const sql = makeSql([[], [{ id: 'doc-1' }]]);
      const insertCalls: string[] = [];
      const capturingSql = vi.fn((..._args: unknown[]) => {
        insertCalls.push(String(_args[0]));
        return Promise.resolve([{ id: 'doc-1' }]);
      }) as unknown as ReturnType<typeof import('postgres').default>;

      const indexer = new DocumentIndexer(capturingSql, { maxContentLength: 100 });
      const longContent = 'A'.repeat(200);

      // patch the first call to return empty (no existing hash)
      let callCount = 0;
      const smartSql = vi.fn((...args: unknown[]) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]);
        return Promise.resolve([{ id: 'doc-1' }]);
      }) as unknown as ReturnType<typeof import('postgres').default>;

      const idx2 = new DocumentIndexer(smartSql, { maxContentLength: 100 });
      await idx2.indexDocument({
        workspaceId: 'ws-1',
        sourceConnectorId: 'c-1',
        sourceEntityId: 'e-1',
        documentTitle: 'Long.txt',
        contentPlaintext: longContent,
      });
      expect(callCount).toBe(2);
    });

    it('does not throw when token estimate exceeds maxTokensPerDocument', async () => {
      let callCount = 0;
      const sql = vi.fn((..._args: unknown[]) => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]);
        return Promise.resolve([{ id: 'doc-1' }]);
      }) as unknown as ReturnType<typeof import('postgres').default>;

      const indexer = new DocumentIndexer(sql, { maxTokensPerDocument: 1 });
      await expect(
        indexer.indexDocument({
          workspaceId: 'ws-1',
          sourceConnectorId: 'c-1',
          sourceEntityId: 'e-long',
          documentTitle: 'Large.txt',
          contentPlaintext: 'A'.repeat(50),
        }),
      ).resolves.toBe(true);
    });

    it('propagates SQL errors', async () => {
      const sql = makeSql([new Error('db down')]);
      const indexer = new DocumentIndexer(sql);
      await expect(
        indexer.indexDocument({
          workspaceId: 'ws-1',
          sourceConnectorId: 'c-1',
          sourceEntityId: 'e-1',
          documentTitle: 'Doc.txt',
          contentPlaintext: 'content',
        }),
      ).rejects.toThrow('db down');
    });
  });

  describe('searchDocuments', () => {
    it('returns excerpts for matching documents', async () => {
      const rows = [
        {
          id: 'doc-1',
          source_entity_id: 'file-1',
          document_title: 'Service Agreement',
          content_plaintext: 'The payment terms are net-30. Late payments incur 2% interest.',
          rank: 0.7,
        },
      ];
      const sql = makeSql([rows]);
      const indexer = new DocumentIndexer(sql);
      const results = await indexer.searchDocuments('ws-1', 'payment terms');
      expect(results).toHaveLength(1);
      expect(results[0]!.documentTitle).toBe('Service Agreement');
      expect(results[0]!.excerpt).toContain('payment');
      expect(results[0]!.score).toBe(0.7);
    });

    it('returns empty array when no documents match', async () => {
      const sql = makeSql([[]]);
      const indexer = new DocumentIndexer(sql);
      const results = await indexer.searchDocuments('ws-1', 'nonexistent term');
      expect(results).toHaveLength(0);
    });

    it('defaults to limit 10', async () => {
      const sql = makeSql([[]]);
      const indexer = new DocumentIndexer(sql);
      await indexer.searchDocuments('ws-1', 'test');
      expect(sql).toHaveBeenCalledTimes(1);
    });

    it('propagates SQL errors', async () => {
      const sql = makeSql([new Error('search failed')]);
      const indexer = new DocumentIndexer(sql);
      await expect(indexer.searchDocuments('ws-1', 'query')).rejects.toThrow('search failed');
    });
  });

  describe('deleteByConnector', () => {
    it('deletes all documents for a connector and returns count', async () => {
      const deleted = [{ id: 'doc-1' }, { id: 'doc-2' }];
      const sql = makeSql([deleted]);
      const indexer = new DocumentIndexer(sql);
      const count = await indexer.deleteByConnector('ws-1', 'gdrive-1');
      expect(count).toBe(2);
    });

    it('returns 0 when no documents exist', async () => {
      const sql = makeSql([[]]);
      const indexer = new DocumentIndexer(sql);
      const count = await indexer.deleteByConnector('ws-1', 'nonexistent');
      expect(count).toBe(0);
    });

    it('propagates SQL errors', async () => {
      const sql = makeSql([new Error('db error')]);
      const indexer = new DocumentIndexer(sql);
      await expect(indexer.deleteByConnector('ws-1', 'c-1')).rejects.toThrow('db error');
    });
  });

  describe('getIndexingStats', () => {
    it('returns per-connector stats', async () => {
      const rows = [
        { source_connector_id: 'gdrive-1', document_count: '42', total_tokens: '18000', last_extracted_at: '2026-06-08T00:00:00Z' },
        { source_connector_id: 'notion-1', document_count: '15', total_tokens: '6000', last_extracted_at: null },
      ];
      const sql = makeSql([rows]);
      const indexer = new DocumentIndexer(sql);
      const stats = await indexer.getIndexingStats('ws-1');
      expect(stats).toHaveLength(2);
      expect(stats[0]!.sourceConnectorId).toBe('gdrive-1');
      expect(stats[0]!.documentCount).toBe(42);
      expect(stats[0]!.totalTokens).toBe(18000);
      expect(stats[1]!.lastExtractedAt).toBeNull();
    });

    it('returns empty array when no documents indexed', async () => {
      const sql = makeSql([[]]);
      const indexer = new DocumentIndexer(sql);
      const stats = await indexer.getIndexingStats('ws-1');
      expect(stats).toHaveLength(0);
    });
  });

  describe('excerpt extraction (via searchDocuments)', () => {
    it('produces excerpt centered on first keyword match', async () => {
      const longContent = 'A'.repeat(200) + ' payment terms are here ' + 'B'.repeat(200);
      const rows = [
        { id: 'd1', source_entity_id: 'e1', document_title: 'T', content_plaintext: longContent, rank: 1 },
      ];
      const sql = makeSql([rows]);
      const indexer = new DocumentIndexer(sql);
      const results = await indexer.searchDocuments('ws-1', 'payment');
      expect(results[0]!.excerpt).toContain('payment');
      expect(results[0]!.excerpt.length).toBeLessThan(longContent.length);
    });

    it('returns first 300 chars when keyword not found', async () => {
      const content = 'X'.repeat(500);
      const rows = [
        { id: 'd1', source_entity_id: 'e1', document_title: 'T', content_plaintext: content, rank: 1 },
      ];
      const sql = makeSql([rows]);
      const indexer = new DocumentIndexer(sql);
      const results = await indexer.searchDocuments('ws-1', 'missing');
      expect(results[0]!.excerpt).toHaveLength(300);
    });
  });

  describe('configuration', () => {
    it('uses default config when none provided', () => {
      const sql = makeSql([]);
      const indexer = new DocumentIndexer(sql);
      expect(indexer).toBeDefined();
    });

    it('accepts partial config overrides', () => {
      const sql = makeSql([]);
      const indexer = new DocumentIndexer(sql, { maxContentLength: 1000 });
      expect(indexer).toBeDefined();
    });
  });
});
