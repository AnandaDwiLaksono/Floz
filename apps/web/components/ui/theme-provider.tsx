'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

function savedTheme(): Theme {
  return localStorage.getItem('floz-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => setTheme(savedTheme()), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('floz-theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useOptionalTheme() {
  return useContext(ThemeContext);
}

export function useTheme() {
  const context = useOptionalTheme();
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
