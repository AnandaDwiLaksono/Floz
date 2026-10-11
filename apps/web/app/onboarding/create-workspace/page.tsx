'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { api, ApiError } from '../../../lib/api-client';
import { BrandLogo } from '../../../components/brand-logo';

export default function CreateWorkspacePage() {
  const router = useRouter();
  const { refetchUser } = useAuth();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta'
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama ruang kerja wajib diisi.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.workspaces.create({ name: name.trim(), timezone });
      await refetchUser();
      router.push(`/workspaces/${res.data.id}/tasks`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal membuat ruang kerja.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <header className="space-y-2 text-center">
          <div className="mx-auto w-36"><BrandLogo /></div>
          <h1 className="text-2xl font-bold text-foreground">Buat Ruang Kerja Baru</h1>
          <p className="text-sm text-muted-foreground">
            Siapkan ruang kerja organisasi atau tim Anda.
          </p>
        </header>

        {error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="ws_name" className="mb-1 block text-sm font-semibold text-foreground">
              Nama ruang kerja
            </label>
            <input
              id="ws_name"
              type="text"
              required
              disabled={submitting}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="contoh: PT Maju Bersama"
            />
          </div>

          <div>
            <label htmlFor="ws_tz" className="mb-1 block text-sm font-semibold text-foreground">
              Zona waktu
            </label>
            <input
              id="ws_tz"
              type="text"
              required
              disabled={submitting}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {submitting ? 'Sedang membuat ruang kerja...' : 'Buat Ruang Kerja'}
          </button>
        </form>

        <footer className="text-center text-sm">
          <Link href="/onboarding" className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Kembali ke Penyiapan
          </Link>
        </footer>
      </div>
    </main>
  );
}
