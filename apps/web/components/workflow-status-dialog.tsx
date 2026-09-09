'use client';

import React, { useEffect, useRef } from 'react';

export default function WorkflowStatusDialog({ label, children, onClose }: { label: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || []);
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); trigger?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div aria-hidden="true" className="fixed inset-0 bg-black/50" onClick={onClose} /><div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">{children}</div></div>;
}
