import React from 'react';
import AppLogo from './AppLogo';

const AppLoadingScreen = ({
  theme = 'light',
  title = '',
  subtitle = '',
  statusLabel = '',
  appName = 'LoulouPark',
  badge = '',
  phase = 'active',
}) => {
  void theme;
  const hasStatus = Boolean(statusLabel);

  return (
    <div
      className={`app-loading-screen ${phase === 'exit' ? 'app-loading-screen--exit' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="app-loading-screen__surface" aria-hidden="true" />
      <div className="app-loading-screen__center">
        <div className="app-loading-screen__mark-wrap" aria-hidden="true">
          <div className="app-loading-screen__mark">
            <AppLogo size="100%" className="app-loading-screen__mark-logo" />
          </div>
        </div>

        <div className="app-loading-screen__name">{appName}</div>

        {title ? <h1 className="app-loading-screen__title">{title}</h1> : null}
        {subtitle ? <p className="app-loading-screen__subtitle">{subtitle}</p> : null}

        {hasStatus ? (
          <div className="app-loading-screen__status">
            <span className="app-loading-screen__status-label">{statusLabel}</span>
            <span className="app-loading-screen__dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </div>
        ) : null}

        {badge ? <div className="app-loading-screen__badge">{badge}</div> : null}
      </div>
    </div>
  );
};

export default AppLoadingScreen;