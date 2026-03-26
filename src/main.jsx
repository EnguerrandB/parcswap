import React, { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import './index.css';
import App from './App.jsx';
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
        <div className="h-screen w-full app-surface flex items-center justify-center px-6 text-slate-950">
          <div className="w-full max-w-sm rounded-[28px] border border-white/70 bg-white/85 px-6 py-7 text-center shadow-[0_30px_90px_rgba(15,23,42,0.16)]">
            <div className="mx-auto mb-4 h-11 w-11 rounded-full border-2 border-orange-400/30 border-t-orange-500 animate-spin" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-orange-600">ParkSwap</div>
            <h1 className="mt-3 text-2xl font-black tracking-tight">Loading translations</h1>
            <p className="mt-2 text-sm text-slate-600">Preparing the interface for your language.</p>
          </div>
        </div>
      )}
    >
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
);
