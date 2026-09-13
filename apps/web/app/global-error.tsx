'use client';

import React, { useEffect, useRef } from 'react';

export default function GlobalErrorBoundary({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return <html lang="en"><body><main role="alert" className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-bold">Application error</h1><p>Floz could not be displayed. Reload the application to try again.</p><button ref={button} type="button" onClick={() => window.location.reload()} className="rounded border px-4 py-2">Reload application</button></main></body></html>;
}
