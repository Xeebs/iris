import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from './logger.js';

const log = logger.child({ service: 'email-service' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailRecipient | EmailRecipient[];
  subject: string;
  html: string;
  text?: string;
}

export interface EmailServiceConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

/** Response from the email provider. */
export interface SendResult {
  messageId: string;
  accepted: string[];
}

// ─── SendGrid transport ───────────────────────────────────────────────────────

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

function buildSendGridPayload(
  message: EmailMessage,
  from: EmailRecipient,
): Record<string, unknown> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  return {
    personalizations: [
      {
        to: recipients.map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}) })),
        subject: message.subject,
      },
    ],
    from: { email: from.email, ...(from.name ? { name: from.name } : {}) },
    content: [
      ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
      { type: 'text/html', value: message.html },
    ],
  };
}

// ─── EmailService ─────────────────────────────────────────────────────────────

/**
 * Thin wrapper around the SendGrid v3 API.
 * Inject a custom `transport` in tests to avoid real HTTP calls.
 *
 * @param config - API key and from-address configuration
 * @param transport - Optional custom send function for testing
 */
export class EmailService {
  private readonly from: EmailRecipient;

  constructor(
    private readonly config: EmailServiceConfig,
    private readonly transport?: (payload: Record<string, unknown>, apiKey: string) => Promise<SendResult>,
  ) {
    this.from = { email: config.fromEmail, name: config.fromName };
  }

  /**
   * @param message - Email message to send
   * @returns SendResult or Error
   */
  async send(message: EmailMessage): Promise<Result<SendResult, Error>> {
    const payload = buildSendGridPayload(message, this.from);
    const recipients = Array.isArray(message.to) ? message.to : [message.to];

    try {
      const result = this.transport
        ? await this.transport(payload, this.config.apiKey)
        : await this.sendViaSendGrid(payload);

      log.info('Email sent', {
        to: recipients.map((r) => r.email),
        subject: message.subject,
        messageId: result.messageId,
      });

      return ok(result);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to send email', {
        to: recipients.map((r) => r.email),
        subject: message.subject,
        error: error.message,
      });
      return err(error);
    }
  }

  private async sendViaSendGrid(payload: Record<string, unknown>): Promise<SendResult> {
    const response = await fetch(SENDGRID_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SendGrid API error ${response.status}: ${body}`);
    }

    // SendGrid returns 202 Accepted with no body on success
    const messageId = response.headers.get('X-Message-Id') ?? `sg-${Date.now()}`;
    const personalizations = (payload['personalizations'] as Array<{ to: Array<{ email: string }> }>)[0];
    const accepted = personalizations?.to.map((r) => r.email) ?? [];

    return { messageId, accepted };
  }
}

// ─── Email templates ──────────────────────────────────────────────────────────

/**
 * @param inviterName - Name of person sending the invite
 * @param workspaceName - Workspace being invited to
 * @param inviteUrl - URL the recipient clicks to accept
 * @returns HTML and text email bodies
 */
export function buildInviteEmail(
  inviterName: string,
  workspaceName: string,
  inviteUrl: string,
): Pick<EmailMessage, 'subject' | 'html' | 'text'> {
  const subject = `You've been invited to join ${workspaceName} on Iris`;
  const html = `
    <h2>You've been invited!</h2>
    <p><strong>${inviterName}</strong> has invited you to join the <strong>${workspaceName}</strong> workspace on Iris.</p>
    <p><a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Accept Invitation</a></p>
    <p style="color:#666;font-size:0.9em;">This invitation expires in 7 days. If you didn't expect this invite, you can safely ignore this email.</p>
  `.trim();
  const text = `${inviterName} has invited you to join ${workspaceName} on Iris.\n\nAccept here: ${inviteUrl}\n\nThis invitation expires in 7 days.`;
  return { subject, html, text };
}
