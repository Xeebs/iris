'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface EntityUpdate {
  entityId: string;
  entityType: string;
  workspaceId: string;
  changeType: 'created' | 'updated' | 'deleted';
  updatedAt: string;
}

export interface UseEntitySubscriptionOptions {
  workspaceId: string;
  entityType?: string;
  entityId?: string;
  onUpdate?: (update: EntityUpdate) => void;
  enabled?: boolean;
}

export interface EntitySubscriptionState {
  connected: boolean;
  lastUpdate: EntityUpdate | null;
  error: string | null;
}

let subCounter = 0;

/**
 * React hook for subscribing to real-time entity updates via WebSocket.
 * Automatically reconnects on disconnect. Uses a module-level counter to
 * generate unique subscription IDs.
 */
export function useEntitySubscription({
  workspaceId,
  entityType,
  entityId,
  onUpdate,
  enabled = true,
}: UseEntitySubscriptionOptions): EntitySubscriptionState {
  const wsRef = useRef<WebSocket | null>(null);
  const subIdRef = useRef<string>(`sub-${++subCounter}`);
  const [state, setState] = useState<EntitySubscriptionState>({
    connected: false,
    lastUpdate: null,
    error: null,
  });

  const handleUpdate = useCallback((update: EntityUpdate) => {
    setState((prev) => ({ ...prev, lastUpdate: update }));
    onUpdate?.(update);
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/entities?workspaceId=${encodeURIComponent(workspaceId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    const subId = subIdRef.current;

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
      ws.send(JSON.stringify({
        type: 'subscribe',
        subscriptionId: subId,
        workspaceId,
        entityType,
        entityId,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string } & Partial<EntityUpdate>;
        if (msg.type === 'entity_update' && msg.entityId && msg.entityType && msg.changeType) {
          handleUpdate(msg as EntityUpdate);
        }
        if (msg.type === 'heartbeat') {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    ws.onerror = () => {
      setState((prev) => ({ ...prev, connected: false, error: 'WebSocket connection failed' }));
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe', subscriptionId: subId }));
        ws.close();
      }
      wsRef.current = null;
    };
  }, [workspaceId, entityType, entityId, enabled, handleUpdate]);

  return state;
}
