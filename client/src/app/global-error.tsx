'use client';

import { useEffect } from 'react';

/**
 * The last line of defence: the ROOT layout itself failed, so no stylesheet, provider or component can be relied on.
 * It replaces the whole document (hence <html> and <body>) and is styled inline for the same reason.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <main
          role="alert"
          style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem', textAlign: 'center' }}
        >
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ maxWidth: '28rem', color: '#475569' }}>
            The site hit an unexpected problem. Please try again in a moment.
          </p>
          {error.digest && <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Reference: {error.digest}</p>}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: 'none', background: '#002045', color: '#fff', cursor: 'pointer' }}
            >
              Try again
            </button>
            {/* A plain link: the router may be the thing that is broken */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1', color: '#0f172a', textDecoration: 'none' }}>
              Return home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
