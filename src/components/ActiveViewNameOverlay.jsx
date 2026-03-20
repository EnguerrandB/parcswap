// src/components/ActiveViewNameOverlay.jsx
import React, { useEffect, useState } from 'react';

const readEnabledFromUrlOrStorage = () => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('debugViewName') === '1';
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

  if (!enabled) return null;

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center"
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
