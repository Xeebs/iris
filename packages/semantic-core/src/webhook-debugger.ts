import { ok, err, type Result } from 'neverthrow';
import { createHmac } from 'crypto';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'webhook-debugger' });

export type WebhookDelivery = {
  deliveryId: string;
  webhookId: string;
  eventType: string;
  targetUrl: string;
  statusCode: number | null;
  latencyMs: number | null;
  success: boolean;
  requestBody: string;
  responseBody: string | null;
  errorMessage: string | null;
  deliveredAt: Date;
  retryCount: number;
};

export type WebhookConfig = {
  webhookId: string;
  workspaceId: string;
  targetUrl: string;
  eventTypes: string[];
  active: boolean;
  signingSecret: string;
  createdAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliverySuccess: boolean | null;
};

export type PayloadDiff = {
  field: string;
  expected: unknown;
  actual: unknown;
  matches: boolean;
};

export type SignatureValidation = {
  valid: boolean;
  expectedSignature: string;
  actualSignature: string;
  algorithm: 'hmac-sha256';
};

/**
 * Compute HMAC-SHA256 signature for webhook payload verification.
 * @param payload - Raw request body string
 * @param secret - Signing secret
 * @returns Hex-encoded HMAC-SHA256 signature
 */
export function computeWebhookSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Validate an incoming webhook signature against the expected value.
 * @param payload - Raw request body
 * @param secret - Signing secret
 * @param receivedSignature - Signature from X-Iris-Signature header
 */
export function validateWebhookSignature(payload: string, secret: string, receivedSignature: string): SignatureValidation {
  const expected = computeWebhookSignature(payload, secret);
  const valid = expected === receivedSignature;
  return { valid, expectedSignature: expected, actualSignature: receivedSignature, algorithm: 'hmac-sha256' };
}

/**
 * Compute a flat diff of two payload objects, identifying matching vs differing fields.
 * @param expected - Expected payload (golden fixture or previous delivery)
 * @param actual - Actual received/sent payload
 */
export function comparePayloads(expected: Record<string, unknown>, actual: Record<string, unknown>): PayloadDiff[] {
  const allKeys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  return allKeys.map(field => ({
    field,
    expected: expected[field],
    actual: actual[field],
    matches: JSON.stringify(expected[field]) === JSON.stringify(actual[field]),
  }));
}

/**
 * Manages webhook debugging: delivery history, signature validation, test delivery, and retries.
 */
export class WebhookDebugger {
  private readonly sql: SqlFn;

  constructor(sql: SqlFn) {
    this.sql = sql;
  }

  /**
   * List all webhooks configured for a workspace.
   * @param workspaceId - Workspace identifier
   * @param limit - Max results (default 50)
   */
  async listWebhooks(workspaceId: string, limit = 50): Promise<Result<WebhookConfig[], Error>> {
    try {
      const rows = await this.sql`
        SELECT webhook_id, workspace_id, target_url, event_types, active,
               signing_secret, created_at, last_delivery_at, last_delivery_success
        FROM webhook_configs
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ` as unknown as Array<{
        webhook_id: string;
        workspace_id: string;
        target_url: string;
        event_types: string[] | string;
        active: boolean;
        signing_secret: string;
        created_at: Date;
        last_delivery_at: Date | null;
        last_delivery_success: boolean | null;
      }>;
      return ok(rows.map(r => ({
        webhookId: r.webhook_id,
        workspaceId: r.workspace_id,
        targetUrl: r.target_url,
        eventTypes: Array.isArray(r.event_types) ? r.event_types : JSON.parse(r.event_types as string) as string[],
        active: r.active,
        signingSecret: r.signing_secret,
        createdAt: r.created_at,
        lastDeliveryAt: r.last_delivery_at,
        lastDeliverySuccess: r.last_delivery_success,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get delivery history for a webhook.
   * @param webhookId - Webhook identifier
   * @param workspaceId - Workspace identifier (for authorization check)
   * @param limit - Max deliveries to return
   */
  async getDeliveries(webhookId: string, workspaceId: string, limit = 50): Promise<Result<WebhookDelivery[], Error>> {
    try {
      const rows = await this.sql`
        SELECT d.delivery_id, d.webhook_id, d.event_type, d.target_url,
               d.status_code, d.latency_ms, d.success, d.request_body,
               d.response_body, d.error_message, d.delivered_at, d.retry_count
        FROM webhook_deliveries d
        JOIN webhook_configs c ON c.webhook_id = d.webhook_id
        WHERE d.webhook_id = ${webhookId} AND c.workspace_id = ${workspaceId}
        ORDER BY d.delivered_at DESC
        LIMIT ${limit}
      ` as unknown as Array<{
        delivery_id: string; webhook_id: string; event_type: string; target_url: string;
        status_code: number | null; latency_ms: number | null; success: boolean;
        request_body: string; response_body: string | null; error_message: string | null;
        delivered_at: Date; retry_count: number;
      }>;
      return ok(rows.map(r => ({
        deliveryId: r.delivery_id, webhookId: r.webhook_id, eventType: r.event_type,
        targetUrl: r.target_url, statusCode: r.status_code, latencyMs: r.latency_ms,
        success: r.success, requestBody: r.request_body, responseBody: r.response_body,
        errorMessage: r.error_message, deliveredAt: r.delivered_at, retryCount: r.retry_count,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Fire a test webhook delivery with a sample payload.
   * @param webhookId - Webhook to test
   * @param workspaceId - Workspace identifier
   * @param samplePayload - JSON payload to send
   */
  async testDelivery(webhookId: string, workspaceId: string, samplePayload: Record<string, unknown>): Promise<Result<WebhookDelivery, Error>> {
    try {
      const webhookRows = await this.sql`
        SELECT target_url, signing_secret FROM webhook_configs
        WHERE webhook_id = ${webhookId} AND workspace_id = ${workspaceId}
      ` as unknown as Array<{ target_url: string; signing_secret: string }>;
      const config = webhookRows[0];
      if (!config) return err(new Error('Webhook not found'));

      const body = JSON.stringify(samplePayload);
      const signature = computeWebhookSignature(body, config.signing_secret);
      const startMs = Date.now();
      let statusCode: number | null = null;
      let responseBody: string | null = null;
      let errorMessage: string | null = null;
      let success = false;

      try {
        const res = await fetch(config.target_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Iris-Signature': signature },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        responseBody = await res.text();
        success = res.ok;
      } catch (fetchErr) {
        errorMessage = fetchErr instanceof Error ? fetchErr.message : 'Network error';
      }

      const latencyMs = Date.now() - startMs;

      const deliveryRows = await this.sql`
        INSERT INTO webhook_deliveries
          (webhook_id, event_type, target_url, status_code, latency_ms, success, request_body, response_body, error_message, retry_count)
        VALUES
          (${webhookId}, 'test', ${config.target_url}, ${statusCode}, ${latencyMs}, ${success}, ${body}, ${responseBody}, ${errorMessage}, 0)
        RETURNING delivery_id, webhook_id, event_type, target_url, status_code, latency_ms,
                  success, request_body, response_body, error_message, delivered_at, retry_count
      ` as unknown as Array<{
        delivery_id: string; webhook_id: string; event_type: string; target_url: string;
        status_code: number | null; latency_ms: number | null; success: boolean;
        request_body: string; response_body: string | null; error_message: string | null;
        delivered_at: Date; retry_count: number;
      }>;

      const row = deliveryRows[0];
      if (!row) return err(new Error('Failed to record delivery'));
      log.info('Test delivery fired', { webhookId, success, statusCode, latencyMs });
      return ok({
        deliveryId: row.delivery_id, webhookId: row.webhook_id, eventType: row.event_type,
        targetUrl: row.target_url, statusCode: row.status_code, latencyMs: row.latency_ms,
        success: row.success, requestBody: row.request_body, responseBody: row.response_body,
        errorMessage: row.error_message, deliveredAt: row.delivered_at, retryCount: row.retry_count,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retry a failed delivery.
   * @param deliveryId - Delivery to retry
   * @param workspaceId - Workspace identifier
   */
  async retryDelivery(deliveryId: string, workspaceId: string): Promise<Result<WebhookDelivery, Error>> {
    try {
      const rows = await this.sql`
        SELECT d.webhook_id, d.event_type, d.target_url, d.request_body, d.retry_count,
               c.signing_secret
        FROM webhook_deliveries d
        JOIN webhook_configs c ON c.webhook_id = d.webhook_id
        WHERE d.delivery_id = ${deliveryId} AND c.workspace_id = ${workspaceId}
      ` as unknown as Array<{
        webhook_id: string; event_type: string; target_url: string;
        request_body: string; retry_count: number; signing_secret: string;
      }>;
      const orig = rows[0];
      if (!orig) return err(new Error('Delivery not found'));

      const signature = computeWebhookSignature(orig.request_body, orig.signing_secret);
      const startMs = Date.now();
      let statusCode: number | null = null;
      let responseBody: string | null = null;
      let errorMessage: string | null = null;
      let success = false;

      try {
        const res = await fetch(orig.target_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Iris-Signature': signature },
          body: orig.request_body,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        responseBody = await res.text();
        success = res.ok;
      } catch (fetchErr) {
        errorMessage = fetchErr instanceof Error ? fetchErr.message : 'Network error';
      }

      const latencyMs = Date.now() - startMs;

      const newRows = await this.sql`
        INSERT INTO webhook_deliveries
          (webhook_id, event_type, target_url, status_code, latency_ms, success, request_body, response_body, error_message, retry_count)
        VALUES
          (${orig.webhook_id}, ${orig.event_type}, ${orig.target_url}, ${statusCode}, ${latencyMs}, ${success}, ${orig.request_body}, ${responseBody}, ${errorMessage}, ${orig.retry_count + 1})
        RETURNING delivery_id, webhook_id, event_type, target_url, status_code, latency_ms,
                  success, request_body, response_body, error_message, delivered_at, retry_count
      ` as unknown as Array<{
        delivery_id: string; webhook_id: string; event_type: string; target_url: string;
        status_code: number | null; latency_ms: number | null; success: boolean;
        request_body: string; response_body: string | null; error_message: string | null;
        delivered_at: Date; retry_count: number;
      }>;

      const row = newRows[0];
      if (!row) return err(new Error('Failed to record retry'));
      log.info('Delivery retried', { deliveryId, success, statusCode });
      return ok({
        deliveryId: row.delivery_id, webhookId: row.webhook_id, eventType: row.event_type,
        targetUrl: row.target_url, statusCode: row.status_code, latencyMs: row.latency_ms,
        success: row.success, requestBody: row.request_body, responseBody: row.response_body,
        errorMessage: row.error_message, deliveredAt: row.delivered_at, retryCount: row.retry_count,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get failed deliveries that can be retried.
   * @param workspaceId - Workspace identifier
   */
  async getRetryQueue(workspaceId: string): Promise<Result<WebhookDelivery[], Error>> {
    try {
      const rows = await this.sql`
        SELECT d.delivery_id, d.webhook_id, d.event_type, d.target_url,
               d.status_code, d.latency_ms, d.success, d.request_body,
               d.response_body, d.error_message, d.delivered_at, d.retry_count
        FROM webhook_deliveries d
        JOIN webhook_configs c ON c.webhook_id = d.webhook_id
        WHERE c.workspace_id = ${workspaceId}
          AND d.success = false
          AND d.retry_count < 3
        ORDER BY d.delivered_at DESC
        LIMIT 50
      ` as unknown as Array<{
        delivery_id: string; webhook_id: string; event_type: string; target_url: string;
        status_code: number | null; latency_ms: number | null; success: boolean;
        request_body: string; response_body: string | null; error_message: string | null;
        delivered_at: Date; retry_count: number;
      }>;
      return ok(rows.map(r => ({
        deliveryId: r.delivery_id, webhookId: r.webhook_id, eventType: r.event_type,
        targetUrl: r.target_url, statusCode: r.status_code, latencyMs: r.latency_ms,
        success: r.success, requestBody: r.request_body, responseBody: r.response_body,
        errorMessage: r.error_message, deliveredAt: r.delivered_at, retryCount: r.retry_count,
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
