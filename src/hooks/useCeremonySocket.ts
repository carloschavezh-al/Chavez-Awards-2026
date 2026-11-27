import { useEffect, useRef, useState } from 'react';
import type { AdminCeremonyState, PublicCeremonyState } from '../types';

type SocketRole = 'voter' | 'screen' | 'admin';

interface UseCeremonySocketOptions {
  role: SocketRole;
  adminToken?: string | null;
  enabled?: boolean;
}

interface UseCeremonySocketResult<T> {
  state: T | null;
  connected: boolean;
  setState: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useCeremonySocket<T extends PublicCeremonyState | AdminCeremonyState>({
  role,
  adminToken,
  enabled = true,
}: UseCeremonySocketOptions): UseCeremonySocketResult<T> {
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (role === 'admin' && !adminToken) return;

    let unmounted = false;

    const fetchInitialSnapshot = async () => {
      try {
        if (role === 'admin' && adminToken) {
          const res = await fetch('/api/admin/state', {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
          if (res.ok && !unmounted) {
            const data = (await res.json()) as T;
            setState(data);
          }
        } else if (role !== 'admin') {
          const res = await fetch(`/api/public/state?audience=${role}`);
          if (res.ok && !unmounted) {
            const data = (await res.json()) as T;
            setState(data);
          }
        }
      } catch {
        // Initial fetch failure will be retried on socket reconnect
      }
    };

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) {
          ws.close();
          return;
        }
        attemptRef.current = 0;
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: 'hello',
            role,
            ...(role === 'admin' && adminToken ? { adminToken } : {}),
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            state?: T;
          };
          if (
            (role === 'admin' && msg.type === 'state:admin' && msg.state) ||
            (role !== 'admin' && msg.type === 'state:public' && msg.state)
          ) {
            setState(msg.state);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        const delay = Math.min(8000, 1000 * Math.pow(2, attemptRef.current));
        attemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(() => {
          fetchInitialSnapshot();
          connect();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    fetchInitialSnapshot();
    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role, adminToken, enabled]);

  return { state, connected, setState };
}
