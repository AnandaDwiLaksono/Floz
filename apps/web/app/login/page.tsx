'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { BrandLogo } from '../../components/brand-logo';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email dan kata sandi wajib diisi.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kredensial tidak valid atau koneksi bermasalah.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <div className="text-center">
          <div className="mx-auto w-36">
            <BrandLogo />
          </div>
          <h2 className="mt-6 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Masuk ke Floz</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sistem Operasi Manajemen Kerja</p>
        </div>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          {error && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-semibold text-foreground">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@perusahaan.com"
                className="block min-h-11 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-semibold text-foreground">
                Kata sandi
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={submitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="block min-h-11 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {submitting ? 'Sedang masuk...' : 'Masuk'}
            </button>
          </div>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Belum memiliki akun?{' '}
          <Link href="/register" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Daftar akun
          </Link>
        </p>
      </div>
    </div>
  );
}
