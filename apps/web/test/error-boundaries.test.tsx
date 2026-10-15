import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../app/error';
import GlobalErrorBoundary from '../app/global-error';

describe('error boundaries', () => {
  it('renders an accessible segment recovery action and focuses it', () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'Gagal Memuat Halaman' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal Memuat Halaman');
    const retry = screen.getByRole('button', { name: 'Coba Lagi' });
    expect(document.activeElement).toBe(retry);
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('renders an accessible global reload action and focuses it', () => {
    const { getByRole } = render(<GlobalErrorBoundary error={new Error('boom')} reset={vi.fn()} />, {
      container: document,
    });
    expect(getByRole('heading', { name: 'Gagal Pada Aplikasi' })).toBeInTheDocument();
    const button = getByRole('button', { name: 'Muat Ulang Aplikasi' });
    expect(document.activeElement).toBe(button);
  });
});
