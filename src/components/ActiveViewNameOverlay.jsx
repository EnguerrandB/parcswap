// src/components/ActiveViewNameOverlay.jsx
import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'parkswap.debugViewName';

const readEnabledFromUrlOrStorage = () => {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('debugViewName');
    if (fromUrl === '1') {
      localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    if (fromUrl === '0') {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const ActiveViewNameOverlay = ({ activeViewName = 'Unknown' }) => {
  const [enabled, setEnabled] = useState(() => readEnabledFromUrlOrStorage());

  useEffect(() => {
    const handleUrlChange = () => {
      setEnabled(readEnabledFromUrlOrStorage());
    };

    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // Debug log
  useEffect(() => {
    if (enabled) {
      console.log('[ActiveViewNameOverlay] Showing:', activeViewName);
    }
  }, [activeViewName, enabled]);

  if (!enabled) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div
        className="bg-black/70 text-white px-4 py-3 rounded-lg font-bold text-lg backdrop-blur-sm border border-white/20"
        style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
      >
        {activeViewName}
      </div>
    </div>
  );
};

export default ActiveViewNameOverlay;
