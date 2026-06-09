import { z } from 'zod';
import type { WebSocket, WebSocketServer, RawData } from 'ws';
import type { IncomingMessage } from 'http';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'ws-entity-subscriptions' });

// ─── Protocol ────────────────────────────────────────────────────────────────

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    subscriptionId: z.string(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    workspaceId: z.string(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    subscriptionId: z.string(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface EntityUpdatePayload {
  entityId: string;
  entityType: string;
  workspaceId: string;
  changeType: 'created' | 'updated' | 'deleted';
  updatedAt: string;
}

interface Subscription {
  subscriptionId: string;
  workspaceId: string;
  entityType?: string;
  entityId?: string;
}

interface ClientState {
  ws: WebSocket;
  subscriptions: Map<string, Subscription>;
  lastPingAt: number;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

/**
 * Manages WebSocket client connections and entity-update subscriptions.
 * Clients subscribe by entity type or entity ID; updates are broadcast
 * only to matching subscribers within the same workspace.
 */
export class EntitySubscriptionManager {
  private readonly clients = new Map<WebSocket, ClientState>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly HEARTBEAT_MS = 30_000) {}

  /**
   * Registers the manager on a WebSocket server.
   *
   * @param wss - The WebSocket server to attach to
   */
  attach(wss: WebSocketServer): void {
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const workspaceId = new URL(req.url ?? '/', 'ws://localhost').searchParams.get('workspaceId');
      if (!workspaceId) {
        ws.close(4001, 'Missing workspaceId query param');
        return;
      }

      const state: ClientState = { ws, subscriptions: new Map(), lastPingAt: Date.now() };
      this.clients.set(ws, state);
      log.info('WebSocket client connected', { workspaceId });

      ws.on('message', (data: RawData) => {
        try {
          const parsed = clientMessageSchema.safeParse(JSON.parse(data.toString()));
          if (!parsed.success) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            return;
          }
          this.handleMessage(ws, state, parsed.data);
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Parse error' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log.info('WebSocket client disconnected', { workspaceId });
      });

      ws.on('error', (e: Error) => {
        log.warn('WebSocket error', { workspaceId, error: e.message });
        this.clients.delete(ws);
      });

      ws.send(JSON.stringify({ type: 'connected', workspaceId }));
    });

    this.startHeartbeat();
    log.info('EntitySubscriptionManager attached to WebSocket server');
  }

  /**
   * Broadcasts an entity update to all matching subscribers.
   *
   * @param payload - The entity update to broadcast
   */
  broadcast(payload: EntityUpdatePayload): void {
    let delivered = 0;
    for (const [ws, state] of this.clients) {
      if (ws.readyState !== 1 /* OPEN */) continue;
      for (const sub of state.subscriptions.values()) {
        if (sub.workspaceId !== payload.workspaceId) continue;
        const matchesType = !sub.entityType || sub.entityType === payload.entityType;
        const matchesId = !sub.entityId || sub.entityId === payload.entityId;
        if (matchesType && matchesId) {
          ws.send(JSON.stringify({ type: 'entity_update', ...payload }));
          delivered++;
          break;
        }
      }
    }
    if (delivered > 0) {
      log.debug('Entity update broadcast', { entityId: payload.entityId, delivered });
    }
  }

  /** Returns the number of active client connections. */
  get connectionCount(): number {
    return this.clients.size;
  }

  /** Returns the total number of active subscriptions across all clients. */
  get subscriptionCount(): number {
    let count = 0;
    for (const state of this.clients.values()) {
      count += state.subscriptions.size;
    }
    return count;
  }

  /** Stops the heartbeat timer (call during graceful shutdown). */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleMessage(ws: WebSocket, state: ClientState, msg: ClientMessage): void {
    if (msg.type === 'ping') {
      state.lastPingAt = Date.now();
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'subscribe') {
      if (!msg.entityType && !msg.entityId) {
        ws.send(JSON.stringify({ type: 'error', message: 'subscribe requires entityType or entityId' }));
        return;
      }
      state.subscriptions.set(msg.subscriptionId, {
        subscriptionId: msg.subscriptionId,
        workspaceId: msg.workspaceId,
        ...(msg.entityType !== undefined ? { entityType: msg.entityType } : {}),
        ...(msg.entityId !== undefined ? { entityId: msg.entityId } : {}),
      });
      ws.send(JSON.stringify({ type: 'subscribed', subscriptionId: msg.subscriptionId }));
      return;
    }

    if (msg.type === 'unsubscribe') {
      state.subscriptions.delete(msg.subscriptionId);
      ws.send(JSON.stringify({ type: 'unsubscribed', subscriptionId: msg.subscriptionId }));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const staleThreshold = Date.now() - this.HEARTBEAT_MS * 3;
      for (const [ws, state] of this.clients) {
        if (state.lastPingAt < staleThreshold) {
          log.info('Closing stale WebSocket connection');
          ws.close(4000, 'Heartbeat timeout');
          this.clients.delete(ws);
        } else {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }
      }
    }, this.HEARTBEAT_MS);
  }
}
