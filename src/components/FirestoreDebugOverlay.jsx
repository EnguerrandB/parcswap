// src/components/FirestoreDebugOverlay.jsx
import React, { useEffect, useState, useRef } from 'react';
import { WifiOff, Wifi, AlertTriangle } from 'lucide-react';

const FirestoreDebugOverlay = () => {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('unknown');
  const [lastError, setLastError] = useState(null);
  const [connectionCount, setConnectionCount] = useState(0);
  const errorLogRef = useRef([]);

  useEffect(() => {
    // Enable with ?firestoreDebug=1 in URL
    const url = new URL(window.location.href);
    if (url.searchParams.get('firestoreDebug') === '1') {
      setEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Track Firestore channel errors
    const originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      const errorMsg = String(message || '');
      
      // Capture Firestore/webchannel errors
      if (errorMsg.includes('firestore') || 
          errorMsg.includes('webchannel') ||
          errorMsg.includes('ERR_FAILED') ||
          errorMsg.includes('firestore.googleapis.com')) {
        
        const timestamp = new Date().toLocaleTimeString();
        const entry = { timestamp, message: errorMsg, source };
        errorLogRef.current = [entry, ...errorLogRef.current].slice(0, 10);
        setLastError(entry);
        setStatus('error');
        setConnectionCount(c => c + 1);
      }
      
      return originalOnError?.(message, source, lineno, colno, error);
    };

    // Listen for online/offline status
    const handleOnline = () => setStatus('online');
    const handleOffline = () => {
      setStatus('offline');
      errorLogRef.current = [{ 
        timestamp: new Date().toLocaleTimeString(), 
        message: 'Network offline detected',
        source: 'navigator.onLine'
      }, ...errorLogRef.current].slice(0, 10);
      setLastError(errorLogRef.current[0]);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial status
    setStatus(navigator.onLine ? 'online' : 'offline');

    return () => {
      window.onerror = originalOnError;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled]);

  if (!enabled) return null;

  const getStatusColor = () => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-red-500';
      case 'error': return 'text-orange-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'online': return <Wifi size={16} />;
      case 'offline': return <WifiOff size={16} />;
      case 'error': return <AlertTriangle size={16} />;
      default: return <WifiOff size={16} />;
    }
  };

  return (
    <div className="fixed bottom-20 left-2 z-[2147483646] pointer-events-none">
      <div className="bg-black/80 backdrop-blur rounded-lg p-2 text-white text-xs font-mono shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          {getStatusIcon()}
          <span className={getStatusColor()}>
            Firestore: {status}
          </span>
        </div>
        <div className="text-gray-400">
          Errors: {connectionCount}
        </div>
        {lastError && (
          <div className="mt-2 pt-2 border-t border-gray-600 max-w-[280px]">
            <div className="text-orange-400 text-[10px] truncate">
              {lastError.message.substring(0, 50)}
            </div>
            <div className="text-gray-500 text-[10px]">
              {lastError.timestamp}
            </div>
          </div>
        )}
        <div className="mt-1 text-gray-500 text-[10px]">
          URL: ?firestoreDebug=0 to disable
        </div>
      </div>
    </div>
  );
};

export default FirestoreDebugOverlay;

