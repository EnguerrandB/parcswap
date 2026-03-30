import React, { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import './index.css';
import App from './App.jsx';
import AppLoadingScreen from './components/AppLoadingScreen';
import i18n from './i18n/i18n';
import { installAppUrlOpenHandler } from './utils/mobile';

installAppUrlOpenHandler();

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary]', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 480, margin: '60px auto' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>App Crash</h1>
          <pre style={{ marginTop: 12, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 12, background: '#f97316', color: '#fff', fontWeight: 700, border: 'none' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
    <Suspense
      fallback={(
        <AppLoadingScreen statusLabel="Loading" />
      )}
    >
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
);
