'use client';

/** Last-resort boundary (the root layout itself failed), so it ships its own minimal styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#f6efe3',
          color: '#1c1a16',
          fontFamily: 'Georgia, serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 44, margin: 0, fontWeight: 900 }}>BookLeaf is having a moment.</h1>
          <p style={{ fontFamily: 'system-ui, sans-serif', color: '#6b6355' }}>
            Please try again in a few seconds.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '12px 22px',
              borderRadius: 12,
              border: 0,
              background: '#1c1a16',
              color: '#fbf6ec',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
