'use client';

import React, { useEffect, useRef } from 'react';

export default function GlobalErrorBoundary({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <html lang="id">
      <body>
        <main role="alert" className="mx-auto max-w-lg space-y-4 p-8">
          <h1 className="text-2xl font-bold text-foreground">Gagal Pada Aplikasi</h1>
          <p className="text-sm text-muted-foreground">Floz mengalami kendala sistem. Silakan muat ulang aplikasi untuk mencoba kembali.</p>
          <button
            ref={button}
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-subtle"
          >
            Muat Ulang Aplikasi
          </button>
        </main>
      </body>
    </html>
  );
}
