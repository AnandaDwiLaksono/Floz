'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useOptionalTheme } from './theme-provider';

export function ThemeSwitcher() {
  const context = useOptionalTheme();
  const [localTheme, setLocalTheme] = useState<'light' | 'dark'>('light');
  const localThemeReady = useRef(false);
  const theme = context?.theme ?? localTheme;
  const setTheme = context?.setTheme ?? ((value: 'light' | 'dark') => setLocalTheme(value));

  useEffect(() => {
    if (context) return;
    const saved = localStorage.getItem('floz-theme');
    if (!localThemeReady.current) {
      localThemeReady.current = true;
      if (saved === 'dark') setLocalTheme('dark');
      return;
    }
    document.documentElement.dataset.theme = localTheme;
    document.documentElement.style.colorScheme = localTheme;
    localStorage.setItem('floz-theme', localTheme);
  }, [context, localTheme]);

  return (
    <div role="radiogroup" aria-label="Pilihan tema" className="inline-flex min-h-11 rounded-md border border-border bg-surface-subtle p-1">
      {(['light', 'dark'] as const).map((option) => {
        const label = option === 'light' ? 'Terang' : 'Gelap';
        const selected = theme === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(option)}
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 'dark'
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 'light'
                : event.key === 'Home' ? 'light'
                : event.key === 'End' ? 'dark'
                : null;
              if (!next) return;
              event.preventDefault();
              setTheme(next);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[role="radio"][data-theme-option="${next}"]`)?.focus();
            }}
            data-theme-option={option}
            className={`min-h-11 rounded px-3 text-sm ${selected ? 'bg-surface-raised text-primary' : 'text-muted-foreground'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
