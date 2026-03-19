// src/components/ActiveViewNameOverlay.jsx
import React, { useEffect, useState } from 'react';

const readEnabledFromUrl = () => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.has('debugViewName');
  } catch {
    return false;
  }
};

const ActiveViewNameOverlay = ({ activeViewName = 'Unknown' }) => {
  const [enabled, setEnabled] = useState(() => readEnabledFromUrl());

  useEffect(() => {
    const handleUrlChange = () => {
      setEnabled(readEnabledFromUrl());
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
