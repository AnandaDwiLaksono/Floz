'use client';

import React, { useEffect, useRef } from 'react';

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  return <main role="alert" className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-bold">Unable to load this page</h1><p>The page could not be displayed. Try loading it again.</p><button ref={button} type="button" onClick={reset} className="rounded border px-4 py-2">Try again</button></main>;
}
