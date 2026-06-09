import { z } from 'zod';
import type { Sql } from 'postgres';
import { NlQueryGenerator } from '@iris/semantic-core/nl-query-generator';
import { logger } from '@iris/core/logger';

const InputSchema = z.object({
  question: z.string().min(1).describe('The business question in plain English'),
  workspaceId: z.string().min(1).describe('Workspace to query against'),
  contextBudget: z.number().int().positive().default(2000).describe('Token budget for the result'),
});

export type GenerateQueryFromQuestionInput = z.infer<typeof InputSchema>;

/**
 * MCP tool that converts a natural language business question into a context query plan.
 * @param sql - Postgres client
 * @returns MCP tool definition
 */
export function createGenerateQueryFromQuestionTool(sql: Sql) {
  const generator = new NlQueryGenerator(sql);

  return {
    name: 'generate-query-from-question',
    description:
      'Converts a natural language business question (e.g. "Which deals are at risk of closing this quarter?") into a structured context query plan. Returns the intent classification, recommended query plan, and follow-up suggestions.',
    inputSchema: InputSchema,
    handler: async (input: GenerateQueryFromQuestionInput) => {
      const parsed = InputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Invalid input', details: parsed.error.flatten() }),
          }],
        };
      }

      try {
        const session = await generator.processNaturalLanguageQuery(
          parsed.data.question,
          parsed.data.workspaceId,
          parsed.data.contextBudget
        );

        const lines = [
          `**Question**: ${session.question}`,
          `**Intent**: ${session.intent.type} (confidence: ${(session.intent.confidence * 100).toFixed(0)}%)`,
          `**Entity Types**: ${session.intent.entityTypes.join(', ')}`,
          '',
          `**Query Plan**:`,
          `- Type: ${session.queryPlan.intentType}`,
          `- Entities: ${session.queryPlan.entityTypes.join(', ')}`,
          `- Limit: ${session.queryPlan.limit}`,
          session.queryPlan.aggregations.length > 0
            ? `- Aggregations: ${session.queryPlan.aggregations.join(', ')}`
            : null,
          `- ${session.queryPlan.explanation}`,
          '',
          `**Session ID**: ${session.sessionId}`,
          '',
          `**Follow-up Questions**:`,
          ...session.followUpQuestions.map((q, i) => `${i + 1}. ${q}`),
        ].filter(Boolean).join('\n');

        logger.info('MCP generate-query-from-question called', {
          sessionId: session.sessionId,
          intentType: session.intent.type,
        });

        return { content: [{ type: 'text' as const, text: lines }] };
      } catch (e) {
        logger.error('MCP generate-query-from-question failed', { error: e });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Failed to generate query', details: String(e) }),
          }],
        };
      }
    },
  };
}
