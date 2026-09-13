import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../app/error';
import GlobalErrorBoundary from '../app/global-error';

describe('error boundaries', () => {
  it('renders an accessible segment recovery action and focuses it', () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'Unable to load this page' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load this page');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('renders an accessible global reload action and focuses it', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(<GlobalErrorBoundary error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Application error' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Reload application' });
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledOnce();
  });
});
