import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataExporter } from '../data-exporter.js';

// Make the mock callable as a tagged template (postgres-style) and as a regular fn
const sqlFn = Object.assign(
  vi.fn((..._args: unknown[]) => Promise.resolve([])),
  { json: (v: unknown) => v },
) as unknown as ReturnType<typeof import('postgres').default>;

describe('DataExporter', () => {
  let exporter: DataExporter;

  beforeEach(() => {
    vi.clearAllMocks();
    (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    exporter = new DataExporter(sqlFn);
  });

  afterEach(async () => {
    // Drain microtasks so background runExportJob calls complete/fail before next test
    await new Promise((r) => setTimeout(r, 0));
  });

  describe('createExportJob', () => {
    it('creates an export job and returns the job ID', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ id: 'job-uuid-123' }]) // INSERT
        .mockResolvedValue([]); // all subsequent (runExportJob background)

      const result = await exporter.createExportJob('ws-1', 'full', { includeGlossary: true });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe('job-uuid-123');
      }
    });

    it('returns err when database insert fails', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB connection refused'),
      );

      const result = await exporter.createExportJob('ws-1', 'entities');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('DB connection refused');
      }
    });
  });

  describe('getExportJob', () => {
    it('returns the job when found in correct workspace', async () => {
      const mockRow = {
        id: 'job-uuid-456',
        workspace_id: 'ws-1',
        status: 'completed',
        export_type: 'full',
        options: {},
        progress_pct: 100,
        entity_count: 42,
        result_data: null,
        error_message: null,
        created_at: new Date('2026-01-01'),
        started_at: new Date('2026-01-01'),
        completed_at: new Date('2026-01-01'),
      };
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockRow]);

      const result = await exporter.getExportJob('job-uuid-456', 'ws-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('job-uuid-456');
        expect(result.value.status).toBe('completed');
        expect(result.value.entityCount).toBe(42);
      }
    });

    it('returns err when job not found', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await exporter.getExportJob('non-existent', 'ws-1');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('not found');
      }
    });
  });

  describe('listExportJobs', () => {
    it('returns jobs with hasMore = false when under limit', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          id: 'j1', workspace_id: 'ws-1', status: 'completed', export_type: 'full',
          options: {}, progress_pct: 100, entity_count: 5, result_data: null,
          error_message: null, created_at: new Date(), started_at: null, completed_at: null,
        },
      ]);

      const result = await exporter.listExportJobs('ws-1', 50);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.jobs).toHaveLength(1);
        expect(result.value.hasMore).toBe(false);
      }
    });

    it('sets hasMore = true when result exceeds limit', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `j${i}`,
        workspace_id: 'ws-1',
        status: 'completed',
        export_type: 'entities',
        options: {},
        progress_pct: 100,
        entity_count: i,
        result_data: null,
        error_message: null,
        created_at: new Date(),
        started_at: null,
        completed_at: null,
      }));
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

      const result = await exporter.listExportJobs('ws-1', 3);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.jobs).toHaveLength(3);
        expect(result.value.hasMore).toBe(true);
      }
    });
  });

  describe('exportWorkspace', () => {
    it('returns a workspace export with all sections', async () => {
      const mockEntities = [
        {
          id: 'e1', type: 'contact', label: 'Alice',
          attributes: { email: 'alice@example.com' },
          source_id: 'hubspot:1', connector_id: 'hubspot',
          last_modified: '2026-01-01T00:00:00Z', relationships: [],
        },
      ];
      const mockGlossary = [
        { term: 'ARR', definition: 'Annual Recurring Revenue', example_value: null, status: 'approved' },
      ];
      const mockMetrics = [
        { name: 'MRR', formula: 'sum(monthly_revenue)', description: 'Monthly Recurring Revenue' },
      ];

      (sqlFn as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockEntities)   // fetchEntities
        .mockResolvedValueOnce(mockGlossary)   // fetchGlossary
        .mockResolvedValueOnce(mockMetrics)    // fetchMetrics
        .mockResolvedValueOnce([])             // fetchRelationships
        .mockResolvedValueOnce([]);            // fetchSchemaDefinitions

      const result = await exporter.exportWorkspace('ws-1', {
        includeGlossary: true,
        includeMetrics: true,
        includeRelationships: true,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const payload = result.value;
        expect(payload.version).toBe('1.0');
        expect(payload.workspaceId).toBe('ws-1');
        expect(payload.entities).toHaveLength(1);
        expect(payload.entities[0]!.label).toBe('Alice');
        expect(payload.glossaryTerms).toHaveLength(1);
        expect(payload.glossaryTerms[0]!.term).toBe('ARR');
        expect(payload.metrics).toHaveLength(1);
        expect(payload.entityCount).toBe(1);
      }
    });

    it('skips glossary and metrics when not requested', async () => {
      // With includeGlossary/Metrics/Relationships false, only fetchEntities and fetchSchemaDefinitions run
      (sqlFn as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([]) // fetchEntities
        .mockResolvedValueOnce([]); // fetchSchemaDefinitions

      const result = await exporter.exportWorkspace('ws-1', {
        includeGlossary: false,
        includeMetrics: false,
        includeRelationships: false,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.glossaryTerms).toHaveLength(0);
        expect(result.value.metrics).toHaveLength(0);
      }
    });
  });

  describe('exportEntities', () => {
    it('returns entities without type filter', async () => {
      const mockEntities = [
        {
          id: 'e2', type: 'deal', label: 'Big Deal', attributes: { amount: 50000 },
          source_id: 'sf:deal:1', connector_id: 'salesforce',
          last_modified: '2026-01-01T00:00:00Z', relationships: [],
        },
      ];
      // Without entityTypes filter, no conditional fragment call
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockEntities);

      const result = await exporter.exportEntities('ws-1', {});

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.type).toBe('deal');
        expect(result.value[0]!.label).toBe('Big Deal');
      }
    });

    it('returns empty array when no entities found', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await exporter.exportEntities('ws-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns err when database throws', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Query timeout'));

      const result = await exporter.exportEntities('ws-1');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Query timeout');
      }
    });
  });

  describe('exportSchema', () => {
    it('returns schema definitions for the workspace', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { connector_id: 'hubspot', entity_type: 'contact', fields: ['name', 'email', 'company'] },
      ]);

      const result = await exporter.exportSchema('ws-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]!.connectorId).toBe('hubspot');
        expect(result.value[0]!.fields).toContain('email');
      }
    });
  });

  describe('importWorkspace', () => {
    it('inserts entities, glossary terms, and metrics', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]); // all inserts return empty

      const backup = {
        version: '1.0' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        workspaceId: 'ws-source',
        exportType: 'full' as const,
        entities: [
          {
            id: 'e1', type: 'contact', label: 'Bob', attributes: {},
            sourceId: 'h:1', connectorId: 'hubspot',
            lastModified: '2026-01-01T00:00:00Z', relationships: [],
          },
        ],
        glossaryTerms: [
          { term: 'CAC', definition: 'Customer Acquisition Cost', exampleValue: null, status: 'approved' },
        ],
        metrics: [
          { name: 'LTV', formula: 'avg_revenue * churn', description: 'Lifetime Value' },
        ],
        relationships: [],
        schemaDefinitions: [],
        entityCount: 1,
      };

      const result = await exporter.importWorkspace(backup, 'ws-target');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.importedEntities).toBe(1);
        expect(result.value.importedTerms).toBe(1);
        expect(result.value.importedMetrics).toBe(1);
      }
    });

    it('returns err when import entity fails', async () => {
      (sqlFn as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Constraint violation'),
      );

      const backup = {
        version: '1.0' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        workspaceId: 'ws-source',
        exportType: 'full' as const,
        entities: [
          {
            id: 'e1', type: 'contact', label: 'Alice', attributes: {},
            sourceId: 'h:1', connectorId: 'hubspot',
            lastModified: '2026-01-01T00:00:00Z', relationships: [],
          },
        ],
        glossaryTerms: [],
        metrics: [],
        relationships: [],
        schemaDefinitions: [],
        entityCount: 1,
      };

      const result = await exporter.importWorkspace(backup, 'ws-target');

      expect(result.isErr()).toBe(true);
    });

    it('handles empty backup gracefully', async () => {
      const backup = {
        version: '1.0' as const,
        exportedAt: '2026-01-01T00:00:00Z',
        workspaceId: 'ws-source',
        exportType: 'full' as const,
        entities: [],
        glossaryTerms: [],
        metrics: [],
        relationships: [],
        schemaDefinitions: [],
        entityCount: 0,
      };

      const result = await exporter.importWorkspace(backup, 'ws-target');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.importedEntities).toBe(0);
        expect(result.value.importedTerms).toBe(0);
        expect(result.value.importedMetrics).toBe(0);
      }
    });
  });
});
