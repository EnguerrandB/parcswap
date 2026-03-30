import React, { forwardRef } from 'react';

/**
 * Wrapper that applies safe-area padding so tab content stays above the bottom nav
 * and away from device notches.
 */
const SafeView = forwardRef(function SafeView(
  {
    children,
    className = '',
    style = {},
    navHidden = false,
    withTopInset = true,
    withBottomInset = true,
  },
  ref,
) {
  const safeStyle = {
    paddingTop: withTopInset ? 'env(safe-area-inset-top)' : 0,
    paddingBottom: withBottomInset
      ? navHidden
        ? 'env(safe-area-inset-bottom, 0px)'
        : 'var(--bottom-safe-offset, 96px)'
      : 0,
    ...(navHidden
      ? { minHeight: '100vh' }
      : { minHeight: 'calc(100vh - var(--bottom-safe-offset, 96px))' }),
    ...style,
  };

  // MODIFICATION ICI : On retire 'overflow-hidden' pour ne pas couper les ombres/animations
  const mergedClassName = ['relative', className].filter(Boolean).join(' ');

  return (
    <div ref={ref} className={mergedClassName} style={safeStyle} data-role="safe-view">
      {children}
    </div>
  );
});

export default SafeView;
