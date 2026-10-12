"use client";

/** Last resort when the root layout itself fails: plain HTML, no app styles to depend on. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1rem", textAlign: "center" }}>
        <p>The app could not load.</p>
        <p style={{ color: "#666", fontSize: "0.875rem" }}>{error.digest ? `Reference ${error.digest}` : error.message}</p>
        <button type="button" onClick={reset} style={{ marginRight: "0.5rem", minHeight: 44, padding: "0 1rem" }}>
          Try again
        </button>
        <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 44, padding: "0 1rem" }}>
          Reload
        </button>
      </body>
    </html>
  );
}
