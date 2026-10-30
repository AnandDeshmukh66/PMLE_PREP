"use client";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6 font-sans text-[14px]">
        <div className="max-w-md rounded-[14px] border border-line bg-surface p-6" data-testid="global-error">
          <h1 className="text-[15px] font-semibold text-fg">PMLE Prep couldn&apos;t load this page</h1>
          <p className="mt-2 text-[13px] text-fg-2">Your saved progress is safe. Reload to try again.</p>
          {error.digest && <p className="mt-2 font-mono text-[11px] text-faint">Reference: {error.digest}</p>}
          <button type="button" onClick={() => (reset(), window.location.reload())} className="mt-4 h-8 rounded-lg bg-accent px-3 text-xs font-medium text-white">
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
