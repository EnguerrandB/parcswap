import { useEffect, useRef, useState } from 'react';

const getNavigatorConnection = () => {
  if (typeof navigator === 'undefined') return null;
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
};

const isPoorFromConnectionInfo = (connection) => {
  if (!connection) return false;
  const type = String(connection.effectiveType || '').toLowerCase();
  if (type === 'slow-2g' || type === '2g' || type === '3g') return true;

  const rtt = Number(connection.rtt);
  if (Number.isFinite(rtt) && rtt >= 450) return true;

  const downlink = Number(connection.downlink);
  if (Number.isFinite(downlink) && downlink > 0 && downlink <= 1.2) return true;

  return false;
};

export default function useConnectionQuality({
  pingIntervalMs = 15_000,
  pingTimeoutMs = 3_500,
  pingPoorThresholdMs = 1_800,
} = {}) {
  const [isOnline, setIsOnline] = useState(true);
  const [isPoorConnection, setIsPoorConnection] = useState(false);
  const pingInFlightRef = useRef(false);

  // Basic online/offline
  useEffect(() => {
    if (typeof navigator === 'undefined') return undefined;
    const update = () => setIsOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Use Network Information API when available
  useEffect(() => {
    const conn = getNavigatorConnection();
    if (!conn) return undefined;
    const update = () => setIsPoorConnection(isOnline ? isPoorFromConnectionInfo(conn) : false);
    update();

    if (typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', update);
      return () => conn.removeEventListener('change', update);
    }

    conn.onchange = update;
    return () => {
      if (conn.onchange === update) conn.onchange = null;
    };
  }, [isOnline]);

  // Fallback ping (works on iOS Safari where navigator.connection is missing)
  useEffect(() => {
    const conn = getNavigatorConnection();
    if (conn) return undefined;
    if (!isOnline) {
      setIsPoorConnection(false);
      return undefined;
    }
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return undefined;

    let active = true;
    const ping = async () => {
      if (!active) return;
      if (pingInFlightRef.current) return;
      pingInFlightRef.current = true;

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), pingTimeoutMs);
      const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
      try {
        // Same-origin, no-store to avoid cached responses; HEAD is light.
        await fetch(`${window.location.origin}/?ping=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal,
        });
        const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const ms = end - start;
        if (active) setIsPoorConnection(ms >= pingPoorThresholdMs);
      } catch (_) {
        if (active) setIsPoorConnection(true);
      } finally {
        window.clearTimeout(timeoutId);
        pingInFlightRef.current = false;
      }
    };

    ping();
    const id = window.setInterval(ping, pingIntervalMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [isOnline, pingIntervalMs, pingTimeoutMs, pingPoorThresholdMs]);

  return { isOnline, isPoorConnection };
}

