import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { SdkCodeGenerator } from '@iris/semantic-core/sdk-generator';
import type { SupportedLanguage, ToolSchema } from '@iris/semantic-core/sdk-generator';
import { logger } from '@iris/core/logger';

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['typescript', 'python', 'go'];

const GenerateSdkSchema = z.object({
  workspaceId: z.string().min(1).default('default'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.1.0'),
});

const BUILT_IN_TOOLS: ToolSchema[] = [
  {
    name: 'query-context',
    description: 'Query the semantic context index for relevant business data.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        contextBudget: { type: 'integer' },
        connectorIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
    },
  },
  {
    name: 'list-entities',
    description: 'List semantic entities of a specific type from connected data sources.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        connectorId: { type: 'string' },
        limit: { type: 'integer' },
        cursor: { type: 'string' },
      },
      required: ['entityType'],
    },
  },
  {
    name: 'get-metric',
    description: 'Retrieve a named business metric value with its definition.',
    inputSchema: {
      type: 'object',
      properties: {
        metricName: { type: 'string' },
        workspaceId: { type: 'string' },
      },
      required: ['metricName'],
    },
  },
  {
    name: 'search-entities',
    description: 'Semantic search across all indexed entities with similarity ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        entityTypes: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer' },
        threshold: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get-entity',
    description: 'Retrieve a specific entity by ID from the semantic index.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        includeRelationships: { type: 'boolean' },
      },
      required: ['entityId'],
    },
  },
];

type JobRow = {
  job_id: string;
  workspace_id: string;
  language: string;
  status: string;
  tool_count: number | null;
  download_url: string | null;
  error_message: string | null;
  sdk_version: string;
  created_at: Date;
  completed_at: Date | null;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for SDK download management
 */
export function createSdkDownloadsRoutes(sql: Sql) {
  const app = new Hono();
  const generator = new SdkCodeGenerator();

  // GET /sdks/languages — list supported languages
  app.get('/languages', (c) => {
    return c.json({
      data: SUPPORTED_LANGUAGES.map((lang) => ({
        language: lang,
        label: lang === 'typescript' ? 'TypeScript' : lang === 'python' ? 'Python' : 'Go',
        extension: lang === 'typescript' ? '.ts' : lang === 'python' ? '.py' : '.go',
        packageManager: lang === 'typescript' ? 'npm/pnpm' : lang === 'python' ? 'pip' : 'go get',
      })),
    });
  });

  // GET /sdks/tools — list available tools and their schemas
  app.get('/tools', (c) => {
    return c.json({
      data: BUILT_IN_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // POST /sdks/generate/:language — generate SDK and persist job
  app.post('/generate/:language', zValidator('json', GenerateSdkSchema), async (c) => {
    const language = c.req.param('language') as SupportedLanguage;
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return c.json({ error: { code: 'UNSUPPORTED_LANGUAGE', message: `Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` } }, 400);
    }

    const { workspaceId, version } = c.req.valid('json');

    try {
      const jobRows = await sql`
        INSERT INTO sdk_generation_jobs (workspace_id, language, status, sdk_version)
        VALUES (${workspaceId}, ${language}, 'generating', ${version})
        RETURNING job_id, created_at
      ` as Array<{ job_id: string; created_at: Date }>;

      const jobId = jobRows[0]!.job_id;

      try {
        const library = generator.generateClientLibrary(BUILT_IN_TOOLS, language, version);
        const docs = generator.outputDocs(BUILT_IN_TOOLS);

        // In a real system, this would write to object storage and return a pre-signed URL.
        // Here we inline the generated code as the "download" artifact.
        const downloadUrl = `/api/v1/sdks/artifacts/${jobId}`;

        await sql`
          UPDATE sdk_generation_jobs
          SET status = 'complete',
              tool_count = ${BUILT_IN_TOOLS.length},
              download_url = ${downloadUrl},
              completed_at = NOW()
          WHERE job_id = ${jobId}
        `;

        logger.info('SDK generation complete', { jobId, language, toolCount: library.methods.length });

        return c.json({
          data: {
            jobId,
            language,
            status: 'complete',
            downloadUrl,
            toolCount: library.methods.length,
            methods: library.methods,
            docsSummary: `${docs.methods.length} methods documented`,
          },
        }, 201);
      } catch (genErr) {
        await sql`
          UPDATE sdk_generation_jobs
          SET status = 'failed', error_message = ${genErr instanceof Error ? genErr.message : 'Generation error'}
          WHERE job_id = ${jobId}
        `;
        throw genErr;
      }
    } catch (err) {
      logger.error('SDK generation failed', { language, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'GENERATION_FAILED', message: 'SDK generation failed' } }, 500);
    }
  });

  // GET /sdks/jobs/:jobId/status — poll job status
  app.get('/jobs/:jobId/status', async (c) => {
    const jobId = c.req.param('jobId');
    try {
      const rows = await sql`
        SELECT job_id, workspace_id, language, status, tool_count, download_url,
               error_message, sdk_version, created_at, completed_at
        FROM sdk_generation_jobs
        WHERE job_id = ${jobId}
      ` as JobRow[];

      if (rows.length === 0) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404);
      }

      const job = rows[0]!;
      return c.json({
        data: {
          jobId: job.job_id,
          language: job.language,
          status: job.status,
          toolCount: job.tool_count,
          downloadUrl: job.download_url,
          errorMessage: job.error_message,
          sdkVersion: job.sdk_version,
          createdAt: job.created_at,
          completedAt: job.completed_at,
        },
      });
    } catch (err) {
      logger.error('Failed to fetch job status', { jobId, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch job status' } }, 500);
    }
  });

  // GET /sdks/jobs — list all SDK generation jobs for a workspace
  app.get('/jobs', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    try {
      const rows = await sql`
        SELECT job_id, language, status, tool_count, sdk_version, created_at, completed_at
        FROM sdk_generation_jobs
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT 50
      ` as JobRow[];

      return c.json({
        data: rows.map((r) => ({
          jobId: r.job_id,
          language: r.language,
          status: r.status,
          toolCount: r.tool_count,
          sdkVersion: r.sdk_version,
          createdAt: r.created_at,
          completedAt: r.completed_at,
        })),
      });
    } catch (err) {
      logger.error('Failed to fetch SDK jobs', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch jobs' } }, 500);
    }
  });

  // GET /sdks/preview/:language — generate and return code inline (no persistence)
  app.get('/preview/:language', async (c) => {
    const language = c.req.param('language') as SupportedLanguage;
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return c.json({ error: { code: 'UNSUPPORTED_LANGUAGE', message: `Language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` } }, 400);
    }

    try {
      const library = generator.generateClientLibrary(BUILT_IN_TOOLS, language);
      const docs = generator.outputDocs(BUILT_IN_TOOLS);

      return c.json({
        data: {
          language,
          code: library.code,
          methods: library.methods,
          docsMarkdown: docs.markdown,
        },
      });
    } catch (err) {
      logger.error('SDK preview failed', { language, error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'PREVIEW_FAILED', message: 'Failed to generate preview' } }, 500);
    }
  });

  return app;
}
