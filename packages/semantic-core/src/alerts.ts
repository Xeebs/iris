import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'alerts' });

export type AlertCondition = 'sync_failure' | 'token_quota' | 'performance_degradation' | 'cache_miss_rate';
export type AlertChannelType = 'email' | 'slack' | 'pagerduty' | 'webhook';
export type AlertEventStatus = 'triggered' | 'delivered' | 'failed';

export type AlertRule = {
  id: string;
  workspaceId: string;
  name: string;
  condition: AlertCondition;
  threshold: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AlertChannel = {
  id: string;
  workspaceId: string;
  name: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AlertEvent = {
  id: string;
  workspaceId: string;
  ruleId: string;
  channelId: string | null;
  status: AlertEventStatus;
  payload: Record<string, unknown> | null;
  errorMessage: string | null;
  sentAt: Date;
};

export type CreateRuleOptions = {
  name: string;
  condition: AlertCondition;
  threshold: number;
  enabled?: boolean;
};

export type CreateChannelOptions = {
  name: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
  isDefault?: boolean;
};

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

function mapRuleRow(r: Record<string, unknown>): AlertRule {
  return {
    id: r['id'] as string,
    workspaceId: r['workspace_id'] as string,
    name: r['name'] as string,
    condition: r['condition'] as AlertCondition,
    threshold: r['threshold'] as number,
    enabled: r['enabled'] as boolean,
    createdAt: new Date(r['created_at'] as string),
    updatedAt: new Date(r['updated_at'] as string),
  };
}

function mapChannelRow(r: Record<string, unknown>): AlertChannel {
  return {
    id: r['id'] as string,
    workspaceId: r['workspace_id'] as string,
    name: r['name'] as string,
    type: r['type'] as AlertChannelType,
    config: (r['config'] as Record<string, unknown>) ?? {},
    isDefault: r['is_default'] as boolean,
    createdAt: new Date(r['created_at'] as string),
    updatedAt: new Date(r['updated_at'] as string),
  };
}

/**
 * Manages alert rules, channels, and evaluation for a workspace.
 */
export class AlertsService {
  constructor(
    private readonly sql: SqlFn,
    private readonly notifier: AlertNotifier = new HttpAlertNotifier(),
  ) {}

  // ─── Rules CRUD ────────────────────────────────────────────────────────────

  /**
   * @param workspaceId - Tenant workspace
   * @returns All alert rules for the workspace
   */
  async listRules(workspaceId: string): Promise<Result<AlertRule[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, name, condition, threshold, enabled, created_at, updated_at
        FROM alert_rules
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
      ` as Record<string, unknown>[];
      return ok(rows.map(mapRuleRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param options - Rule definition
   * @returns Created rule
   */
  async createRule(workspaceId: string, options: CreateRuleOptions): Promise<Result<AlertRule, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO alert_rules (workspace_id, name, condition, threshold, enabled)
        VALUES (${workspaceId}, ${options.name}, ${options.condition}, ${options.threshold}, ${options.enabled ?? true})
        RETURNING id, workspace_id, name, condition, threshold, enabled, created_at, updated_at
      ` as Record<string, unknown>[];
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      return ok(mapRuleRow(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param ruleId - Rule to delete
   */
  async deleteRule(workspaceId: string, ruleId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM alert_rules WHERE id = ${ruleId} AND workspace_id = ${workspaceId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Channels CRUD ─────────────────────────────────────────────────────────

  /**
   * @param workspaceId - Tenant workspace
   * @returns All configured notification channels
   */
  async listChannels(workspaceId: string): Promise<Result<AlertChannel[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, name, type, config, is_default, created_at, updated_at
        FROM alert_channels
        WHERE workspace_id = ${workspaceId}
        ORDER BY is_default DESC, created_at ASC
      ` as Record<string, unknown>[];
      return ok(rows.map(mapChannelRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param options - Channel definition
   * @returns Created channel
   */
  async createChannel(workspaceId: string, options: CreateChannelOptions): Promise<Result<AlertChannel, Error>> {
    try {
      const rows = await this.sql`
        INSERT INTO alert_channels (workspace_id, name, type, config, is_default)
        VALUES (${workspaceId}, ${options.name}, ${options.type}, ${JSON.stringify(options.config)}, ${options.isDefault ?? false})
        RETURNING id, workspace_id, name, type, config, is_default, created_at, updated_at
      ` as Record<string, unknown>[];
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      return ok(mapChannelRow(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @param channelId - Channel to delete
   */
  async deleteChannel(workspaceId: string, channelId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM alert_channels WHERE id = ${channelId} AND workspace_id = ${workspaceId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // ─── Evaluation ────────────────────────────────────────────────────────────

  /**
   * Evaluates all enabled alert rules for a workspace against recent metrics.
   * Fires notifications for any triggered rules.
   *
   * @param workspaceId - Tenant workspace
   * @returns Count of triggered alerts
   */
  async evaluateRules(workspaceId: string): Promise<Result<number, Error>> {
    try {
      const [rulesResult, channelsResult] = await Promise.all([
        this.listRules(workspaceId),
        this.listChannels(workspaceId),
      ]);
      if (rulesResult.isErr()) return err(rulesResult.error);
      if (channelsResult.isErr()) return err(channelsResult.error);

      const rules = rulesResult.value.filter((r) => r.enabled);
      const channels = channelsResult.value;
      const defaultChannels = channels.filter((c) => c.isDefault);

      let triggered = 0;
      for (const rule of rules) {
        const metricResult = await this.fetchMetric(workspaceId, rule.condition);
        if (metricResult.isErr()) continue;

        const value = metricResult.value;
        if (value >= rule.threshold) {
          triggered++;
          const payload = { workspaceId, ruleName: rule.name, condition: rule.condition, threshold: rule.threshold, value };
          await this.sendAlert(rule, defaultChannels, payload);
        }
      }

      log.info('Alert evaluation complete', { workspaceId, rulesChecked: rules.length, triggered });
      return ok(triggered);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async fetchMetric(workspaceId: string, condition: AlertCondition): Promise<Result<number, Error>> {
    try {
      if (condition === 'sync_failure') {
        const rows = await this.sql`
          SELECT COUNT(*)::int AS cnt
          FROM sync_performance
          WHERE workspace_id = ${workspaceId}
            AND status = 'failed'
            AND started_at >= now() - INTERVAL '1 hour'
        ` as { cnt: number }[];
        return ok(rows[0]?.cnt ?? 0);
      }
      if (condition === 'token_quota') {
        const rows = await this.sql`
          SELECT COALESCE(SUM(tokens_used), 0)::bigint AS total
          FROM token_events
          WHERE workspace_id = ${workspaceId}
            AND timestamp >= now() - INTERVAL '1 day'
        ` as { total: string }[];
        return ok(Number(rows[0]?.total ?? 0));
      }
      if (condition === 'performance_degradation') {
        const rows = await this.sql`
          SELECT COALESCE(AVG(total_duration_ms), 0)::real AS avg_ms
          FROM sync_performance
          WHERE workspace_id = ${workspaceId}
            AND status = 'completed'
            AND started_at >= now() - INTERVAL '1 hour'
        ` as { avg_ms: number }[];
        return ok(rows[0]?.avg_ms ?? 0);
      }
      // cache_miss_rate
      const rows = await this.sql`
        SELECT
          CASE WHEN COUNT(*) = 0 THEN 0
               ELSE COUNT(*) FILTER (WHERE cache_hit = false)::real / COUNT(*)::real
          END AS miss_rate
        FROM token_events
        WHERE workspace_id = ${workspaceId}
          AND timestamp >= now() - INTERVAL '1 hour'
      ` as { miss_rate: number }[];
      return ok(rows[0]?.miss_rate ?? 0);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Dispatches a triggered alert to all applicable channels and records each event.
   *
   * @param rule - Triggered rule
   * @param channels - Channels to dispatch to
   * @param payload - Alert context data
   */
  async sendAlert(
    rule: AlertRule,
    channels: AlertChannel[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (const channel of channels) {
      let status: AlertEventStatus = 'triggered';
      let errorMessage: string | null = null;
      try {
        await this.notifier.send(channel, rule, payload);
        status = 'delivered';
      } catch (e) {
        status = 'failed';
        errorMessage = e instanceof Error ? e.message : String(e);
        log.warn('Alert notification failed', { ruleId: rule.id, channelId: channel.id, error: errorMessage });
      }
      await this.sql`
        INSERT INTO alert_events (workspace_id, rule_id, channel_id, status, payload, error_message)
        VALUES (${rule.workspaceId}, ${rule.id}, ${channel.id}, ${status}, ${JSON.stringify(payload)}, ${errorMessage})
      `;
    }
    if (channels.length === 0) {
      await this.sql`
        INSERT INTO alert_events (workspace_id, rule_id, status, payload)
        VALUES (${rule.workspaceId}, ${rule.id}, 'triggered', ${JSON.stringify(payload)})
      `;
    }
  }

  /**
   * @param workspaceId - Tenant workspace
   * @returns Recent alert events
   */
  async listEvents(workspaceId: string, limit = 50): Promise<Result<AlertEvent[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, rule_id, channel_id, status, payload, error_message, sent_at
        FROM alert_events
        WHERE workspace_id = ${workspaceId}
        ORDER BY sent_at DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];
      return ok(rows.map((r) => ({
        id: r['id'] as string,
        workspaceId: r['workspace_id'] as string,
        ruleId: r['rule_id'] as string,
        channelId: r['channel_id'] as string | null,
        status: r['status'] as AlertEventStatus,
        payload: r['payload'] as Record<string, unknown> | null,
        errorMessage: r['error_message'] as string | null,
        sentAt: new Date(r['sent_at'] as string),
      })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

// ─── Notification dispatchers ─────────────────────────────────────────────────

export interface AlertNotifier {
  send(channel: AlertChannel, rule: AlertRule, payload: Record<string, unknown>): Promise<void>;
}

export class HttpAlertNotifier implements AlertNotifier {
  async send(channel: AlertChannel, rule: AlertRule, payload: Record<string, unknown>): Promise<void> {
    if (channel.type === 'slack') {
      const webhookUrl = channel.config['webhookUrl'] as string | undefined;
      if (!webhookUrl) throw new Error('Slack channel missing webhookUrl');
      const body = JSON.stringify({
        text: `:warning: *${rule.name}* triggered (condition: ${rule.condition}, threshold: ${rule.threshold}, value: ${payload['value']})`,
      });
      const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
    } else if (channel.type === 'webhook') {
      const webhookUrl = channel.config['url'] as string | undefined;
      if (!webhookUrl) throw new Error('Webhook channel missing url');
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: { id: rule.id, name: rule.name, condition: rule.condition }, payload }),
      });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    } else if (channel.type === 'pagerduty') {
      const routingKey = channel.config['routingKey'] as string | undefined;
      if (!routingKey) throw new Error('PagerDuty channel missing routingKey');
      const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: routingKey,
          event_action: 'trigger',
          payload: {
            summary: `${rule.name}: ${rule.condition} exceeded threshold ${rule.threshold}`,
            severity: 'warning',
            source: 'iris',
            custom_details: payload,
          },
        }),
      });
      if (!res.ok) throw new Error(`PagerDuty returned ${res.status}`);
    } else if (channel.type === 'email') {
      log.info('Email alert dispatched (stub — configure SendGrid)', { ruleId: rule.id, channelId: channel.id });
    }
  }
}
