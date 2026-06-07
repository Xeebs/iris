import type postgres from 'postgres';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'email-templates' });

type SqlFn = ReturnType<typeof postgres>;

export type EmailTemplate = {
  id: string;
  workspaceId: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  variables: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTemplateInput = {
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  variables?: string[];
  isDefault?: boolean;
};

type TemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  subject: string;
  html_body: string;
  text_body: string;
  variables: string[];
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Extract `{{variable}}` placeholders from a template string. */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}

/**
 * Interpolate `{{variable}}` placeholders in a template string.
 *
 * @param template - Template string with `{{variable}}` placeholders
 * @param variables - Key-value pairs to substitute
 * @returns Interpolated string
 */
export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}

function rowToTemplate(row: TemplateRow): EmailTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    subject: row.subject,
    htmlBody: row.html_body,
    textBody: row.text_body,
    variables: row.variables ?? [],
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * CRUD service for workspace email templates.
 * Templates use `{{variable}}` placeholder syntax for variable interpolation.
 */
export class EmailTemplateService {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Create a new email template for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param input - Template fields
   * @returns Created template
   */
  async create(workspaceId: string, input: CreateTemplateInput): Promise<Result<EmailTemplate, Error>> {
    try {
      const variables = input.variables ?? extractVariables(`${input.subject} ${input.htmlBody} ${input.textBody}`);
      const rows = await this.sql<TemplateRow[]>`
        INSERT INTO email_templates (workspace_id, name, subject, html_body, text_body, variables, is_default)
        VALUES (
          ${workspaceId}, ${input.name}, ${input.subject},
          ${input.htmlBody}, ${input.textBody},
          ${JSON.stringify(variables)},
          ${input.isDefault ?? false}
        )
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      log.info('Email template created', { workspaceId, name: input.name });
      return ok(rowToTemplate(row));
    } catch (e) {
      log.error('Failed to create email template', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Upsert an email template by name (create or update if exists).
   *
   * @param workspaceId - Tenant workspace
   * @param input - Template fields
   * @returns Upserted template
   */
  async upsert(workspaceId: string, input: CreateTemplateInput): Promise<Result<EmailTemplate, Error>> {
    try {
      const variables = input.variables ?? extractVariables(`${input.subject} ${input.htmlBody} ${input.textBody}`);
      const rows = await this.sql<TemplateRow[]>`
        INSERT INTO email_templates (workspace_id, name, subject, html_body, text_body, variables, is_default)
        VALUES (
          ${workspaceId}, ${input.name}, ${input.subject},
          ${input.htmlBody}, ${input.textBody},
          ${JSON.stringify(variables)},
          ${input.isDefault ?? false}
        )
        ON CONFLICT (workspace_id, name) DO UPDATE SET
          subject = EXCLUDED.subject,
          html_body = EXCLUDED.html_body,
          text_body = EXCLUDED.text_body,
          variables = EXCLUDED.variables,
          is_default = EXCLUDED.is_default,
          updated_at = now()
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return err(new Error('Upsert returned no rows'));
      return ok(rowToTemplate(row));
    } catch (e) {
      log.error('Failed to upsert email template', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List all email templates for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @returns All templates ordered by name
   */
  async list(workspaceId: string): Promise<Result<EmailTemplate[], Error>> {
    try {
      const rows = await this.sql<TemplateRow[]>`
        SELECT * FROM email_templates
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC
      `;
      return ok(rows.map(rowToTemplate));
    } catch (e) {
      log.error('Failed to list email templates', { workspaceId, error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get an email template by ID.
   *
   * @param workspaceId - Tenant workspace
   * @param id - Template UUID
   * @returns Template or null if not found
   */
  async get(workspaceId: string, id: string): Promise<Result<EmailTemplate | null, Error>> {
    try {
      const rows = await this.sql<TemplateRow[]>`
        SELECT * FROM email_templates WHERE workspace_id = ${workspaceId} AND id = ${id}
      `;
      return ok(rows[0] ? rowToTemplate(rows[0]) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the default template for a workspace (if set).
   *
   * @param workspaceId - Tenant workspace
   */
  async getDefault(workspaceId: string): Promise<Result<EmailTemplate | null, Error>> {
    try {
      const rows = await this.sql<TemplateRow[]>`
        SELECT * FROM email_templates WHERE workspace_id = ${workspaceId} AND is_default = true LIMIT 1
      `;
      return ok(rows[0] ? rowToTemplate(rows[0]) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Delete a template by ID.
   *
   * @param workspaceId - Tenant workspace
   * @param id - Template UUID
   */
  async delete(workspaceId: string, id: string): Promise<Result<void, Error>> {
    try {
      await this.sql`DELETE FROM email_templates WHERE workspace_id = ${workspaceId} AND id = ${id}`;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Render a template with variables and return interpolated subject + body.
   *
   * @param workspaceId - Tenant workspace
   * @param templateId - Template UUID (uses default if not specified)
   * @param variables - Variable values to interpolate
   * @returns Rendered subject, htmlBody, and textBody
   */
  async render(
    workspaceId: string,
    templateId: string | null,
    variables: Record<string, string>,
  ): Promise<Result<{ subject: string; htmlBody: string; textBody: string }, Error>> {
    const templateResult = templateId
      ? await this.get(workspaceId, templateId)
      : await this.getDefault(workspaceId);

    if (templateResult.isErr()) return err(templateResult.error);
    if (!templateResult.value) {
      return err(new Error('Template not found'));
    }

    const t = templateResult.value;
    return ok({
      subject: interpolate(t.subject, variables),
      htmlBody: interpolate(t.htmlBody, variables),
      textBody: interpolate(t.textBody, variables),
    });
  }
}
