import { Queue, Worker, Job } from 'bullmq';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'webhook-queue' });

export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export type WebhookJobData = {
  webhookEventId: string;
  workspaceId: string;
  targetUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
};

export type WebhookDeliveryResult = {
  jobId: string;
  webhookEventId: string;
  status: 'queued';
};

type RedisOpts = { host: string; port: number; password?: string };

function parseRedisUrl(url: string): RedisOpts {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

/** Exponential backoff delays for webhook retries (ms). */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

/**
 * BullMQ-backed webhook delivery queue with automatic retry and exponential backoff.
 * Failed jobs are retried up to 5 times before being moved to the dead-letter state.
 */
export class WebhookQueue {
  private queue: Queue<WebhookJobData>;
  private worker: Worker<WebhookJobData> | null = null;

  /**
   * @param redisUrl - Redis connection URL
   * @param onStatusChange - Callback invoked after each delivery attempt to persist status
   */
  constructor(
    redisUrl: string,
    private readonly onStatusChange: (
      webhookEventId: string,
      status: WebhookDeliveryStatus,
      attemptCount: number,
      httpStatus?: number,
      errorMessage?: string,
    ) => Promise<void>,
  ) {
    const conn = parseRedisUrl(redisUrl);
    this.queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  /**
   * Enqueue a webhook event for delivery.
   *
   * @param data - Webhook job payload
   */
  async enqueueWebhook(data: WebhookJobData): Promise<Result<WebhookDeliveryResult, Error>> {
    try {
      const job = await this.queue.add(`webhook:${data.eventType}`, data, {
        jobId: `wh-${data.webhookEventId}-${Date.now()}`,
      });
      log.info('Webhook enqueued', {
        jobId: job.id,
        eventType: data.eventType,
        workspaceId: data.workspaceId,
      });
      return ok({ jobId: job.id ?? '', webhookEventId: data.webhookEventId, status: 'queued' });
    } catch (e) {
      log.error('Failed to enqueue webhook', { error: e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Start the delivery worker. Each job is an HTTP POST to the target URL.
   *
   * @param concurrency - Number of parallel delivery workers (default: 3)
   */
  startWorker(concurrency = 3): void {
    if (this.worker) return;

    this.worker = new Worker<WebhookJobData>(
      WEBHOOK_QUEUE_NAME,
      async (job: Job<WebhookJobData>) => {
        const { webhookEventId, targetUrl, payload, eventType, workspaceId } = job.data;
        const attempt = (job.attemptsMade ?? 0) + 1;

        log.debug('Delivering webhook', { webhookEventId, targetUrl, attempt });

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 10_000);

        let httpStatus = 0;
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Iris-Event': eventType,
              'X-Iris-Workspace': workspaceId,
              'X-Iris-Delivery-Attempt': String(attempt),
            },
            body: JSON.stringify(payload),
            signal: ac.signal,
          });
          httpStatus = res.status;

          if (res.status >= 200 && res.status < 300) {
            await this.onStatusChange(webhookEventId, 'delivered', attempt, httpStatus);
            log.info('Webhook delivered', { webhookEventId, httpStatus, attempt });
            return;
          }

          throw new Error(`Non-2xx response: ${res.status}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isLastAttempt = attempt >= 5;
          const status: WebhookDeliveryStatus = isLastAttempt ? 'dead' : 'failed';
          await this.onStatusChange(webhookEventId, status, attempt, httpStatus, msg);

          if (isLastAttempt) {
            log.warn('Webhook dead-lettered after max retries', { webhookEventId, attempt });
          } else {
            log.warn('Webhook delivery failed, will retry', { webhookEventId, attempt, error: msg });
            throw e;
          }
        } finally {
          clearTimeout(timer);
        }
      },
      {
        connection: this.queue.opts.connection as RedisOpts,
        concurrency,
      },
    );

    this.worker.on('failed', (job, err) => {
      log.error('Worker job failed', { jobId: job?.id, error: err?.message });
    });

    log.info('Webhook delivery worker started', { concurrency });
  }

  async stopWorker(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async close(): Promise<void> {
    await this.stopWorker();
    await this.queue.close();
  }

  /** Returns the number of jobs currently waiting for delivery. */
  async getPendingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  /** Returns the number of jobs in the failed state. */
  async getFailedCount(): Promise<number> {
    return this.queue.getFailedCount();
  }
}
