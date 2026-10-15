'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { api, ApiError } from '../../lib/api-client';
import { BrandLogo } from '../../components/brand-logo';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      setError('Nama lengkap, email, dan kata sandi wajib diisi.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.auth.register({ email, password, full_name: fullName });
      setRegistered(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Pendaftaran gagal.');
    } finally {
      setSubmitting(false);
    }
  };

  if (registered) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-surface p-6 sm:p-8 text-center shadow-xs">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Periksa email Anda</h1>
          <p className="text-sm text-muted-foreground">
            Kami telah mengirimkan tautan verifikasi ke <strong>{email}</strong>. Silakan periksa email Anda untuk mengaktifkan akun.
          </p>
          <div className="pt-2">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Kembali ke Masuk
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <header className="space-y-2 text-center">
          <div className="mx-auto w-36"><BrandLogo /></div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Daftar Akun Floz</h1>
          <p className="text-sm text-muted-foreground">Mulai kelola tugas dan kolaborasi tim secara mandiri</p>
        </header>

        {error ? (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="full_name" className="mb-1 block text-sm font-semibold text-foreground">Nama lengkap</label>
            <input
              id="full_name"
              type="text"
              required
              disabled={submitting}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="Andi Pratama"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold text-foreground">Email</label>
            <input
              id="email"
              type="email"
              required
              disabled={submitting}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="andi@perusahaan.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold text-foreground">Kata sandi</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              disabled={submitting}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {submitting ? 'Sedang mendaftar...' : 'Daftar Akun'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Sudah memiliki akun?{' '}
          <Link href="/login" className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Masuk
          </Link>
        </p>
      </div>
    </main>
  );
}
