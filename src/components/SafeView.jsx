import React from 'react';

/**
 * Wrapper that applies safe-area padding so tab content stays above the bottom nav
 * and away from device notches.
 */
export default function SafeView({ children, className = '', style = {}, navHidden = false }) {
  const safeStyle = {
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: navHidden ? 'env(safe-area-inset-bottom, 0px)' : 'var(--bottom-safe-offset, 96px)',
    ...(navHidden
      ? { minHeight: '100vh' }
      : { minHeight: 'calc(100vh - var(--bottom-safe-offset, 96px))' }),
    ...style,
  };

  const mergedClassName = ['relative', 'overflow-hidden', className].filter(Boolean).join(' ');

  return (
    <div className={mergedClassName} style={safeStyle} data-role="safe-view">
      {children}
    </div>
  );
}
