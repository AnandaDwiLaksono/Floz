'use client';

import React, { useEffect, useRef } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <main role="alert" className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-2xl font-bold text-foreground">Gagal Memuat Halaman</h1>
      <p className="text-sm text-muted-foreground">Halaman tidak dapat ditampilkan. Silakan coba memuat ulang.</p>
      <button
        ref={button}
        type="button"
        onClick={reset}
        className="min-h-11 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-subtle"
      >
        Coba Lagi
      </button>
    </main>
  );
}
