import { Component, type ReactNode } from 'react';
import { storage } from 'wxt/utils/storage';

// Last line of defense for every UI surface. Without a boundary, ANY uncaught
// render error unmounts the entire React tree — and because the dark-theme
// class lives on <html> outside React, the user is left staring at a blank
// near-black page with zero explanation. This turns that into a visible,
// recoverable card, and stores the crash so support/debugging can see it.
export const lastCrashStore = storage.defineItem<string | null>('local:last_crash', { fallback: null });

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    lastCrashStore
      .setValue(
        `${new Date().toISOString()} ${location.pathname}\n${error?.stack ?? String(error)}\n${info?.componentStack ?? ''}`.slice(0, 4000),
      )
      .catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Deliberately theme-independent styles: this must be readable even if the
    // stylesheet failed or the page is mid-crash.
    return (
      <div
        style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
          background: '#101218', color: '#e8ebf2',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>😵</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Keepsake hit a snag</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#9aa4b5', margin: '0 0 16px' }}>
            Something went wrong while drawing this page. Your bookmarks are safe — reloading almost
            always fixes it.
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10,
              padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <details style={{ marginTop: 18, textAlign: 'left' }}>
            <summary style={{ fontSize: 12, color: '#77808f', cursor: 'pointer' }}>Technical details</summary>
            <pre
              style={{
                fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#8b95a6',
                background: '#181c26', borderRadius: 8, padding: 10, maxHeight: 180, overflow: 'auto',
              }}
            >
              {String(this.state.error?.stack ?? this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
