import React from 'react';
import { renderToString } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../components/ui/theme-provider';
import { ThemeSwitcher } from '../components/ui/theme-switcher';

const globalsCss = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

const semanticTokens = [
  'background', 'foreground', 'surface', 'surface-subtle', 'surface-raised',
  'muted', 'muted-foreground', 'border', 'border-strong', 'primary',
  'primary-hover', 'primary-foreground', 'success', 'warning', 'warning-foreground', 'danger',
  'info', 'focus-ring', 'overlay',
];

function themeBlock(selector: string) {
  const start = globalsCss.indexOf(`${selector} {`);
  const end = globalsCss.indexOf('\n}', start);
  return start >= 0 && end >= 0 ? globalsCss.slice(start, end) : '';
}

describe('theme foundation', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('defaults to light and exposes an explicit theme switch', () => {
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(screen.getByRole('radio', { name: 'Gelap' })).toBeInTheDocument();
  });

  it('renders without browser storage during server rendering', () => {
    const storage = globalThis.localStorage;
    vi.stubGlobal('localStorage', undefined);
    try {
      expect(() => renderToString(<ThemeSwitcher />)).not.toThrow();
    } finally {
      vi.stubGlobal('localStorage', storage);
    }
  });

  it('restores a persisted theme without a provider after hydration', () => {
    localStorage.setItem('floz-theme', 'dark');
    render(<ThemeSwitcher />);
    expect(screen.getByRole('radio', { name: 'Gelap' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('floz-theme')).toBe('dark');
  });

  it('defaults, switches, and persists without a provider', () => {
    render(<ThemeSwitcher />);
    const light = screen.getByRole('radio', { name: 'Terang' });
    const dark = screen.getByRole('radio', { name: 'Gelap' });
    expect(light).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(dark);
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('floz-theme')).toBe('dark');
  });

  it('switches to dark and persists the selected theme', () => {
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    fireEvent.click(screen.getByRole('radio', { name: 'Gelap' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('floz-theme')).toBe('dark');
  });

  it('restores a valid persisted theme after reload', () => {
    localStorage.setItem('floz-theme', 'dark');
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('falls back to light for an invalid persisted theme', () => {
    localStorage.setItem('floz-theme', 'system');
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('floz-theme')).toBe('light');
  });

  it.each(semanticTokens)('defines the %s semantic token in both themes', (token) => {
    expect(themeBlock(':root')).toContain(`--${token}:`);
    expect(themeBlock("[data-theme='dark']")).toContain(`--${token}:`);
  });

  it('applies the loaded Plus Jakarta Sans variable to the document body', () => {
    expect(globalsCss).toMatch(/body\s*\{[\s\S]*font-family:\s*var\(--font-plus-jakarta-sans\)/);
  });

  it('defines a visible semantic focus ring for keyboard navigation', () => {
    expect(globalsCss).toMatch(/:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--focus-ring\)/);
  });

  it('offers a keyboard-operable theme radiogroup', () => {
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    const group = screen.getByRole('radiogroup', { name: 'Pilihan tema' });
    const light = screen.getByRole('radio', { name: 'Terang' });
    const dark = screen.getByRole('radio', { name: 'Gelap' });
    fireEvent.keyDown(light, { key: 'ArrowRight' });
    expect(group).toContainElement(dark);
    expect(dark).toHaveAttribute('aria-checked', 'true');
  });

  it('offers explicit Indonesian light and dark choices with active selection semantics', () => {
    render(<ThemeProvider><ThemeSwitcher /></ThemeProvider>);
    const light = screen.getByRole('radio', { name: 'Terang' });
    const dark = screen.getByRole('radio', { name: 'Gelap' });
    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(dark).toHaveAttribute('aria-checked', 'false');
    expect(light).toHaveClass('text-primary');
    fireEvent.click(dark);
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(light).toHaveAttribute('aria-checked', 'false');
    expect(dark).toHaveClass('text-primary');
  });
});
