import { useEffect, useRef, useState } from 'react';
import {
  getLocalAdminState,
  getLocalPublicState,
  subscribeLocalSync,
} from '../lib/localFallback';
import { resolveApiUrl, resolveWsUrl } from '../lib/routes';
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
  isStaticFallback: boolean;
  setState: React.Dispatch<React.SetStateAction<T | null>>;
}

export async function checkBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(resolveApiUrl('/api/health'), {
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export function useCeremonySocket<T extends PublicCeremonyState | AdminCeremonyState>({
  role,
  adminToken,
  enabled = true,
}: UseCeremonySocketOptions): UseCeremonySocketResult<T> {
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [isStaticFallback, setIsStaticFallback] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (role === 'admin' && !adminToken) return;

    let unmounted = false;
    let unsubscribeLocal: (() => void) | null = null;

    const activateLocalFallback = () => {
      if (unmounted) return;
      setIsStaticFallback(true);
      setConnected(true);
      const readLocal = () => {
        if (unmounted) return;
        const next =
          role === 'admin'
            ? (getLocalAdminState() as T)
            : (getLocalPublicState(role) as T);
        setState(next);
      };
      readLocal();
      unsubscribeLocal = subscribeLocalSync(readLocal);
    };

    const fetchInitialSnapshot = async (): Promise<boolean> => {
      try {
        if (role === 'admin' && adminToken) {
          const res = await fetch(resolveApiUrl('/api/admin/state'), {
            headers: { Authorization: `Bearer ${adminToken}` },
          });
          const ct = res.headers.get('content-type') || '';
          if (res.ok && ct.includes('application/json') && !unmounted) {
            const data = (await res.json()) as T;
            setState(data);
            return true;
          }
        } else if (role !== 'admin') {
          const res = await fetch(resolveApiUrl(`/api/public/state?audience=${role}`));
          const ct = res.headers.get('content-type') || '';
          if (res.ok && ct.includes('application/json') && !unmounted) {
            const data = (await res.json()) as T;
            setState(data);
            return true;
          }
        }
      } catch {
        // Fallback handled below
      }
      return false;
    };

    const connectWs = () => {
      if (unmounted) return;
      const ws = new WebSocket(resolveWsUrl());
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
          connectWs();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    (async () => {
      const hasBackend = await checkBackendAvailable();
      if (unmounted) return;
      if (!hasBackend) {
        activateLocalFallback();
        return;
      }
      setIsStaticFallback(false);
      await fetchInitialSnapshot();
      connectWs();
    })();

    return () => {
      unmounted = true;
      if (unsubscribeLocal) unsubscribeLocal();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [role, adminToken, enabled]);

  return { state, connected, isStaticFallback, setState };
}
